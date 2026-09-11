# Monitor 告警策略 - 计算方式补齐

Status: ready

> 文档类型：需求说明，供产品 / 研发评审。  
> 本文不实现业务功能，不改 Monitor 扫描、migration 或策略页代码。  
> 对标分析见 PR [#15](https://github.com/baiyf-git/bk-lite/pull/15) `docs/design-docs/monitor-vs-zabbix-alert-strategy-gap.md`。

## 1. 背景与目标

### 1.1 产品路线

Monitor 负责**判定 / 计算**：根据指标序列算出一个可比的值，再与阈值、连续触发、恢复条件比较，产生域内告警。

告警中心负责**运营**：屏蔽 / 维护、分派、升级、认领、渠道策略。本需求不覆盖运营能力。边界见 ADR 0004（领域 App 拥有自身告警生命周期）。

### 1.2 客户与对标

- **客户**：腰部客户。配置必须**表单化**，不要做成 Zabbix 表达式编辑器。
- **对标**：Zabbix 的同比 / 环比 / 百分位写在 Trigger Expression 里，用 `time_shift`、`trendavg`、`percentile` 等函数拼。我们不抄这条路径。
- **我们的做法**：策略表单选 `calc_mode`，后端把表单编译成 MetricsQL（或双查询），复用现有扫描链路。

### 1.3 可行性结论

可在现有链路实现，**无需大改架构**。

现有链路：

```text
query_condition
  → group_algorithm / algorithm(*_over_time)
  → VictoriaMetrics query_range
  → threshold[] + trigger_count / recovery_condition
```

关键文件（实现时的落点，本文不改）：

| 环节 | 路径 |
|---|---|
| 查询编译 | `server/apps/monitor/tasks/utils/policy_methods.py`（`build_policy_query` / `WINDOW_AGGREGATION_ALGORITHMS`） |
| 扫描取数 | `server/apps/monitor/tasks/services/policy_scan/metric_query.py` |
| 阈值判定 | `server/apps/monitor/tasks/utils/policy_calculate.py` |
| 预览 | `server/apps/monitor/services/policy_preview.py` |
| 策略页 | `web/src/app/monitor/(pages)/event/strategy/detail/` |

看板查询白名单已包含 `quantile_over_time`、`rate`、`predict_linear` 等函数；策略 `algorithm` 枚举尚未开放。引擎侧「能写 PromQL」不等于策略能配。

### 1.4 目标

在 Monitor 策略页补齐一整套 **计算方式（`calc_mode`）**，让腰部客户用表单配出：

1. 固定阈值（现状，默认）
2. 百分位
3. 环比
4. 同比
5. 变化量 / 速率
6. 简化统计基线
7. 容量预测（场景化）

公式语言增强（不止四则）列为后续，不作为 V1 必达。

## 2. 范围 / 非范围

### 2.1 范围

| 纳入 | 说明 |
|---|---|
| `calc_mode` 表单 + 编译 | 用户选计算方式，系统编译 MetricsQL 或双查询 |
| 固定阈值 `absolute` | 现状能力收口为默认 `calc_mode`，存量策略兼容 |
| 百分位 `percentile` | 扩展窗口算法（如 `quantile_over_time` / P90 P95 P99） |
| 环比 `mom` | `compare_offset` 默认 `1d` / `7d` |
| 同比 `yoy` | 更长 offset；日历对齐 V1 用固定 offset 近似 |
| 变化量 / 速率 `change` / `rate` | 相邻周期 Δ 或单位时间速率 |
| 简化统计基线 `baseline` | 近 N 个同期；**禁止**复用 `PolicyInstanceBaseline` |
| 容量预测 `timeleft` | 剩余可用时间 &lt; N 天；可先指标白名单 |
| 预览 | 对比类模式必须能看到当前值与对照值 |
| 存量兼容 | 无 `calc_mode` 的策略按 `absolute` 扫描，行为不变 |
| 公式结果上的计算方式 | 现有四则公式产出的序列，V1 起可套用 `calc_mode`（与单指标同一套） |

### 2.2 非范围（明确不做）

**告警中心运营（本需求一律不覆盖）：**

- 屏蔽 / 维护窗
- 分派 / 转派 / 认领
- 通知升级链
- 渠道策略（活跃时段、按级别选渠道）
- 根因压制 / 触发器依赖

**产品形态禁止项：**

- 不要做成 Zabbix 表达式编辑器。普通对象不出现自由 PromQL 框。
- 不要把 `PolicyInstanceBaseline`（无数据库存）当成统计基线实现。
- 不要为此新建独立基线存储或离线训练任务。

**本需求后置或另开：**

- 公式语言增强（函数、一元负号、比较 / 逻辑）——P2，见 §5.8
- Trap 策略补齐告警条件表单
- 独立恢复表达式、永不自动恢复
- 无数据检测窗口与恢复窗口拆开
- 编辑保存强制 `enable=true` 等策略页既有缺陷
- 告警中心投影语义、IM 失败重试

## 3. 现状与缺口

### 3.1 策略页现有四段

策略详情 `web/src/app/monitor/(pages)/event/strategy/detail/page.tsx` 现为四段向导：

| 段 | 组件 | 现在配什么 |
|---|---|---|
| 基本信息 | `basicInfoForm.tsx` | 名称、组织、目标实例、执行周期、启用 |
| 定义指标 | `metricDefinitionForm.tsx` | 插件 / 指标或四则公式、过滤、`group_by`、`group_algorithm`、汇聚周期 `period`、窗口算法 `algorithm` |
| 告警条件 | `alertConditionsForm.tsx` | 多级 `threshold[]`、`trigger_count`、`recovery_condition`、无数据 |
| 通知 | `notificationForm.tsx` | 处理人、渠道、通知人 |

**缺口：没有 `calc_mode`。** 告警条件默认把「窗口聚合后的绝对值」直接和阈值比。用户无法在表单里选百分位、环比、同比、变化量、统计基线或容量预测。

### 3.2 现有计算能力（仓库事实）

| 能力 | 现状 |
|---|---|
| 窗口聚合 `algorithm` | 表单仅 `sum/max/min/avg/count/last_over_time`（`useMethodList`） |
| 分组聚合 `group_algorithm` | `avg/max/min/sum/count` |
| 阈值 | `> < = != >= <=`，多级 warning/error/critical |
| 连续触发 / 恢复 | `trigger_count` / `recovery_condition` |
| 公式 | `query_condition.type=formula`，仅 `+ - * /` 与括号 |
| 枚举指标 | 非公式可用 `=` / `≠` 状态下拉；公式模式关闭枚举 |
| 预览 | `PolicyPreviewService` 实查 VM，画阈值线 |
| 无数据库存 | `PolicyInstanceBaseline`：策略见过的维度组合，**不是**统计基线 |

### 3.3 与新能力的关系

`absolute` **不是新功能**，是把现状显式命名为默认计算方式。后续模式都建立在「先算出窗口值，再按 `calc_mode` 变换，再进 `threshold[]`」之上。`trigger_count` / `recovery_condition` / 无数据在所有模式下继续有效，比较对象改为变换后的值。

## 4. 需求明细（按优先级）

| 优先级 | `calc_mode` | 能力 | 核心字段 | 阈值语义 | 相对现状 |
|---|---|---|---|---|---|
| 已有 / 默认 | `absolute` | 固定阈值 | 沿用 `algorithm` + `threshold[]` | 与窗口聚合值同量纲比较 | 存量即此；缺省补 `absolute` |
| V1a | `percentile` | 百分位 | 扩展 `algorithm`（`quantile_over_time`）+ `quantile`（P90/P95/P99） | **不变**：仍对算出的分位值做绝对值比较 | 引擎白名单已有函数，策略枚举未开放 |
| V1b | `mom` | 环比 | `compare_offset`：`1d` / `7d` | 涨跌幅 % 或倍数 | 双查询或 `offset` |
| V1c | `yoy` | 同比 | 同模型，更长 `compare_offset`（如 `30d` / `1y`） | 同环比 | 依赖 VM 留存；日历对齐 V1 用固定 offset 近似 |
| V1.1 | `change` / `rate` | 变化量 / 速率 | 相邻周期，无长 offset | Δ 或单位时间速率 | 编译 `delta` / `increase` / `rate` 或双窗口相减 |
| V1.1 | `baseline` | 简化统计基线 | 近 N 个同期（`baseline_count` + 同期 offset） | 相对基线的偏差 % 或倍数 | **禁止**复用 `PolicyInstanceBaseline` |
| V1.2 | `timeleft` | 容量预测 | 剩余时间阈值（天）+ 指标白名单 | 预测剩余可用时间 &lt; N 天 | 场景化，可先磁盘 /  inode 等白名单 |
| P2 | （公式增强） | 公式不止四则 | 现有 `query_condition.type=formula` 语言扩展 | 不改变 `calc_mode` 本身 | V1 **非必达**，见 §5.8 |

排期顺序见 §9：V1a → V1b → V1c → V1.1（变化量 + 基线）→ V1.2（容量预测，可选公式）。

## 5. 使用场景 + 使用方式（按能力）

每条能力统一说明：场景、使用方式、落在现有哪一段、验收点。

表单总原则：

- **定义指标**继续负责「取哪条序列、窗口怎么聚合」。
- **告警条件**新增「计算方式」选择器；按 `calc_mode` 露出 `quantile` / `compare_offset` / 基线 N / 剩余天数，并切换阈值量纲文案。
- **基本信息、通知**本需求不改。
- 不要让用户手写 `offset 1d` 或 `quantile_over_time(0.95, ...)`。

### 5.1 固定阈值 `absolute`（默认）

**场景**

CPU 使用率最近 5 分钟平均值 &gt; 90%；磁盘使用率 last &gt; 85%。这是今天所有策略的写法。

**使用方式**

1. 定义指标：选指标（或四则公式）、`period`、`group_algorithm`、`algorithm`（现有 SUM/MAX/MIN/AVG/COUNT/LAST_OVER_TIME）。
2. 告警条件：计算方式默认「固定阈值」；阈值仍是绝对值，单位沿用 `threshold_unit`。
3. 连续触发 / 恢复 / 无数据与现在一致。

**落点**

| 层 | 改动 |
|---|---|
| 模型 `MonitorPolicy` | 新增 `calc_mode`，缺省 / 存量 = `absolute` |
| 策略页 · 告警条件 | 增加计算方式下拉，默认选中固定阈值；其余控件不变 |
| 扫描 / 预览 | `absolute` 走现有 `build_policy_query`，行为零回归 |

**验收点**

- 未选计算方式的历史策略打开后显示「固定阈值」，不修改直接保存，扫描结果与改前一致。
- 新建策略默认 `absolute`。
- 枚举指标只允许 `absolute`（状态下拉），其它 `calc_mode` 不可选或保存拒绝。

### 5.2 百分位 `percentile`（V1a）

**场景**

接口延迟不能只看均值：P95 / P99 超阈值才告警。Zabbix 用 `percentile`；我们把窗口算法扩成 `quantile_over_time`。

**使用方式**

1. 定义指标：仍选指标、过滤、分组、汇聚周期。窗口算法在此模式下由系统使用 `quantile_over_time`（用户不必手选现有 AVG/MAX 列表，或列表内出现 P90/P95/P99）。
2. 告警条件：计算方式 = 百分位；分位枚举 **P90 / P95 / P99**（对应 `quantile` 0.9 / 0.95 / 0.99）。V1 不做任意分位输入。
3. 阈值语义**不变**：对分位计算结果做绝对值比较（如 P95 延迟 &gt; 200ms）。连续触发 / 恢复沿用。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=percentile`，`quantile ∈ {0.9, 0.95, 0.99}` |
| `WINDOW_AGGREGATION_ALGORITHMS` / `useMethodList` | 增加 `quantile_over_time`（或 calc_mode 锁定该算法） |
| 策略页 · 定义指标 | 百分位模式下汇聚方式展示 P90/P95/P99，或隐藏原算法改由告警条件选分位；二者只留一个入口，避免双份 |
| 策略页 · 告警条件 | 计算方式 = 百分位；阈值单位仍是指标量纲 |
| 预览 | 序列为分位值，阈值线按绝对值画 |

**验收点**

- 可选 P90/P95/P99，保存后扫描用 `quantile_over_time`。
- 阈值比较的是分位值，不是均值；同一批数据上 P99 策略应不弱于 P90 策略的灵敏度方向符合预期。
- 非法 `quantile` 或非百分位模式带 `quantile`：API 拒绝。
- 预览能看到分位序列和阈值线。

### 5.3 环比 `mom`（V1b）

**场景**

今日同时段流量比昨天高 50%；本周一错误数比上周一翻倍。Zabbix 用 `avg(..., 1h:now-1d)`；我们用 `compare_offset`。

**使用方式**

1. 定义指标：照常配置当前窗口序列（`period` + `algorithm`）。
2. 告警条件：计算方式 = 环比；对照偏移枚举 **1 天 / 7 天**（`compare_offset=1d|7d`）。
3. 阈值量纲切换为 **涨跌幅 %** 或 **倍数**（表单二选一，默认涨跌幅 %）：
   - 涨跌幅：`(当前 - 对照) / 对照 * 100`，例如 &gt; 20 表示上涨超过 20%。
   - 倍数：`当前 / 对照`，例如 &gt; 2 表示翻倍。
4. 对照窗口无数据：本轮该维度不触发阈值告警（不把空对照当 0）；可走无数据逻辑的仍只针对**当前窗口**。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=mom`，`compare_offset`，阈值比较器类型（% / 倍数，见 §6） |
| 扫描 | 双 `query_range` 或 MetricsQL `offset`；按维度对齐后算比 |
| 策略页 · 告警条件 | 露出偏移、阈值量纲文案（% 或倍）；隐藏与绝对值单位冲突的 `threshold_unit` 或改为 %/倍 |
| 预览 | **必须同时展示当前序列与对照序列**（或比值序列 + 对照），不能只画当前值 |

**验收点**

- `1d` / `7d` 可选；保存后扫描使用对应偏移。
- 阈值按 % 或倍数命中，不再用原指标单位。
- 对照缺失不误报「下跌 100%」。
- 预览能看出「现在 vs 昨天/上周」。
- `trigger_count` 连续作用在变换后的比值上。

### 5.4 同比 `yoy`（V1c）

**场景**

今年双十一 GMV 对比去年双十一；本月 1 号磁盘增量对比上月 1 号。模型与环比相同，偏移更长。

**使用方式**

1. 与环比同一套表单：计算方式 = 同比。
2. `compare_offset` 提供更长档：**30 天 / 1 年**（产品文案可写「上月 / 去年」；V1 **用固定 offset 近似日历对齐**，不实现 `now/M-1M`）。
3. 阈值同样是涨跌幅 % 或倍数。
4. 创建 / 保存时，若偏移可能超过平台 VictoriaMetrics 留存，给出明确提示（留存天数作为开放问题，见 §10）。对照无数据则本轮不按同比触发。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=yoy`，复用 `compare_offset` 与环比阈值语义 |
| 扫描 / 预览 | 与 `mom` 同一编译路径，仅默认偏移不同 |
| 策略页 · 告警条件 | 同比的偏移选项与环比区分；文案标明「固定偏移，非日历月/年」 |

**验收点**

- 与环比共用比较模型，互切时字段校验正确（`mom` 不允许 `1y` 等超范围值，或按枚举各自限制）。
- 固定 offset 行为可测：`30d` 就是 30×24h，不是「上个自然月」。
- 对照超出留存或无数据：不误报，预览 / 保存有提示。
- 预览展示当前 vs 对照。

### 5.5 变化量 / 速率 `change` / `rate`（V1.1）

**场景**

- **变化量 `change`**：相邻汇聚周期计数突增（本 5 分钟错误数比上一 5 分钟多 200）。
- **速率 `rate`**：计数器型指标的单位时间增速（请求速率、流量速率）。

二者都是「相对最近历史」，不需要 `1d/7d` 长偏移。

**使用方式**

1. 定义指标：选指标与 `period`。`change` 仍用窗口聚合值做相邻差；`rate` 对计数器编译 `rate` / `increase`（实现选 MetricsQL 函数，表单不暴露函数名）。
2. 告警条件：计算方式 = 变化量 或 速率。无 `compare_offset`。
3. 阈值：
   - `change`：相邻窗口 Δ（当前窗口值 − 上一窗口值），量纲与指标相同或「每周期」。
   - `rate`：每秒（或每周期）变化率，量纲为「原单位 / 时间」。
4. 上一窗口缺失：本轮不触发（与环比对照缺失一致）。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=change` 或 `rate` |
| 定义指标 | `rate` 模式下可限制适用于计数器 / 累加型指标（或文案提示）；`change` 适用于水位和计数 |
| 告警条件 | 阈值文案随模式切换；不出现环比偏移 |
| 预览 | 画 Δ 或 rate 序列，而不是原始水位（可附原始值参考） |

**验收点**

- `change` 与 `rate` 是两个明确选项，保存值不同。
- 相邻窗口有值时 Δ / rate 计算正确；缺上一窗不误报。
- 与 `mom` 不混淆：变化量不用 `1d` offset。
- 预览与扫描使用同一编译结果。

### 5.6 简化统计基线 `baseline`（V1.1）

**场景**

「现在是否显著偏离最近若干个**同期**窗口」：例如当前 5 分钟均值，对比过去 7 个同一星期几、同一小时的窗口。这是腰部客户要的「有没有异常」，不是机器学习基线。

Zabbix 对应 `baselinedev` / `trendavg`。我们做**近 N 个同期的统计对照**（默认均值；V1 不做标准差多档）。

**禁止**

`PolicyInstanceBaseline` 只记录「这个策略见过哪些维度组合」，用于无数据检测。统计基线**不得**读写该表，不得借用其模型名在产品文案里叫「基线库存」。

**使用方式**

1. 定义指标：当前窗口序列配置同 `absolute`。
2. 告警条件：计算方式 = 统计基线。
   - 同期定义：与当前窗口对齐的历史窗口，步进 = `compare_offset`（V1 建议 `1d`，即「过去 N 天的同一汇聚时刻」）。
   - 样本数 `baseline_count`：默认 7，可选 7 / 14（表单枚举，避免任意大 N 打爆 VM）。
   - 基线值 = 这 N 个同期窗口聚合值的均值。
   - 阈值：相对基线的涨跌幅 % 或倍数（与环比同一套阈值语义）。
3. 有效同期样本不足（例如不足 N 的一半）：本轮该维度不触发，预览提示样本不足。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=baseline`，`baseline_count`，同期 `compare_offset` |
| 扫描 | N 次偏移查询或一次范围查询再抽样；**不**写新库存表 |
| 无数据 | 继续只用 `PolicyInstanceBaseline` |
| 告警条件 | 露出 N、同期偏移、偏差阈值 |
| 预览 | 展示当前值、基线值（或带状范围）、偏差 |

**验收点**

- 代码与产品文案均不把 `PolicyInstanceBaseline` 当统计基线。
- N=7、offset=1d 时，对照点是 T-1d … T-7d 的同窗口聚合，不是最近 7 个相邻周期（那是 `change`）。
- 样本不足不误报。
- 预览能看到当前 vs 基线。

### 5.7 容量预测 `timeleft`（V1.2，场景化）

**场景**

磁盘还能用几天？inode 多久耗尽？只覆盖「单调上升、有容量上限」的指标，不是通用预测平台。Zabbix 有 `timeleft` / `forecast`。

**使用方式**

1. 定义指标：仅允许**白名单指标**（V1.2 建议：文件系统使用量 / 使用率、inode；具体列表评审时冻结）。非白名单指标不出现该计算方式。
2. 告警条件：计算方式 = 容量预测。
   - 用户填「剩余可用时间 &lt; N 天」（N 表单输入，单位天）。
   - 系统用近期趋势估计到达上限（使用率 100%，或容量指标达到已知 total）的时间。
   - 阈值比较对象是**预测剩余秒/天**，不是当前使用率。
3. 趋势不足、非单调、无法估计：不触发，预览说明原因。

**落点**

| 层 | 改动 |
|---|---|
| 模型 | `calc_mode=timeleft`，剩余天数阈值（可复用 `threshold[]`，量纲为天） |
| 指标目录 | 白名单（策略保存时校验 `metric_id`） |
| 扫描 | 编译 `predict_linear` 一类函数，再换算剩余时间；不引入新 ML 服务 |
| 预览 | 展示当前用量、拟合趋势、预计耗尽时间 |

**验收点**

- 非白名单指标无法保存 `timeleft`。
- 「剩余 &lt; 3 天」在可拟合的上升序列上触发；平稳 / 下降序列不触发。
- 不把当前使用率 &gt; 80% 误当成 timeleft（那是 `absolute`）。
- 预览给出预计耗尽时间或「无法预测」。

### 5.8 公式增强（P2 / 后置，非 V1 必达）

**现状**

`query_condition.type=formula` 只支持 `+ - * /` 与括号；至少两个不同变量；禁止一元负号；锚点 `group_by` 必须含 `instance_id`。这是有意安全边界。

**本需求中的位置**

- V1：**不扩展公式语言**。现有四则公式的**结果序列**可以套用 `calc_mode`（固定阈值 / 百分位 / 环比等），与单指标相同。
- P2（可选后续）：公式内允许函数、一元负号、更多运算。必须同时保住现有注入防护（见 `specs/capabilities/monitor-alert-formula-testing.md`）。
- **仍然不要**做成 Zabbix 表达式编辑器：函数如果开放，也是公式编辑器内的有限枚举，不是 Trigger Expression 自由文本。

**验收（仅当启动 P2 时）**

- 非法字符 / 注入仍在保存期拒绝。
- 旧四则策略不回归。

V1 交付不验收公式语言扩展。

## 6. 与现有字段映射

### 6.1 沿用字段（语义基本不变）

| 字段 | 所在段 | 本需求中的角色 |
|---|---|---|
| `query_condition` | 定义指标 | 仍描述取数：`metric` / `formula` /（Trap）`pmq`。`calc_mode` **不**写进自由 PromQL |
| `period` | 定义指标 | 当前窗口长度；环比 / 同比 / 基线的「窗口」仍用它 |
| `algorithm` | 定义指标 | 窗口聚合。`absolute` 用现有枚举；`percentile` 扩展 / 锁定 `quantile_over_time`；`rate` 可能改编译，但表单不让用户写函数名 |
| `group_algorithm` / `group_by` | 定义指标 | 分组聚合不变，先 group 再窗口（现有两段查询） |
| `threshold[]` | 告警条件 | 结构仍是 `{level, method, value}`；**value 的量纲随 `calc_mode` 变** |
| `trigger_count` | 告警条件 | 连续多少个**变换后的点**满足阈值 |
| `recovery_condition` | 告警条件 | 连续多少个变换后的点不满足则恢复 |
| 无数据相关字段 | 告警条件 | 仍针对当前窗口有没有点；对照缺失 ≠ 无数据 |

### 6.2 新增字段

| 字段 | 适用 `calc_mode` | 建议形态 | 说明 |
|---|---|---|---|
| `calc_mode` | 全部 | 枚举字符串，默认 `absolute` | `absolute` / `percentile` / `mom` / `yoy` / `change` / `rate` / `baseline` / `timeleft` |
| `quantile` | `percentile` | `0.9` / `0.95` / `0.99` | 与 P90/P95/P99 对应 |
| `compare_offset` | `mom` / `yoy` / `baseline` | 时长串，如 `1d` `7d` `30d` `1y` | 环比、同比、基线同期步进 |
| `compare_method` | `mom` / `yoy` / `baseline` | `percent` / `ratio` | 阈值是涨跌幅 % 还是倍数 |
| `baseline_count` | `baseline` | 正整数枚举 7 / 14 | 同期样本数 |
| 剩余时间 | `timeleft` | 复用 `threshold[].value`，单位天 | 不必再拆字段，但 UI 文案必须是「剩余天数」 |

字段落库位置（需求级）：优先作为 `MonitorPolicy` 列或一个 JSON 配置块（如 `calc_config`），评审时二选一。无论哪种，**序列化进策略模板 `PolicyTemplate.config`**，以便保存模板 / 批量应用。

### 6.3 模式 × 字段合法性

| `calc_mode` | `algorithm` | `quantile` | `compare_offset` | `compare_method` | `baseline_count` | 阈值量纲 |
|---|---|---|---|---|---|---|
| `absolute` | 现有窗口枚举 | 忽略 | 忽略 | 忽略 | 忽略 | 指标 / `threshold_unit` |
| `percentile` | `quantile_over_time` | 必填 | 忽略 | 忽略 | 忽略 | 同 `absolute` |
| `mom` | 现有窗口枚举 | 忽略 | `1d` / `7d` | 必填 | 忽略 | % 或倍数 |
| `yoy` | 现有窗口枚举 | 忽略 | 更长档 | 必填 | 忽略 | % 或倍数 |
| `change` | 现有窗口枚举 | 忽略 | 忽略 | 忽略 | 忽略 | Δ（原量纲 / 每周期） |
| `rate` | 由编译决定 | 忽略 | 忽略 | 忽略 | 忽略 | 原单位 / 时间 |
| `baseline` | 现有窗口枚举 | 忽略 | 同期步进 | 必填 | 必填 | % 或倍数 |
| `timeleft` | 由编译决定 | 忽略 | 忽略 | 忽略 | 忽略 | 天 |

非法组合在 **API 保存期拒绝**，不要落到扫描才失败。

### 6.4 策略页四段改动一览

| 段 | V1 是否改 | 内容 |
|---|---|---|
| 基本信息 | 否 | — |
| 定义指标 | 小改 | 百分位入口与 `algorithm` 去重；`rate` / `timeleft` 的指标约束提示；公式结果可套 `calc_mode` |
| 告警条件 | **主改** | `calc_mode` 选择器及随模式出现的 `quantile` / 偏移 / N / 剩余天数；阈值文案与单位 |
| 通知 | 否 | — |
| 预览（右侧） | 是 | 对比类模式展示当前 vs 对照 / 基线 / 预测 |

## 7. 技术方案要点（需求级，非详细设计）

1. **最小改动**  
   继续走 `query_condition → group_algorithm/algorithm → VM query_range → threshold + trigger_count/recovery`。`calc_mode` 只插入在「窗口聚合之后、阈值比较之前」的编译层（`build_policy_query` / `MetricQueryService` / `PolicyPreviewService` 共用同一编译，避免预览与扫描分叉）。

2. **表单编译，不开放表达式编辑器**  
   用户选枚举；后端生成 MetricsQL 或双查询。普通对象仍然没有自由 PromQL 框。Trap `pmq` 不在本需求展开。

3. **环比 / 同比 / 基线用双查询或 `offset`**  
   需求不规定唯一实现。必须按 `group_by` 维度对齐；对照缺失不得当 0。基线是多次同期 offset，不是相邻窗口滑动。

4. **禁止复用 `PolicyInstanceBaseline`**  
   该表继续只服务无数据。统计基线现场查 VM。

5. **公式与枚举限制**  
   - 公式语言 V1 不扩展。  
   - 公式**结果**可以套 `calc_mode`。  
   - 枚举指标仅 `absolute`。  
   - `timeleft` 仅白名单指标。

6. **预览必须能看对比结果**  
   `mom` / `yoy` / `baseline` 预览至少包含当前值与对照（或偏差）；`timeleft` 含预计耗尽时间或失败原因；`percentile` / `change` / `rate` 预览序列必须是变换后的值。阈值线按变换后量纲绘制。

7. **存量兼容**  
   `calc_mode` 为空视为 `absolute`。不强制数据迁移改写旧行。模板保存开始带上新字段。

8. **不做的架构**  
   不为基线建时序宽表、不为预测接独立算法服务、不把计算下沉到告警中心。

## 8. 验收标准

下列为跨版本总验收；各能力细则见 §5。实现 PR 按 §9 分批交付、分批验收。

### 8.1 产品

- 策略页告警条件可选择完整 `calc_mode` 集合（按已发布版本露出对应项，未发布项不可选）。
- 每种已发布模式都有：场景可配通、阈值文案正确、预览能解释「比的是什么」。
- 用户无需编写 PromQL / Zabbix 表达式。
- 文案上「基线」只指统计基线，与无数据库存区分。

### 8.2 兼容

- 存量策略（无 `calc_mode`）扫描、预览、编辑保存后仍按固定阈值工作。
- `trigger_count` / `recovery_condition` / 无数据在新模式下仍生效，且比较对象是变换后的值。
- 策略模板能保存并回放新字段。

### 8.3 正确性

- 对照 / 上一窗 / 同期样本缺失：不按 0 比较、不误报。
- `mom`/`yoy`/`baseline` 的 % 与倍数两种阈值语义可测。
- `percentile` 阈值仍是绝对值。
- `timeleft` 只对白名单生效，比较的是剩余时间。
- 非法字段组合保存失败。

### 8.4 回归

- 现有单指标、四则公式、枚举阈值、Trap 路径不因本需求破坏（Trap 仍维持现状即可）。
- 无数据检测仍只依赖 `PolicyInstanceBaseline` 库存语义。

### 8.5 交付形态

- 本文是需求文档。验收实现时另开功能 PR；本 PR **仅文档**。

## 9. 排期建议

| 批次 | 内容 | 原因 |
|---|---|---|
| **V1a** | `percentile` | 只扩 `algorithm` / `quantile_over_time`，阈值语义不变，风险最低，立刻补齐「引擎能算、表单不能配」 |
| **V1b** | `mom` | 建立双查询 / `offset`、比值阈值、对照缺失、对比预览；同比和基线都复用这条骨架 |
| **V1c** | `yoy` | 同模型换长偏移；可并行核对 VM 留存与文案（固定 offset ≠ 日历） |
| **V1.1** | `change` + `rate` + `baseline` | 变化量 / 速率是短历史；基线是 N 个同期，复用 V1b 对照对齐。建议同一批次，但可先合 change/rate |
| **V1.2** | `timeleft`（+ 可选公式增强） | 场景化白名单；公式语言增强可选、非阻塞。无白名单共识则只出文档冻结指标列表 |

`absolute` 随 V1a 做缺省枚举与存量兼容，不单独占批次。

未发布的 `calc_mode` 不要出现在生产表单中（或灰度为即将发布的下一批）。

## 10. 开放问题

评审时需要拍板或记为假设：

1. **VictoriaMetrics 留存**  
   同比 `1y`、基线 14×1d 是否在默认部署留存之内？若默认仅 15～30 天，V1c 的 `1y` 应降级为「仅私有化长留存可见」或暂不提供。

2. **公式模式是否同期支持全部 `calc_mode`**  
   建议 V1a 起公式结果可走 `absolute` / `percentile`；`mom` 起与单指标同步。若编译复杂度高，可写明「V1 公式仅 `absolute`+`percentile`」。

3. **日历对齐**  
   V1 用固定 offset 近似。是否需要 V1.x 做「上个自然月 / 去年今日」？未做前，UI 必须写清近似含义。

4. **环比默认偏移**  
   1d 与 7d 是否足够？是否要加 `1h`（相邻小时，易与 `change` 混淆）？建议 V1 不加 `1h`。

5. **基线统计量**  
   V1 只用同期均值。是否要 P50/P90 作基线、或允许「超过均值 + Nσ」？建议 V1.1 只做均值 + 偏差 %。

6. **`timeleft` 白名单**  
   首批指标清单（主机磁盘、哪个 plugin 的哪个 `metric_id`）需产品冻结。没有清单则 V1.2 只出需求、不开发。

7. **字段落库**  
   独立列 vs `calc_config` JSON。JSON 更易加 `baseline_count`，独立列更易过滤。不影响产品语义。

8. **百分位入口放哪**  
   定义指标的汇聚方式 vs 告警条件的计算方式。建议：**告警条件选 `percentile`，定义指标不再并排出现 AVG 与 P95**，避免两个入口打架。

9. **公式增强是否并进 V1.2**  
   默认否。仅当容量预测需要「free = total - used」而白名单又不够时，才考虑最小函数集。

10. **Trap / pmq**  
    本需求不处理。是否允许 Trap 自由查询里手写 `offset`？建议否，避免两套产品语言。

---

## 附录 A. 术语

| 用语 | 含义 |
|---|---|
| 计算方式 `calc_mode` | 窗口聚合之后、阈值比较之前的变换 |
| 固定阈值 `absolute` | 直接比较窗口聚合值 |
| 环比 `mom` | 与固定时长之前的同窗口比（1d/7d） |
| 同比 `yoy` | 与更长固定时长之前比；V1 非日历对齐 |
| 统计基线 | 近 N 个同期窗口的统计对照 |
| 无数据库存 | `PolicyInstanceBaseline`，与统计基线无关 |
| 告警中心运营 | 屏蔽、分派、升级、认领、渠道；本需求范围外 |

## 附录 B. 相关证据

- 策略模型：`server/apps/monitor/models/monitor_policy.py`
- 窗口算法枚举：`server/apps/monitor/tasks/utils/policy_methods.py`、`web/src/app/monitor/hooks/event.tsx`
- 公式限制：`server/apps/monitor/expression/parser.py`、`specs/capabilities/monitor-alert-formula-testing.md`
- 无数据库存：`PolicyInstanceBaseline` 注释「记录策略监控的所有维度组合，用于无数据检测」
- 看板已有、策略未开放的函数：`server/apps/monitor/utils/metric_query_labels.py`（`quantile_over_time`、`rate`、`predict_linear`）
- 产品边界：`docs/adr/0004-apps-own-alert-lifecycles.md`
- Zabbix 对照：`docs/design-docs/monitor-vs-zabbix-alert-strategy-gap.md`（若该分析分支已合入）
