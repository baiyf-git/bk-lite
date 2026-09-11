# Monitor 告警策略 vs Zabbix 告警能力对照

> 分析日期：2026-09-11  
> 对标版本：Zabbix 官方文档 **7.4 (current)**  
> Monitor 证据以本仓库代码与 docs 为准，不以口述记忆为准。  
> 范围：只比 **Monitor 指标/基础设施告警策略** 及与策略紧密相关的域内告警生命周期。Log / APM 不作为 Zabbix 对标对象。告警中心仅在「策略页没有但影响告警体验」时标注为补充，不与 Monitor 策略混为一谈。

## 1. 产品判断

Monitor 策略页已经能覆盖「选对象 → 定义指标 → 多级阈值 → 连续触发/恢复 → 无数据 → 通知渠道」这条日常闭环，在 **多级阈值表单、连续触发/恢复、无数据、PromQL/公式、单位换算、国内 IM、策略预览/模板** 上不弱于甚至强于 Zabbix 的对应表单。

Zabbix 的优势不在「多画几条阈值」，而在把触发器、动作、升级、媒体、维护、依赖、确认做成一套可组合的运营语法。若把 Monitor 策略页当成 Zabbix Trigger+Action 的一对一替代，缺口主要落在：

1. **根因压制**（触发器依赖）和 **主机级维护窗**（含停采集）不在 Monitor 策略域；
2. **同比/环比/趋势基线/预测** 没有产品化入口（引擎侧 PromQL 能算，策略表单不能配）；
3. **通知升级、活跃时段、按级别选渠道、确认/抑制类 Update 通知** 不在策略页，部分在告警中心、部分完全没有；
4. 策略页外还有若干 **投影语义断裂** 和 **Trap/公式/无数据恢复窗口** 的产品缺口，先前分析容易漏掉。

Zabbix 不是目标架构。下列「缺口」是能力覆盖，不是必须全部做成 Monitor 策略字段。

证据分层：

| 类型 | 含义 |
|---|---|
| 仓库事实 | 当前代码/模型/页面行为 |
| 官方事实 | Zabbix 7.4 文档 |
| 先前结论纠错 | 既有分析过强/过弱/混用术语 |
| 当前假设 | 无法从仓库或官方文档唯一裁定的产品意图 |

图例：`有` / `部分` / `无` / `更强`。`部分` 表示引擎能做、邻域能做或表单被砍过，不等于产品化。

---

## 2. 对象对照（避免把不同层的东西放进同一格）

| 概念 | Monitor | Zabbix 7.4 |
|---|---|---|
| 策略定义 | `MonitorPolicy`（查询、阈值、调度、通知绑在一行） | Trigger（问题判定）与 Action（通知/命令）分离 |
| 一次告警生命周期 | `MonitorAlert`：`new` → `recovered`/`closed`；级别只升不降 | Problem 事件；Trigger 只有单一 severity；可 Single/Multiple 事件模式 |
| 生命周期事实 | `MonitorEvent`：`triggered` / `escalated` / `claimed` / `assigned` / `recovered` / `closed` | PROBLEM / OK / 内部事件；确认、改级别、抑制是更新操作 |
| 无数据 | 策略开关 + `PolicyInstanceBaseline` 库存，按 **监控实例** 聚合成一条活动告警 | 触发器函数 `nodata()`，按 item 判定 |
| 「基线」一词 | `PolicyInstanceBaseline` = 无数据检测用的维度库存，**不是** 统计基线 | `baselinedev` / `baselinewma` / `trendavg` 等趋势函数 |
| 「升级」一词 | 域内 **级别升级**（更高阈值命中）；策略页 **没有** 通知升级链 | Action **escalation step** 主要是通知/命令升级；Trigger severity 本身不随时间自动升 |
| 屏蔽/维护 | 告警中心 `AlertShield`（事件匹配+时间窗，发生在投影之后） | Maintenance（主机/组/标签；可停采集；可暂停升级） |
| 标签 | 指标维度 + 告警名称变量；**没有** 触发器标签体系 | Trigger/Event tag：用于动作条件、维护、关联关闭 |

---

## 3. 对照表

### 3.1 基本信息

对应页面：`web/src/app/monitor/(pages)/event/strategy/detail/basicInfoForm.tsx`  
对应模型：`server/apps/monitor/models/monitor_policy.py` `MonitorPolicy`  
Zabbix：[Trigger configuration](https://www.zabbix.com/documentation/current/en/manual/config/triggers/trigger)

| 能力 | Monitor 策略页 | Zabbix | 差距 |
|---|---|---|---|
| 名称 | 策略名 `name` + 告警名 `alert_name`（Python `Template` 变量） | Trigger name + 可选 Event name（宏更全，含 `{ITEM.LASTVALUE}`、`{?EXPRESSION}`、`$1..$9`） | **部分**：我们变量面向资源上下文，Zabbix 宏覆盖 item/host/event/user macro |
| 所属范围 | 必填 `organizations`，多组织；`PolicyOrganization` | Host / Host group | **更强**（租户/项目模型）；不是 Host group 语义 |
| 监控目标 | 选实例或选组织；Trap 时隐藏且 `source={}` | 表达式内写 `/host/key` | **有**（非 Trap）；Trap **无目标资产** |
| 启用 | 列表页 Switch；详情保存 `params.enable = true` **恒为 true** | Trigger `Enabled` 勾选 | **部分**：能停用，但编辑保存会把已停用策略重新打开 |
| 调度 | `schedule`：分/时/天 + Celery `PeriodicTask` | 由 item 采集间隔驱动，触发器随新值计算 | 模型不同，**不是缺口**；见 §3.5 调度补偿 |
| 说明/运行数据/URL | 策略无 description、operational data、trigger URL | Description、Operational data、Menu entry URL | **无** |
| 模板 | 内置/自定义 `PolicyTemplate`，可「保存为模版」、`bulk_create_from_templates` | Template + trigger prototype + LLD | **有**（产品形态不同）；Zabbix LLD 自动展开更强 |
| 克隆 | 走新建/模板，无 Trigger Clone 按钮 | Clone | 体验差，非能力空洞 |

告警名称变量（仓库事实，`alert_name_variables.py`、`variablesTable.tsx`、capability `specs/capabilities/monitor-alert-resource-context.md`）：

`${monitor_object}` `${resource_id}` `${resource_name}` `${resource_ip}` `${parent_resource_id}` `${parent_resource_name}` `${level}` `${metric_name}` `${value}` `${dimension_value}`，以及对象 `display_fields.variable_id` 和 `metric__<dimension>`。

Zabbix 宏清单见 [Macros](https://www.zabbix.com/documentation/current/en/manual/config/macros)。我们没有 user macro、secret macro、expression macro。

### 3.2 定义指标（计算 / 聚合 / 查询）

对应页面：`metricDefinitionForm.tsx`、`metricExpressionEditor.tsx`、`formulaExpressionUtils.ts`  
对应扫描：`tasks/services/policy_scan/metric_query.py`、`expression/query.py`  
Zabbix：[Trigger expression](https://www.zabbix.com/documentation/current/en/manual/config/triggers/expression)、[Functions](https://www.zabbix.com/documentation/current/en/manual/appendix/functions)、[Calculated items](https://www.zabbix.com/documentation/current/en/manual/config/items/itemtypes/calculated)

| 能力 | Monitor 策略页 | Zabbix | 差距 |
|---|---|---|---|
| 单指标选择 + label 过滤 | 有；`=` `!=` `=~` `!~`，AND/OR | item key + 函数参数 | **有** |
| 周期聚合 | 表单仅 `sum/max/min/avg/count/last_over_time`（`useMethodList`） | `avg/min/max/sum/last/count/percentile/rate/...` | **部分**：常用聚合有；百分位不在策略表单 |
| 分组聚合 | `avg/max/min/sum/count` + `group_by` | 聚合函数可跨 item | **有** |
| 多指标公式 | 仅 `+ - * /` 与括号；至少两个不同变量；禁止一元负号；锚点 `group_by` 必须含 `instance_id` | 触发器可 `and/or/not` 组合多 item；calculated item 函数更富 | **部分**：比率类场景够用；不能在公式里写函数/比较/逻辑 |
| PromQL 自由查询 | **仅 SNMP Trap** 走 `query_condition.type=pmq`；普通对象不出现 PromQL 框 | 无 PromQL；用 trigger 函数语言 | **更强**（Trap / 历史 pmq）；普通策略是引导式，不是缺口 |
| 同比 / 环比 / time shift | 策略表单无 `now-1d` / `trendavg` 入口 | `avg(/host/key,1h:now-1d)`、`trendavg(...,1M:now/M-1M)` | **无（产品化）** |
| 统计基线 / 预测 | 看板查询白名单含 `predict_linear` `quantile_over_time` `histogram_quantile`（`metric_query_labels.py`），**策略算法枚举不含这些** | `baselinedev` `baselinewma` `forecast` `timeleft` `percentile` | **无（产品化）**；引擎侧「能写 PromQL」≠ 策略能配 |
| 单位换算 | `metric_unit` / `calculation_unit` / `threshold_unit` + `UnitConverter` | 后缀 `K/M/G`、item 单位 | **更强**（阈值单位与展示单位分离） |
| 枚举指标 | 公式模式关闭枚举；非公式用 `=`/`≠` 下拉（`ENUM_COMPARISON_METHOD`） | 字符串/数值比较，无枚举字典产品位 | **更强** |
| 预览 | `PolicyPreviewService` 实查 VM 并画阈值 | Trigger expression test（给值看真假） | **更强**（看真实序列）；Zabbix 测的是布尔表达式 |
| Trap 特例 | 隐藏目标、隐藏聚合方式、条件整段隐藏；保存 `algorithm=last_over_time`、`source={}` | SNMP trap 是 item 类型，触发器用 `logeventid`/`find`/正则 | **有查询、条件产品化断裂**，见 §5 |

`PolicyInstanceBaseline` **不是** 同比基线。它只记录「这个策略曾经见过哪些维度组合」，供无数据检测。把「基线」写成统计能力是术语误用。

### 3.3 告警条件（阈值 / 连续触发 / 恢复 / 无数据）

对应页面：`alertConditionsForm.tsx`、`thresholdList.tsx`  
对应检测：`tasks/utils/policy_calculate.py` `calculate_alerts`、`alert_detector.py`  
Zabbix：Trigger expression、[Hysteresis](https://www.zabbix.com/documentation/current/en/manual/config/triggers/expression#hysteresis)、`nodata()`、[Unknown operands](https://www.zabbix.com/documentation/current/en/manual/config/triggers/expression#expressions-with-unknown-operands)

| 能力 | Monitor 策略页 | Zabbix | 差距 |
|---|---|---|---|
| 多级阈值 | 同一策略 `warning/error/critical` 三档，按 `LEVEL_WEIGHT` 取最高命中 | **一个 Trigger 一个 severity**（Not classified → Disaster，可改名改色） | **更强**；Zabbix 通常拆多条 Trigger |
| 比较符 | `> < = != >= <=`；枚举仅 `=`/`≠` | 表达式运算符 + 浮点容差 | **有** |
| 连续触发 | `trigger_count`：连续 N 个汇聚点都满足才告警 | `min/max/count` 或 `#N` 历史点；无单独「连续次数」字段 | **更强**（表单语义直接） |
| 恢复 | `recovery_condition`：连续 N 个 **未达阈值**（记为 info）才恢复；`<=0` 则代码跳过恢复 | 可选独立 **recovery expression**；OK event generation = Expression / Recovery expression / **None** | **部分**：滞回有，但是「连续未命中」不是独立恢复表达式；表单 `min=1`，用户关不掉自动恢复 |
| 无数据 | 周期 + 级别（critical/error/warning/不触发）+ 独立告警名；按监控实例聚合一条 Alert | `nodata(/host/key,3m)=1`，unsupported item 也算 | **有**，聚合粒度不同（实例 vs item） |
| 无数据恢复窗口 | 后端字段 `no_data_recovery_period` 独立；**页面保存时强制等于 `no_data_period`** | 由表达式窗口决定 | **部分**：引擎可分窗口，产品不能配 |
| 函数计算延迟提示 | `functionDelayMinutes` 提示无数据可能延后 | 无对等文案 | **更强**（体验） |
| UNKNOWN | `inf/nan` 样本直接跳过，不产生未知态 | 操作数 Unknown → 触发器 Unknown；`and/or` 有三值逻辑 | **无** |
| 级别升降 | 活动告警级别 **只升不降**，直到恢复/关闭；升级写 `MonitorEvent.escalated` | Trigger severity 固定；人工可在确认时改问题级别 | 模型不同。我们「升级」= 更高阈值命中，不是 Zabbix 通知升级 |
| 事件生成模式 | 持续命中不落 Event，只在首次触发和新高峰升级落库 | PROBLEM event generation：**Single** / **Multiple** | **无 Multiple**；Single 语义更接近我们，有利于抗风暴 |
| 关联关闭 | 无 tag 关联；恢复关闭该 Alert | OK event closes：全部问题 / 仅 tag 匹配 | **无** |
| 允许手工关闭 | 告警页可关，策略无开关 | `Allow manual close` | 我们默认允许，**不是缺口** |
| Trap | 条件表单整段 `null`，用户配不了阈值/连续/恢复/无数据 | Trap item 仍配普通 Trigger | **产品空洞**，见 §5 |

阈值命中算法（仓库事实）：最近 `trigger_count` 个点必须全部满足同一档阈值；非有限值整段跳过。恢复靠 `info_event_count` 累加，再命中阈值会清零。这是滞回，但恢复条件不能写成「降到 15℃」这类与触发阈值不对称的表达式。

### 3.4 配置通知（处理人 / 渠道 / 通知者）

对应页面：`notificationForm.tsx`  
对应投递：`services/alert_lifecycle_notify.py`、`services/alert_center_delivery.py`  
Zabbix：[Actions](https://www.zabbix.com/documentation/current/en/manual/config/notifications/action)、[Media types](https://www.zabbix.com/documentation/current/en/manual/config/notifications/media)、[Escalations](https://www.zabbix.com/documentation/current/en/manual/config/notifications/action/escalations)、[Recovery operations](https://www.zabbix.com/documentation/current/en/manual/config/notifications/action/recovery_operations)、[Update operations](https://www.zabbix.com/documentation/current/en/manual/config/notifications/action/update_operations)

| 能力 | Monitor 策略页 | Zabbix | 差距 |
|---|---|---|---|
| 处理人 | `handlers`，创建告警时写入默认处理人 | Action 里选用户/用户组；可远程命令 | **有**（默认处理人）；不是值班表 |
| 通知开关 | `notice` Switch | Action 启用 | **有** |
| 渠道 | 邮件、企微机器人、飞书、钉钉、Webhook、NATS；系统管理统一配置 | Email/SMS/Webhook/Script 等；用户媒体再绑 | **更强**（国内 IM 开箱） |
| 通知人 | `notice_users`；渠道全是 NATS 时隐藏且可空 | 用户媒体 `Send to` | **有** |
| 按级别选渠道 | 无 | 用户媒体 `Use if severity` | **无** |
| 活跃时段 | 无 | 用户媒体 `When active`（如 `1-5,09:00-18:00`） | **无** |
| 动作条件 | 通知绑死在本策略 | Host group / Tag / Severity / Time period / Maintenance 等 And/Or/自定义公式 | **无**（策略页）；告警中心分派规则是补充 |
| 通知升级链 | 策略页无；告警中心 `AlertAssignment.config.escalation` 有多层 wait + 人员 | Action escalation step，最短 60s，可重复通知 | **策略页无**；邻域 **部分** |
| 恢复通知 | `recovered` 走同一渠道 | Recovery operations，可 `Notify all involved` | **有** |
| Update 通知 | 开启通知时 `upgraded` 会发；认领/分派有域内事件；**无确认留言/改级别/抑制** 的更新通知 | Update operations：确认、留言、改级别、抑制 | **部分** |
| 远程命令 | 策略页无 | Operation type: remote command | **无**（告警中心 Action / Job 是补充） |
| 消息模板 | 代码拼 `告警内容/资源/级别/状态/时间`；告警名用 `${}` | Media type message templates + 宏 | **部分**：可变量告警名，渠道正文几乎硬编码 |
| 通知失败重试 | IM/邮件失败写入 `notice_logs` **即止**；告警中心有 outbox/5 分钟补偿、最多 10 次 | 媒体失败可重试（媒体类型 Options） | **部分**：只补偿告警中心投影，不补偿 IM |

级别映射到告警中心（投影，不是策略页字段）：

```text
critical→0  error→1  warning→2  info→3  no_data→2（当成 warning）
upgraded（域内级别升级）→ 告警中心 action 字段写成 created，另附 lifecycle_action
```

见 `ACTION_TO_ALERT_CENTER`、`LEVEL_TO_ALERT_CENTER`。旧接收端若只看 `action=created`，会把升级当成新告警。

### 3.5 策略页外但对齐告警体验仍关键

| 能力 | Monitor / 邻域 | Zabbix | 差距 |
|---|---|---|---|
| 触发器依赖 / 根因压制 | Monitor 扫描器无依赖边；无 parent PROBLEM 时压制子告警 | [Trigger dependencies](https://www.zabbix.com/documentation/current/en/manual/config/triggers/dependencies)：父 PROBLEM 时不执行子动作、甚至不重算 | **无** |
| 维护窗 | **无主机维护**。告警中心 `AlertShield`：匹配规则 + one/day 时间窗，屏蔽的是 **已投影事件**，Monitor 域内 Alert 仍会创建 | [Maintenance](https://www.zabbix.com/documentation/current/en/manual/maintenance)：With/No data collection；可按主机/组/标签；可暂停升级；恢复通知策略明确 | **无对等维护窗**；Shield ≠ Maintenance |
| 确认 / 抑制 | 域内认领、分派、手工关闭；无 ack 位、无「抑制到某时」 | [Problem acknowledgment](https://www.zabbix.com/documentation/current/en/manual/acknowledgment)：留言、改级别、suppress/unsuppress、ack、手工关闭 | **部分** |
| 告警风暴保护 | 连续触发 + 单活动 Alert 去重 + 无数据按实例聚合；**无** 策略级速率限制/抑制分组 | 依赖 + Single 模式 + 维护 + 动作条件；无独立「storm protection」产品名 | 两边都不是 Alertmanager 那种 group/inhibit；我们仍缺依赖/维护 |
| 幂等 / 去重 | 活动告警键 `(metric_instance_id 或实例, alert_type)`；Event 对 triggered/recovered/closed 唯一；告警中心另有 fingerprint | 同一 Trigger Single 模式下状态边沿去重 | **有**（域内）；与告警中心 fingerprint **不是同一套身份** |
| 权限 | `policy.<objectId>` View/Operate + 当前组织数据范围 | 角色 + host group 权限 | **有**；多组织是咱们模型 |
| 多组织 | 策略 `organizations` JSON + `PolicyOrganization`；详情序列化必须回完整归属，避免跨组织保存丢组织 | 无租户；靠 host group | **更强** |
| 策略调度与补偿 | 每策略一个 `PeriodicTask`；漏跑最多补 30 个周期或 24h（`AlertConstants`）；`celery_singleton` | server 定时器 + 配置缓存 | 能补偿，但 **无抖动/查询预算**；策略变多会整点打满 VM（架构分析已写） |
| 告警中心投影 | 可选 NATS `receive_alert_events`；outbox 代次 + 有界重试 | 无此层 | 补充能力；语义断裂见 §5 |
| 分派 / 提醒 / 升级 | 告警中心 Assignment + Reminder + EscalationService | Action escalation | **补充，不在策略页** |
| 搜索「条件」 | `MonitorCondition` 是指标检索收藏，**不参与策略扫描** | Action conditions | 名称易混，**不是** Zabbix 动作条件 |

---

## 4. 对既有结论的复核

先前认为的主要缺口，以及「咱们不弱」项，逐条用代码核对。

| 先前结论 | 复核 | 说明 |
|---|---|---|
| 同比/环比/基线产品化是缺口 | **成立，但「基线」用词要改** | 缺口是 time shift / trend / `baselinedev`。`PolicyInstanceBaseline` 只是无数据库存 |
| 触发器依赖/根因压制是缺口 | **成立** | 扫描器无依赖图 |
| 策略侧升级是缺口 | **过粗，需拆开** | 级别升级 **有**（`escalated`，只升不降）。通知升级 **策略页无**，告警中心分派配置 **有**。Zabbix「Escalation」主要指通知步进，不是把同一 Trigger 的 severity 自动升高 |
| 维护窗（相对 Shield）是缺口 | **成立** | Shield 在告警中心接入后屏蔽事件；不能停采集、不能在 Monitor 侧阻止建 Alert |
| 活跃时段 + 按级别选渠道是缺口 | **成立** | 策略通知是渠道多选，无时间窗、无级别过滤器 |
| 独立恢复表达式是缺口 | **部分成立** | 连续未命中 = 滞回；不能写与触发不对称的恢复表达式；也不能选「永不自动恢复」（表单 min=1） |
| Update 通知是缺口 | **部分成立** | 恢复/关闭/分派/（开启通知时的）级别升级会发。缺确认留言、改级别、抑制 |
| 百分位/预测产品化是缺口 | **成立（产品化）** | 看板/PMQ 白名单有函数；策略 `algorithm` 枚举没有 |
| 标签体系是缺口 | **成立（路由标签）** | 有维度和名称变量，没有 trigger tag 给动作/维护/关联关闭用 |
| UNKNOWN 态是缺口 | **成立** | 非有限值跳过，不进入未知态 |
| 多级阈值表单不弱 | **成立，且更强** | Zabbix 单 Trigger 单级别 |
| 连续触发/恢复不弱 | **成立** | 表单语义比用 `min()`/`count()` 拼更直接 |
| 无数据不弱 | **成立，粒度不同** | 我们按监控实例聚合；Zabbix 按 item `nodata()` |
| PromQL 不弱 | **成立（Trap/公式编译）** | 普通对象是引导式指标，不是自由 PromQL，这是有意边界 |
| 单位换算不弱 | **成立** | |
| 国内 IM 不弱 | **成立** | |
| 策略预览/模板不弱 | **成立** | 预览实查 VM；模板可批量落策略 |

---

## 5. 相对既有分析的新增发现

只写复核后 **新出现或纠正过的点**。已在上一节确认的原缺口不重复当「新增」。

### 5.1 级别升级 ≠ 通知升级（纠正）

- Monitor：`EventAlertManager._select_lifecycle_events` 只在新高峰写 `escalated`；IM 在 `policy.notice=True` 时会发升级通知。
- Zabbix Escalation：按 step 重复通知或换人，Trigger severity 不变。
- 把「咱们没有升级」写成总缺口会误导：缺的是 **策略页通知升级链**，不是级别状态机。

### 5.2 告警中心投影语义断裂（新增）

| 域内事实 | 投影字段 | 风险 |
|---|---|---|
| `lifecycle_action=upgraded` | `action=created`（`ACTION_TO_ALERT_CENTER`） | 旧接收端当成新告警；补偿任务对 `status=new` 也一律按 `created` 重推 |
| `level=no_data` | 告警中心 level `"2"`（warning） | 无数据与 warning 不可区分 |
| 域内 Alert 身份 `(policy, metric_instance, alert_type)` | 告警中心 `fingerprint` | 两套去重键；屏蔽/分派匹配的是投影后事件 |

Outbox（`MonitorAlertCenterDelivery`）把投递做成不可变代次，这是可靠性加分，不能抵消字段语义收缩。

### 5.3 Trap 策略是「半截产品」（新增）

`isTrap` 为真时：

- 基本信息：不选资产，保存 `source={}`；
- 指标：只留 PromQL（`type=pmq`），聚合方式隐藏，保存写死 `last_over_time`；
- 告警条件：**整段不渲染**，阈值/连续/恢复/无数据都配不了。

后端扫描仍走 `calculate_alerts`。结果是：Trap 要么靠残留默认空阈值从不触发，要么只能改 API/历史数据。Zabbix 的 SNMP trap 仍是「item + 普通 trigger」。这不是「咱们有 PromQL 所以更强」能盖住的。

### 5.4 无数据恢复窗口被 UI 焊死（新增）

后端 `recover_no_data_alerts` 使用独立的 `no_data_recovery_period`。  
前端 `buildStrategyParams` 执行 `no_data_recovery_period = no_data_period`。  
`alertConditionsForm` 虽接收 `noDataRecovery` props，**没有对应输入控件**。

### 5.5 编辑保存会强制启用策略（新增）

`buildStrategyParams` 无条件 `params.enable = true`。列表页可以把策略关掉；再进详情点保存会打开。Zabbix 编辑 Trigger 会保留 Enabled。

### 5.6 公式模式的硬限制（新增，先前只说「有公式」）

`formulaExpressionUtils` / capability `monitor-alert-formula-testing.md`：

- 只有四则运算；
- 至少两个不同变量（`a * 100` 非法）；
- 锚点必须含 `instance_id`；
- 非锚点不得带额外维度；
- `inf/nan` 不告警也不错误恢复；
- 公式模式不做枚举阈值、不做 metric_unit。

这是有意安全边界，但对标 Zabbix 表达式仍是能力差。

### 5.7 IM 通知失败无重试（新增）

`_send_normal_notice` 失败只写 `notice_logs`。  
`retry_alert_center_lifecycle_notify_task` 只补告警中心。  
Zabbix 媒体类型有失败重试选项。对「只配了企微、没配告警中心」的客户，失败即丢。

### 5.8 策略调度补偿有上限、无风暴阀（新增）

`scan_policy_task`：漏跑补齐，但 `MAX_BACKFILL_COUNT=30`、`MAX_BACKFILL_SECONDS=24h`，超出窗口的历史不再补。  
每个策略独立 Beat 任务，架构文档已指出整点放大查询。这不是 Zabbix 有而我们完全没有，而是 **对标「大规模触发器」时我们没有产品化的扫描预算/限流**。

### 5.9 宏/模板变量深度差（新增细化）

我们 `${}` 是封闭白名单 + 展示列。  
Zabbix 还支持 user macro、LLD macro、event tag 里的 macro function、以及 Event name 里的 `{?expression}`。运维用宏在模板里参数化阈值，这条路径我们走的是「模板 JSON 复制」，不是运行时宏。

### 5.10 `MonitorCondition` 不参与告警（新增，防误对标）

`server/apps/monitor/models/monitor_condition.py` 被指标检索页当「保存的查询条件」用，策略扫描从不读取。不能把它当成 Zabbix Action conditions 的现成实现。

### 5.11 枚举指标是未被点名的相对优势（纠偏）

先前清单没提。非公式指标若带枚举单位，阈值变成状态下拉。Zabbix 要自己写 `last()=2`。这属于「咱们不弱」应补的一项。

### 5.12 无数据按实例聚合 vs item `nodata()`（细化）

capability 明确：同一监控实例多维缺失合成一条无数据 Alert，全部基准恢复才恢复。Zabbix 每个 trap/item 各算。这不是谁绝对更好，但是对标时必须分开写，否则会误判「无数据已经等价」。

复核过、但 **没有** 再发现独立产品缺口的区域：

- 认领/分派/关闭的域内状态机（`MonitorEvent.Action`、告警页 API）——有，只是不等于 Zabbix ack；
- 策略权限模块键 `PermissionConstants.POLICY_MODULE`——有；
- 预览、模板、批量从模板创建——有；
- 单位换算与多级阈值——有。

---

## 6. 按优先级的缺口清单

优先级按「Zabbix 迁移/替代时是否打断运营闭环」排，**不是** 实现排期。刻意不做的能力仍列在这里，避免下次再被当成遗漏。

### P0 运营闭环（没有就很难替 Zabbix 值夜班）

1. **触发器依赖 / 根因压制**  
   父对象 PROBLEM 时压制子对象通知。Monitor 无依赖边。
2. **主机/对象维护窗（含可选停采集）**  
   Shield 不能替代：域内 Alert 仍创建，采集仍写 VM。
3. **通知升级链的产品归属说清或补齐**  
   要么策略页能配「N 分钟无人认领则换人」，要么明确只在告警中心配，并保证 Monitor 投影字段足够驱动它。
4. **Trap 策略补齐条件表单（或明确 Trap 不走阈值策略）**  
   当前 UI 隐藏条件、后端仍按阈值扫描。

### P1 明显可感知的策略能力

5. 同比/环比（time shift）产品化，而不是要求用户去 Trap PromQL。  
6. 独立恢复表达式，或至少允许「永不自动恢复」。  
7. 无数据检测窗口与恢复窗口在表单上拆开。  
8. 用户媒体：活跃时段 + 按级别选渠道。  
9. 编辑保存不得强制 `enable=true`。  
10. IM/邮件通知失败重试（或明确失败可观测且可手工重发）。  
11. 告警中心 `action=created` 与 `lifecycle_action=upgraded` 的对外契约写进兼容说明；`no_data` 不要静默映射成 warning。

### P2 成熟度 / 可后置

12. 百分位、预测、趋势基线的策略表单（或官方「用公式/PMQ」文档）。  
13. 触发器标签 + 用标签做维护/分派/关联关闭。  
14. UNKNOWN 态（相对「跳过非有限值」未必值得做）。  
15. PROBLEM Multiple 事件模式。  
16. 策略级扫描预算、抖动、风暴限流。  
17. 宏体系（user macro / 表达式宏）与渠道消息模板。  
18. Trigger URL / Operational data / 策略说明。  
19. 远程命令（继续放告警中心 Action 即可）。  
20. 公式模式放开函数与一元负号（要同时保住现有注入防护）。

### 待确认（仓库事实无法单独裁定）

- 告警中心升级链是否被定义为 Monitor 策略的官方升级入口。  
- Trap 对象的产品意图：自由 PromQL 告警，还是 SNMP trap 事件接入（告警中心已有 SNMP Trap 通道）。  
- 是否接受「无数据按实例聚合」作为对 Zabbix `nodata()` 的有意差异，而不是缺陷。

---

## 7. 证据索引

### 7.1 Monitor（仓库）

| 主题 | 路径 |
|---|---|
| 策略/事件/告警模型 | `server/apps/monitor/models/monitor_policy.py` |
| 策略表单四段 | `web/src/app/monitor/(pages)/event/strategy/detail/{basicInfoForm,metricDefinitionForm,alertConditionsForm,notificationForm}.tsx` |
| 保存时 enable/Trap/无数据窗口 | `web/src/app/monitor/(pages)/event/strategy/detail/page.tsx` `buildStrategyParams` |
| 聚合算法枚举 | `web/src/app/monitor/hooks/event.tsx` `useMethodList` |
| 公式限制 | `web/src/app/monitor/(pages)/event/strategy/detail/formulaExpressionUtils.ts`；`specs/capabilities/monitor-alert-formula-testing.md` |
| 阈值与连续点 | `server/apps/monitor/tasks/utils/policy_calculate.py` |
| 无数据/恢复 | `server/apps/monitor/tasks/services/policy_scan/alert_detector.py` |
| 级别升级去重 | `server/apps/monitor/tasks/services/policy_scan/event_alert_manager.py` |
| 扫描编排 | `server/apps/monitor/tasks/services/policy_scan/scanner.py` |
| 调度补偿 | `server/apps/monitor/tasks/monitor_policy.py`；`constants/alert_policy.py` |
| 通知与投影 | `server/apps/monitor/services/alert_lifecycle_notify.py` |
| 告警中心 outbox | `server/apps/monitor/services/alert_center_delivery.py` |
| 名称变量 | `server/apps/monitor/utils/alert_name_variables.py`；`specs/capabilities/monitor-alert-resource-context.md` |
| 预览 | `server/apps/monitor/services/policy_preview.py` |
| 权限 | `server/apps/monitor/views/monitor_policy.py`；`constants/permission.py` |
| 模块边界 | `docs/design-docs/monitor-module-architecture-analysis.md` §6.3 |
| 术语 | `CONTEXT.md`「监控告警 / 监控告警事件 / 处理人 / 告警中心事件」 |

### 7.2 告警中心（仅补充）

| 主题 | 路径 |
|---|---|
| 屏蔽 | `server/apps/alerts/models/alert_operator.py` `AlertShield`；`common/shield.py` |
| 分派/提醒/升级 | `AlertAssignment`；`service/escalation_service.py` |
| 接入幂等 | `common/source_adapter/base.py` `lifecycle_action` |
| 架构 | `docs/design-docs/alerts-module-architecture-analysis.md` |

### 7.3 Zabbix 7.4 官方文档

- Triggers：<https://www.zabbix.com/documentation/current/en/manual/config/triggers/trigger>  
- Expressions / hysteresis / unknown：<https://www.zabbix.com/documentation/current/en/manual/config/triggers/expression>  
- Dependencies：<https://www.zabbix.com/documentation/current/en/manual/config/triggers/dependencies>  
- Severity：<https://www.zabbix.com/documentation/current/en/manual/config/triggers/severity>  
- Functions：<https://www.zabbix.com/documentation/current/en/manual/appendix/functions>  
- Actions / conditions / operations：<https://www.zabbix.com/documentation/current/en/manual/config/notifications/action>  
- Escalations：<https://www.zabbix.com/documentation/current/en/manual/config/notifications/action/escalations>  
- Recovery / Update operations：同目录 `recovery_operations`、`update_operations`  
- Media：<https://www.zabbix.com/documentation/current/en/manual/config/notifications/media>  
- Maintenance：<https://www.zabbix.com/documentation/current/en/manual/maintenance>  
- Acknowledgment / suppression：<https://www.zabbix.com/documentation/current/en/manual/acknowledgment>  

---

## 8. 不在本次范围

- 不把 Log/APM 策略与 Zabbix 对标。  
- 不把告警中心 Zabbix **接入适配器**（`server/apps/alerts/common/source_adapter/zabbix.py`）当成 Monitor 策略能力。那是「Zabbix 把问题推给 BK-Lite」，不是「BK-Lite 策略能做什么」。  
- 本文不提出必须落地的实现方案；P0–P2 只供产品取舍。
