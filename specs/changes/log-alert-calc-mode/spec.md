# Log 告警策略计算方式补齐

Status: ready

本文是需求说明，供产品和研发评审。不实现功能代码，不改扫描、migration 或策略页。
与 Monitor [calc_mode 需求](https://github.com/baiyf-git/bk-lite/pull/17) 产品语言对齐，与 APM 告警计算方式需求并行；Log 作用在 LogsQL 计数/聚合结果上，不复用 Monitor 的 MetricsQL 编译链。

## 1. 要解决什么问题

- 腰部客户配日志告警几乎只会写「关键字命中」或「窗口内 count/sum 比固定阈值」，业务一波动就误报或漏报。
- Log 策略页没有速率/突增、错误占比、短环比；用户无法用表单表达「比上一窗多了多少 / 错误占总量多少」。
- 竞品（Datadog、Elastic、Splunk 一类）用表单就能配 rate/突增、占比，部分还提供 anomaly；我们扫描侧已有 LogsQL `stats count()/sum()/avg()/max()/min()`，但策略表单未开放相对变换。
- 客户要的是一张会切换量纲的表单，不是再学一套 LogsQL 或 PromQL。

**问题陈述：** Log 策略页只有关键字命中和聚合绝对值比较，腰部客户无法用表单配置日志速率、突增和占比类告警。

## 2. 背景

- **产品分工：** Log = 判定/计算（用 LogsQL 取出窗口数字，变换后再比阈值，产生域内告警）；告警中心 = 屏蔽/分派/升级/认领/渠道等运营。本需求不管运营。自动恢复、连续触发若补，也是 Log 域扫描侧的可选增强，不写成告警中心职责。
- **现状（仓库事实）：** `AlertConstants.TYPE_KEYWORD` / `TYPE_AGGREGATE` 两种策略。关键字：窗口内 LogsQL 命中即告（`count > 0`），可 `group_by`。聚合：`stats` 后对 count/sum/avg/max/min 做绝对值比较，`rule.mode` 为 and/or，单 `alert_level`。扫描窗口由 `period` + `schedule` 驱动。证据：`server/apps/log/constants/alert_policy.py`、`models/policy.py`、`tasks/services/policy_scan.py`（`keyword_alert_detection` / `aggregate_alert_detection` / `_build_aggregation_query`）、`web/src/app/log/(pages)/event/strategy/detail/` 三段表单。
- **对标结论：** 竞品用表单配相对/占比计算；我们用表单 `calc_mode`（与 Monitor 的 `rate` / `change` / `mom` 同名），底层在现有 LogsQL `stats` 结果上做双窗口或比值，不大改 LogsQL 查询架构。
- **可行性：** 现有 `query + log_groups → stats → 阈值比较 → 写 Alert/Event` 可在「聚合之后、阈值比较之前」插入变换，无需新扫描架构、不引入表达式引擎。
- **已知缺口（不与运营混淆）：** Log 域今天没有自动恢复状态机，也没有 Monitor 那种 `trigger_count` 连续触发。见 `specs/changes/domain-alert-lifecycle-events/spec.md`。本需求允许将其标为可选增强，不阻塞 P0 计算方式。

## 3. 目标

交付后，用户能在策略页选计算方式并配告警（含预览与扫描）。存量 keyword / aggregate 行为不变。

| # | 成功标准 |
|---|---|
| 1 | 告警条件出现「计算方式」选择器；关键字默认「命中即告」，聚合默认 `absolute` |
| 2 | 存量无 `calc_mode` 的策略按现有 keyword 命中 / aggregate 绝对值扫描，行为与改前一致 |
| 3 | 每种已发布模式可保存、预览、扫描；阈值量纲随模式切换（条数 / Δ / 速率 / %） |
| 4 | 用户不写 PromQL、Zabbix 表达式，也不手写多段 LogsQL 拼 rate |
| 5 | 对照窗口、上一窗、总量缺失时不当 0 比较、不误报 |
| 6 | 非法字段组合在 API 保存期拒绝，不拖到扫描失败 |

## 4. 不做什么（非范围）

- 告警中心运营：屏蔽/维护窗、分派、升级、认领、渠道策略。
- LogsQL / PromQL / Zabbix 表达式编辑器；普通对象不出现自由公式框。
- 容量预测（Monitor 的 `timeleft` 不搬到 Log）。
- 本 PR 不写实现代码、migration、策略页 UI。
- ML 异常检测、完整任意百分位：后置到 P2，不进 P0/P1。

## 5. 在哪做

策略详情三段向导（基本信息、告警条件、通知）里，本需求只动 **告警条件**；基本信息、通知不改。计算方式选择器放告警条件；查询条件 / 日志分组 / `period` / `schedule` 继续负责「取哪段日志、窗口多长、多久扫一次」。

| 层 | 改哪里 | 做什么 |
|---|---|---|
| 策略页 · 告警条件 | `web/src/app/log/(pages)/event/strategy/detail/alertConditionsForm.tsx`、`conditionSelector.tsx`、`policyFormUtils.ts` | 增加 `calc_mode` 选择器；按模式露出对照窗 / 错误过滤 / 无数据开关；切换阈值单位文案。关键字与聚合共用选择器，不新增第三种 `alert_type` |
| 策略页 · 预览 | `web/src/app/log/(pages)/event/strategy/detail/logPreview.tsx` | 对比类模式展示当前值 vs 上一窗/总量，阈值线按变换后量纲画 |
| 策略页 · 基本信息 / 通知 | `basicInfoForm.tsx`、`notificationForm.tsx` | 不改 |
| 扫描取数与判定 | `server/apps/log/tasks/services/policy_scan.py` | 在 `stats` 之后按 `calc_mode` 取对照窗或比值，再比阈值；预览与扫描共用同一编译 |
| 条件落库 | `server/apps/log/models/policy.py` 的 `alert_condition` JSON；保存校验走现有 Policy serializer | `calc_mode` 及模式字段写入 `alert_condition`（或并列 `calc_config`）；缺省兼容现网 |
| 常量 | `server/apps/log/constants/alert_policy.py` | `TYPE_KEYWORD` / `TYPE_AGGREGATE` 保持；计算方式是条件字段，不是新的 `alert_type` |

不改：告警中心、LogsQL 引擎、采集/提取器。

## 6. 做什么（需求清单）

表单原则：用户选枚举，不手写 `offset` 或第二条 LogsQL。`calc_mode` 与 Monitor 产品语言对齐（`rate` / `change` / `mom`），比较对象是 LogsQL 窗口聚合结果（默认 count；数值字段见 P1）。keyword 默认仍是命中即告；选了需要数字的模式时，先对本窗 `count()` 再变换。

**可选增强（不进批次门槛，也不算告警中心）：** 自动恢复（未再命中则关域内告警）、连续触发（连续 N 个窗口才告）。现状缺失，P0 可不做；若做，挂在 Log 扫描与 Alert 生命周期上，文案不要写成告警中心屏蔽/升级。

| 批次 | 能力名 | calc_mode | 用户怎么配 | 场景 | 关键字段/行为 | 验收 |
|---|---|---|---|---|---|---|
| 已有 / 默认 | 关键字命中 | （缺省） | 查询条件 + 日志分组 + 周期；有匹配就告 | `ERROR` 关键字出现 | 现网 `TYPE_KEYWORD`；无阈值；可 `group_by` | 不改保存则扫描结果与现网一致 |
| 已有 / 默认 | 聚合绝对值 | `absolute` | 聚合规则选 count/sum/avg/max/min，比固定阈值；单级别 | 5 分钟错误日志 > 100 | 现网 `TYPE_AGGREGATE` + `rule.conditions`；`FUNCTION_LIST` = count/sum/avg/max/min | 存量打开显示固定阈值，扫描不变 |
| P0 | 日志速率 / 突增 | `change` / `rate` | 计算方式选「变化量」或「速率」；无长偏移 | 本 5 分钟错误数比上一窗多 200；日志 QPS 突增 | 相邻 `period` 窗口 Δ，或 count/period 得速率；上一窗缺失不触发；与 `mom` 不共用长偏移 | 两个选项保存值不同；预览画 Δ/rate 而非原始条数 |
| P0（可选） | 错误占比 | `ratio` | 计算方式=占比；错误侧用查询或字段过滤，总量用同一窗口去掉该过滤 | 5xx / 全量请求 > 5% | `ratio = error_count / total_count`；总量为 0 本轮不触发。错误定义用表单过滤，不手写两条 LogsQL | 保存后扫描用占比%比阈值；预览能看出错误数 vs 总数 |
| P1 | 日志量短环比 | `mom` | 计算方式=环比，对照=上一窗或上一相同长度窗口（短历史，不是 Monitor 的 1d/7d） | 当前窗口日志量比上一窗高 50% | `compare_method=percent\|ratio`；对照缺失不触发。长周期同比进 P2 | 阈值按 %/倍数命中；预览能看出「现在 vs 上一窗」 |
| P1 | 数值字段简单聚合阈值 | `absolute`（数值序列） | 选数值字段 + sum/avg/max/min + 阈值；可再套 P0 的 change/rate | `duration_ms` 均值 > 200ms | 现网 aggregate 已能做绝对值；P1 要把它收成与 Monitor 固定阈值同构的一等入口，并允许套相对变换。多条件 and/or rule 保留兼容 | 不写 LogsQL 能完成「字段聚合 vs 阈值」；套 change 时比较的是变换后的值 |
| P1（若需要） | 无数据 / 断流 | `nodata` | 计算方式=无数据；窗口内命中条数为 0（或采集实例无日志）则告 | 采集中断、流水线挂了 | 与关键字「有日志才告」相反；查询失败/超时不当成 nodata。无真实断流场景则本项只冻结不开发 | 0 条触发；有日志不触发；查询失败不误报断流 |
| P2 / 后置 | 百分位、同比、ML 异常、cardinality | `percentile` / `yoy` / `anomaly` / `cardinality` | V1 不进表单 | 延迟 P95、去年今日、智能基线、唯一 IP 数 | 百分位依赖数值字段分布，不是 count 的分位；同比需要长留存；ML 不接独立训练平台；cardinality 防高基数打爆 stats | P0/P1 不验收；启动 P2 时旧模式不回归 |

字段落库（需求级）：`calc_mode` 写入 `alert_condition`（或并列 JSON）；其余按模式使用 `compare_method` / 错误过滤 / 数值字段与聚合函数。独立列不是必须。须随策略保存，编辑能回填。

## 7. 排期

**P0 → P1 → P2。**

缺省枚举与存量兼容随 P0 做。P0 的 `change`/`rate` 是短历史双查询，打下对照缺失、比值阈值、对比预览的骨架；可选 `ratio` 同批或紧随，不依赖长偏移。P1 的短 `mom` 复用该骨架，只换文案与量纲；数值字段一等入口是表单收敛，扫描仍走现有 `stats`。`nodata` 无现场诉求则只冻结。P2 未发布模式不出现在生产表单。可选的自动恢复/连续触发可与 P0 同发或 P1 补，不挡计算方式上线。

## 8. 开放问题

| # | 问题 | 建议（未拍板） |
|---|---|---|
| 1 | 错误占比的「错误」如何定义？ | P0 用表单：复用查询条件当错误侧，总量为去掉该过滤的同窗口 count；或选 level/status 字段枚举。不做任意两条独立 LogsQL |
| 2 | `calc_mode` 是否对 keyword 也开放？ | 开放。keyword 缺省仍命中即告；选 rate/change/ratio/mom 时先 `count()` 再变换。不新增 `alert_type` |
| 3 | 短环比对照是「上一扫描窗」还是「往前平移一个 period」？ | 与 `change` 同一套：相邻等长 `period` 窗口。扫描延迟（`INGEST_DELAY_SECONDS`）两边都扣 |
| 4 | `nodata` 是否进 P1？ | 先收腰部是否真有「采集断流」工单；没有则冻结。不要把 keyword 未命中当成断流 |
| 5 | 自动恢复 / 连续触发跟哪一批？ | 默认可选、不挡 P0。若做：连续 N 窗才触发、连续 M 窗未命中则关闭域内告警。不引入告警中心状态机 |
