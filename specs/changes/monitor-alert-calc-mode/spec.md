# Monitor 策略计算方式补齐

Status: ready

本文是需求说明，供产品和研发评审。不实现功能代码，不改扫描、migration 或策略页。

## 1. 要解决什么问题

- 腰部客户配告警几乎只会写「当前值 vs 固定阈值」（如 CPU > 90%），业务一波动就误报或漏报。
- Monitor 策略页没有百分位、环比、同比、变化量、统计基线、容量预测；用户无法用表单表达「相对刚才 / 相对昨天 / 相对分布」。
- Zabbix 用 Trigger 表达式就能配 `percentile`、环比、同比、`baselinedev`、`timeleft`；我们引擎侧 MetricsQL 已能算同类函数，但策略表单未开放。
- 客户要的是一张会切换量纲的表单，不是再学一套表达式语言。

**问题陈述：** Monitor 策略页只有绝对值比较，腰部客户无法用表单配置相对变化和分布类告警。

## 2. 背景

- **产品分工：** Monitor = 判定/计算（算出可比值再比阈值，产生域内告警）；告警中心 = 屏蔽/分派/升级/认领/渠道等运营。本需求不管运营。
- **对标结论：** Zabbix 用表达式配相对/分布计算；我们用表单 `calc_mode`，底层编译 MetricsQL（或双查询），不大改架构。
- **可行性：** 现有 `query_condition → group_algorithm/algorithm → VM query_range → threshold + trigger_count/recovery` 可在「窗口聚合之后、阈值比较之前」插入变换，无需新扫描架构。

## 3. 目标

交付后，用户能在策略页选计算方式并配告警（含预览与扫描）。

| # | 成功标准 |
|---|---|
| 1 | 告警条件出现「计算方式」选择器；新建默认 `absolute` |
| 2 | 存量无 `calc_mode` 的策略按 `absolute` 扫描，行为与改前一致 |
| 3 | 每种已发布模式可保存、预览、扫描；阈值量纲随模式切换（绝对值 / % / 倍数 / Δ / 天） |
| 4 | 用户不写 PromQL 或 Zabbix 表达式 |
| 5 | 对照窗口、上一窗、同期样本缺失时不当 0 比较、不误报 |
| 6 | 非法字段组合在 API 保存期拒绝，不拖到扫描失败 |

## 4. 不做什么（非范围）

- 告警中心运营：屏蔽/维护窗、分派、升级、认领、渠道策略。
- Zabbix 表达式编辑器；普通对象不出现自由 PromQL 框。
- 复用 `PolicyInstanceBaseline` 做统计基线（该表是无数据库存，只服务无数据检测）。
- 本 PR 不写实现代码、migration、策略页 UI。

## 5. 在哪做

策略详情四段向导里，本需求只动 **定义指标** 和 **告警条件**（基本信息、通知不改）。计算方式选择器放告警条件；定义指标继续负责「取哪条序列、窗口怎么聚合」。

| 层 | 改哪里 | 做什么 |
|---|---|---|
| 策略页 · 定义指标 | `web/src/app/monitor/(pages)/event/strategy/detail/metricDefinitionForm.tsx`、`web/src/app/monitor/hooks/event.tsx`（`useMethodList`） | 百分位与现有 `algorithm` 去重，只留一个入口；`rate` / `timeleft` 给出指标约束提示 |
| 策略页 · 告警条件 | `web/src/app/monitor/(pages)/event/strategy/detail/alertConditionsForm.tsx`、`thresholdList.tsx` | 增加 `calc_mode` 选择器；按模式露出分位 / 偏移 / 基线 N / 剩余天数；切换阈值单位文案 |
| 策略页 · 预览 | `web/src/app/monitor/(pages)/event/strategy/detail/metricPreview.tsx` | 对比类模式展示当前值 vs 对照/基线/预测，阈值线按变换后量纲画 |
| 查询编译 | `server/apps/monitor/tasks/utils/policy_methods.py` | `build_policy_query` / `WINDOW_AGGREGATION_ALGORITHMS`：按 `calc_mode` 编译 MetricsQL 或双查询 |
| 扫描取数 | `server/apps/monitor/tasks/services/policy_scan/metric_query.py` | 取变换后的序列；预览与扫描共用同一编译 |
| 阈值判定 | `server/apps/monitor/tasks/utils/policy_calculate.py` | 对变换后的值做 `threshold[]` + `trigger_count` / `recovery_condition` |
| 保存校验 | `server/apps/monitor/serializers/monitor_policy.py`（字段落 `MonitorPolicy`） | 校验模式 × 字段合法性；缺省 `absolute`；写入策略模板 `config` |

不改：告警中心、Trap 表单、无数据库存表语义。

## 6. 做什么（需求清单）

表单原则：用户选枚举，不手写 `offset 1d` 或 `quantile_over_time(...)`。`trigger_count` / 恢复 / 无数据在所有模式下继续有效，比较对象改为变换后的值。公式语言 V1 不扩展，现有四则公式的**结果序列**可套 `calc_mode`。

| 批次 | 能力名 | calc_mode | 用户怎么配 | 场景 | 关键字段/行为 | 验收 |
|---|---|---|---|---|---|---|
| 默认 | 固定阈值 | `absolute` | 定义指标照旧；告警条件默认「固定阈值」，阈值仍是绝对值 | CPU 5 分钟均值 > 90% | 存量缺省即此；沿用现有 `algorithm` + `threshold[]` | 历史策略打开显示固定阈值，不改保存则扫描结果不变 |
| V1a | 百分位 | `percentile` | 计算方式=百分位，选 P90/P95/P99，阈值仍写绝对值 | 接口延迟 P95 > 200ms | `quantile ∈ {0.9,0.95,0.99}`；窗口算法走 `quantile_over_time`；V1 不做任意分位 | 保存后扫描用分位序列比阈值；非法 quantile 保存拒绝 |
| V1b | 环比 | `mom` | 计算方式=环比，对照选 1 天或 7 天，阈值改涨跌幅%或倍数 | 今日同时段流量比昨天高 50% | `compare_offset=1d\|7d`；`compare_method=percent\|ratio`；对照缺失本轮不触发（不当 0） | 阈值按 %/倍数命中；预览能看出「现在 vs 昨天/上周」 |
| V1c | 同比 | `yoy` | 与环比同一套表单，偏移改为 30 天 / 1 年；文案标明固定偏移、非自然月/年 | 今年双十一对比去年双十一 | 复用环比比较模型；V1 用固定 offset 近似日历对齐；可能超 VM 留存时保存/预览提示 | `30d` 即 30×24h；对照无数据不误报 |
| V1.1 | 变化量 / 速率 | `change` / `rate` | 计算方式选「变化量」或「速率」；无长偏移 | 本 5 分钟错误数比上一窗多 200；请求 QPS 突增 | 相邻周期 Δ，或编译 `rate`/`increase`；上一窗缺失不触发；与 `mom` 不共用 `1d` | 两个选项保存值不同；预览画 Δ/rate 而非原始水位 |
| V1.1 | 简化基线 | `baseline` | 计算方式=统计基线，选同期步进（建议 1d）和样本数 7/14，阈值用相对基线的 % 或倍数 | 当前窗口是否偏离近 7 个同期窗口 | `baseline_count` + `compare_offset`；基线= N 个同期窗口均值；样本不足一半不触发。**禁止**读写 `PolicyInstanceBaseline` | 对照点是 T-1d…T-Nd 同窗口，不是相邻周期；文案不把无数据库存叫统计基线 |
| V1.2 | 容量预测 | `timeleft` | 仅白名单指标可选；填「剩余可用时间 < N 天」 | 磁盘还能用几天 | 比较对象是预测剩余时间（天），不是当前使用率；趋势不足/非单调不触发；不接独立 ML | 非白名单无法保存；平稳序列不触发；预览给出预计耗尽或「无法预测」 |
| P2 / 后置 | 公式增强 | （不新增 calc_mode） | V1 不改公式编辑器；四则结果可套上面各模式 | 需要 `free = total - used` 一类函数时再做 | 现有公式仅 `+ - * /` 与括号；P2 才考虑有限函数枚举，仍不做表达式编辑器 | V1 不验收公式语言扩展；启动 P2 时旧四则与注入防护不回归 |

字段落库（需求级）：`calc_mode` 必有；其余按模式使用 `quantile` / `compare_offset` / `compare_method` / `baseline_count`；`timeleft` 的剩余天数复用 `threshold[].value`（单位天）。独立列或 `calc_config` JSON 实现时二选一，须写入策略模板。

## 7. 排期

**V1a → V1b → V1c → V1.1 → V1.2。**

`absolute` 随 V1a 做缺省枚举与存量兼容。V1a 只扩窗口算法、阈值语义不变；V1b 打下双查询/`offset`、比值阈值、对照缺失、对比预览的骨架，V1c 同比和 V1.1 基线都复用它；V1.1 的 `change`/`rate` 是短历史、不依赖长偏移，可与基线同批或先合；V1.2 依赖指标白名单共识，无清单则只冻结需求不开发。未发布模式不出现在生产表单。

## 8. 开放问题

| # | 问题 | 建议（未拍板） |
|---|---|---|
| 1 | VM 默认留存能否支撑同比 `1y`、基线 14×1d？ | 留存不足则 `1y` 仅长留存可见，或 V1c 先只提供 `30d` |
| 2 | 公式结果是否同期套全部 `calc_mode`？ | V1a 起公式可走 `absolute`/`percentile`；`mom` 起与单指标同步。编译过复杂则 V1 公式仅前两档 |
| 3 | 日历对齐精度：固定 offset 还是自然月/年？ | V1 固定 offset，UI 写清；自然月/年另开 |
| 4 | `timeleft` 首批白名单是哪些 `metric_id`？ | 无清单则 V1.2 不开发 |
| 5 | 百分位入口放定义指标的汇聚方式，还是告警条件的计算方式？ | 告警条件选 `percentile`，定义指标不要并排出现 AVG 与 P95 |
