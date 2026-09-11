# APM 告警策略计算方式补齐

Status: ready

本文是需求说明，供产品和研发评审。不实现功能代码，不改扫描、migration 或策略页。
与 Monitor [calc_mode 需求](https://github.com/baiyf-git/bk-lite/pull/17) 产品语言对齐，与 Log 告警计算方式需求并行；APM 作用在已有 `metric_type` 序列上，不复用 Monitor 的 MetricsQL 编译链。

## 1. 要解决什么问题

- 腰部客户配 APM 告警几乎只会写「当前窗口错误率 / P95 / 吞吐 vs 固定阈值」，流量一波动就误报或漏报。
- 策略页已有 `error_rate` / `p95` / `p99` / `throughput` / `no_traffic`，但没有变化量、短环比；用户无法用表单表达「相对刚才 / 相对上一小时」。
- 对标 Datadog APM 等用相对变化、异常检测做流量突增和时延漂移；我们扫描侧已能从 VictoriaTraces 取出 RED 序列，但表单只开放绝对值比较。
- 客户要的是一张会切换量纲的表单，不是再学一套表达式或 PromQL。

**问题陈述：** APM 策略页只有当前窗口绝对值比较，腰部客户无法用表单配置相对变化类告警。

## 2. 背景

- **产品分工：** APM = 判定/计算（取出 RED 序列，变换后再比阈值，产生域内告警）；告警中心 = 屏蔽/分派/升级/认领/渠道等运营。本需求不管运营。Monitor 同为判定/计算域，三域共用 `calc_mode` 产品语言，能力按 APM 裁剪。
- **现状（仓库事实）：** `ApmPolicy.metric_type` 仅 `error_rate / p95 / p99 / throughput / no_traffic`。窗口内 `aggregation`（avg/max/min/last）得到一个值，再比 `thresholds[]`。已有 `trigger_after` / `recover_after` 连续窗口，以及可选 `no_data_after`。策略编辑器四段：基本信息、指标定义、告警条件、通知配置；右侧预览直查 VictoriaTraces。证据：`server/apps/apm/models/control_plane.py` 的 `ApmPolicy`、`web/src/app/apm/events/policies/policy-editor.tsx`、`server/apps/apm/services/policies.py`。长期契约见 `specs/capabilities/apm-alerting.md`。
- **对标结论：** Datadog 等用相对变化 / 异常；我们用表单 `calc_mode`（与 Monitor 的 `absolute` / `change` / `mom` / `yoy` / `baseline` 同名），底层在现有 `service_red` 结果上做双窗口或比值，不大改追踪查询架构。
- **可行性：** 现有 `service_red → 窗口聚合 → 阈值比较 → trigger_after/recover_after` 可在「聚合之后、阈值比较之前」插入变换，无需新扫描架构、不引入表达式引擎。
- **与 Monitor 的裁剪：** APM 的 P95/P99 已是 `metric_type`，不要再做成 Monitor 那种 `calc_mode=percentile` 主路径。吞吐已是速率，不另开 `rate`。容量预测（`timeleft`）不做。

## 3. 目标

交付后，用户能在策略页选计算方式并配告警（含预览与扫描）。已有固定阈值、五类指标、连续触发/恢复、无数据继续可用，只强化模板与缺省兼容。

| # | 成功标准 |
|---|---|
| 1 | 告警条件出现「计算方式」选择器；新建默认 `absolute` |
| 2 | 存量无 `calc_mode` 的策略按 `absolute` 扫描，行为与改前一致 |
| 3 | 每种已发布模式可保存、预览、扫描；阈值量纲随模式切换（绝对值 / Δ / % / 倍数） |
| 4 | 用户不写 PromQL、LogsQL 或自由表达式；计算方式语言与 Monitor 一致 |
| 5 | 对照窗口、上一窗缺失时不当 0 比较、不误报 |
| 6 | 非法字段组合（含 `no_traffic` 套相对计算）在 API 保存期拒绝，不拖到扫描失败 |

## 4. 不做什么（非范围）

- 告警中心运营：屏蔽/维护窗、分派、升级、认领、渠道策略。
- 通用表达式编辑器；策略页不出现自由 PromQL / LogsQL / 公式框。
- 本 PR 不写实现代码、migration、策略页 UI。
- 同比、简化基线、ML 异常：后置到 P2，不进 P0。
- 容量预测（Monitor 的 `timeleft` 不搬到 APM）。磁盘/配额耗尽不属于本域。

## 5. 在哪做

策略编辑器四段向导里，本需求只动 **指标定义** 和 **告警条件**（基本信息、通知不改）。计算方式选择器放告警条件；指标定义继续负责「哪条服务、哪个 `metric_type`、窗口怎么聚合」。

| 层 | 改哪里 | 做什么 |
|---|---|---|
| 策略页 · 指标定义 | `web/src/app/apm/events/policies/policy-editor.tsx` 第二段 | 继续选 `metric_type` + `metric_window` + `aggregation`；P1 分位扩展（如 P90）放这里，与已有 P95/P99 去重，只留一个入口 |
| 策略页 · 告警条件 | 同上第三段（3 级别阈值、`trigger_after` / `recover_after` / 无数据） | 增加 `calc_mode` 选择器；按模式露出对照偏移 / 比较方法；切换阈值单位文案。`trigger_after` / `recover_after` / 无数据在所有模式下继续有效，比较对象改为变换后的值 |
| 策略页 · 预览 | 同上右侧「指标预览」（`previewPolicy` → `test_query`） | 对比类模式展示当前值 vs 上一窗/对照窗，阈值线按变换后量纲画；预览与扫描共用同一变换 |
| 策略页 · 基本信息 / 通知 | 第一段、第四段 | 不改 |
| 模型 | `server/apps/apm/models/control_plane.py` 的 `ApmPolicy` | 增加 `calc_mode`（及模式字段或 `calc_config`）；缺省 `absolute` |
| 保存校验 | `server/apps/apm/serializers/control_plane.py` | 校验模式 × `metric_type` × 字段合法性；非法组合保存拒绝 |
| 扫描计算 | `server/apps/apm/services/policies.py`（`test_query` / `_aggregate` / `_matching_threshold`） | 窗口聚合之后、阈值比较之前按 `calc_mode` 取对照窗或 Δ；不改 Alert/Event/快照生命周期语义 |

不改：告警中心、VictoriaTraces 存储、策略组织/处理人、告警指标快照结构（快照仍记录变换后用于比较的值）。

## 6. 做什么（需求清单）

表单原则：用户选枚举，不手写 `offset` 或第二条追踪查询。`calc_mode` 作用在已选 `metric_type` 序列上，不新增第三套指标类型。`trigger_after` / `recover_after` / 无数据在所有已发布模式下继续有效。

已有能力只强化模板（文案、缺省、预览量纲），不重做扫描状态机。

| 批次 | 能力名 | calc_mode 或扩展点 | 用户怎么配 | 场景 | 关键字段/行为 | 验收 |
|---|---|---|---|---|---|---|
| 已有 / 默认 | 固定阈值 | `absolute` | 指标定义选 `metric_type` 与汇聚；告警条件默认「固定阈值」，阈值仍是绝对值 | 5 分钟错误率 > 5%；P95 > 200ms | 存量缺省即此；沿用现有 `aggregation` + `thresholds[]` | 历史策略打开显示固定阈值，不改保存则扫描结果不变 |
| 已有 | 错误率 / P95 / P99 / 吞吐 | `metric_type`（非 calc_mode） | 指标里选错误率、P95、P99 或吞吐 | RED 水位告警 | 枚举不变；P95/P99 已是追踪分位，不要再做成 `calc_mode=percentile` | 现网五类指标仍可配、可预览、可扫描 |
| 已有 | 无流量 | `metric_type=no_traffic` | 指标选无流量；按吞吐是否为 0 判定 | 服务/端点突然没流量 | 只走 `absolute`；禁止套 `change`/`mom` | 保存相对计算时拒绝；现网无流量策略行为不变 |
| 已有 | 连续触发 / 恢复 | `trigger_after` / `recover_after` | 连续 N 个汇聚周期满足才告、连续 M 个不满足才恢复 | 抗毛刺 | 比较对象改为变换后的值；次数语义不变 | 相对模式下仍按连续次数触发/恢复 |
| 已有 | 无数据 | `no_data_after` | 连续若干周期无样本则按所选级别告 | VictoriaTraces 窗口无样本 | 查询失败不当成无数据；对照缺失走「不触发」，不走无数据 | 无数据与对照缺失文案分开；现网无数据策略不回归 |
| P0 | 变化量 | `change` | 计算方式=变化量；无长偏移。作用在已选 `error_rate` / `p95` / `p99` / `throughput` 序列上 | 本 5 分钟错误率比上一窗高 3 个百分点；吞吐比上一窗多 200 req/s | 相邻 `metric_window` 的 Δ；`compare_method=delta\|percent`；上一窗缺失本轮不触发（不当 0）。与 `mom` 不共用 `1d` | 保存值为 `change`；预览画 Δ 而非原始水位；对照缺失不误报 |
| P0 | 短环比 | `mom` | 计算方式=环比，对照选上一窗 / 1h / 1d（APM 短历史，不是 Monitor 默认的 7d） | 当前小时错误率比上一小时高 50%；今日同时段吞吐比昨天高 1 倍 | 复用 Monitor 环比产品语言：`compare_offset` + `compare_method=percent\|ratio`；对照缺失不触发。7d/更长进 P2 同比侧 | 阈值按 %/倍数命中；预览能看出「现在 vs 对照窗」 |
| P1 | 更灵活分位或场景化延迟 | `metric_type` 扩展（如 `p90`）或场景模板 | 指标多一个 P90；或选「关键接口延迟」一类场景，仍落到端点 + 分位 + 阈值 | 登录 P90 > 300ms；结账 P95 > 200ms | 分位仍是取哪条延迟序列，不是 `calc_mode`。场景化只是预填端点/分位/阈值，不开放表达式。可再套 P0 的 `change`/`mom` | 能不写查询配 P90 或场景延迟；与现有 P95/P99 不并排出两套分位入口 |
| P2 / 后置 | 同比 | `yoy` | 与环比同一套表单，偏移改为 30 天；文案标明固定偏移 | 今年大促对比去年同期延迟 | 复用 `mom` 比较模型；可能超 VictoriaTraces 留存时保存/预览提示 | P0/P1 不验收；对照无数据不误报 |
| P2 / 后置 | 简化基线 | `baseline` | 计算方式=统计基线，选同期步进和样本数 7/14，阈值用相对基线的 % 或倍数 | 当前窗口是否偏离近 7 个同期窗口 | `baseline_count` + `compare_offset`；样本不足一半不触发。不接独立训练平台，也不复用 Monitor 无数据库存表 | 对照点是同期窗口，不是相邻周期 |
| P2 / 后置 | ML 异常 | `anomaly` | 计算方式=异常检测，选灵敏度；少旋钮 | Datadog Watchdog 一类「这不像平时」 | 简化异常分数或相对基线的产品化包装；不引入独立 ML 平台、不让用户训模型 | P0/P1 不验收；启动 P2 时旧 `absolute`/`change`/`mom` 不回归 |

字段落库（需求级）：`calc_mode` 必有，缺省 `absolute`。其余按模式使用 `compare_offset` / `compare_method` / `baseline_count`。独立列或 `calc_config` JSON 实现时二选一，须随 `ApmPolicy` 保存，编辑能回填。快照与预览展示变换后的比较值。

## 7. 排期

**已有强化（随 P0）→ P0 `change` → P0 `mom` → P1 → P2。**

`absolute` 与五类 `metric_type`、`trigger_after` / `recover_after`、无数据随 P0 做缺省枚举与存量兼容，只强化模板。P0 的 `change` 是短历史双查询，打下对照缺失、Δ/% 阈值、对比预览的骨架；同批的短 `mom` 复用它，只换偏移与量纲。P1 只扩展延迟序列或场景预填，不改计算方式骨架。P2 的同比/基线复用 `mom` 对照模型；ML 异常依赖基线共识，无方案则只冻结需求不开发。未发布模式不出现在生产表单。

## 8. 开放问题

| # | 问题 | 建议（未拍板） |
|---|---|---|
| 1 | 短环比对照枚举是上一窗 / 1h / 1d，要不要 7d？ | P0 只提供短对照；7d 等长偏移并入 P2，避免与 Monitor 环比表单绑死 |
| 2 | `change`/`mom` 是否对 `no_traffic` 开放？ | 不开放。无流量是「有没有请求」的绝对判定；相对计算保存期拒绝 |
| 3 | P1 做 `p90` 枚举，还是场景化延迟模板？ | 先加 `p90`（与 P95/P99 同构）；场景模板只是预填，不新增查询语言 |
| 4 | VictoriaTraces 留存能否支撑 P2 同比 `30d`？ | 查询窗现状约 35 天；留存不足则同比只冻结或仅长留存可见 |
| 5 | P2 异常检测先做简化基线，还是直接上异常分数？ | 先 `baseline`，`anomaly` 作为同一产品入口的灵敏度包装；不接独立 ML 平台 |
