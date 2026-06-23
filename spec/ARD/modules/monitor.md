# 模块 ARD：Monitor（监控告警策略）

> 路径 `server/apps/monitor` ｜ API 前缀 `api/v1/monitor/`

## 1. 职责【已实现/已存在】
管理监控对象/实例、指标定义、插件化采集配置与告警策略；基于 VictoriaMetrics 周期扫描评估阈值，维护告警生命周期。SNMP 采集覆盖 Switch/Router/Firewall/Loadbalance 四类网络设备，内置超过 61 个厂商插件；网络设备实例以「云区域 + IP」统一编码，确保同一设备的多厂商采集数据收敛到同一资产实例。

## 2. 数据模型与存储【已实现/已存在】
| 模型 | 文件 | 说明 |
|------|------|------|
| MonitorObjectType / MonitorObject / MonitorInstance | `models/monitor_object.py` | 监控对象类型/定义/目标实例（实例含 `fallback_sampling_rate` 兜底采样率、`enabled_protocols` Flow 协议） |
| MonitorInstanceOrganization / MonitorObjectOrganizationRule | `models/monitor_object.py:70,80` | 实例-组织关联表（权限隔离载体）、对象分组规则 |
| MetricGroup / Metric | `models/monitor_metrics.py` | 指标分组与定义（PromQL、单位、维度） |
| MonitorPlugin / MonitorPluginConfigTemplate / MonitorPluginUITemplate | `models/plugin.py:8,26,39` | 采集插件（telegraf）、配置模板、UI 模板 |
| MonitorPolicy / PolicyTemplate / PolicyOrganization | `models/monitor_policy.py:21,10,72` | 告警策略、模板、策略-组织关联表（权限隔离载体） |
| MonitorEvent / MonitorEventRawData / MonitorAlert / MonitorAlertMetricSnapshot | `models/monitor_policy.py` | 事件/原始数据/告警聚合/生命周期快照（S3JSONField） |
| PolicyInstanceBaseline / CollectConfig | `models/*.py` | 无数据基线、采集配置 |
| MonitorCondition / MonitorConditionOrganization | `models/monitor_condition.py:7,21` | 可复用监控条件、条件-组织关联表（权限隔离载体） |
| Setting | `models/setting.py:7` | 监控全局设置（`name` + `value` JSONField 键值对） |

**存储**：PostgreSQL（ORM）；VictoriaMetrics（指标查询，`utils/victoriametrics_api.py`）；MinIO（`monitor-alert-raw-data` 等，S3JSONField）。

## 3. 接口【已实现/已存在】

### 3.1 SNMP 网络设备插件矩阵【已实现/已存在】

SNMP 采集插件以「厂商 + 设备类型」为粒度独立打包（每个插件含采集模板、指标定义、UI 表单、策略预置），统一挂载在 `support-files/plugins/Telegraf/snmp_<vendor>/<type>/` 目录下。当前内置共 61 个厂商插件，按设备类型分布如下：

| 设备类型 | 对象名 | 已内置厂商 |
|----------|--------|------------|
| 交换机（Switch） | Switch | 锐捷（Ruijie）、华三（H3C）、华为（Huawei）、思科（Cisco）、Arista、Juniper、戴尔 OS10（Dell OS10）、联想 CNOS（Lenovo CNOS）、Mellanox、Allied Telesis、Ubiquiti、3Com、ZTE、Datacom、DCN、Eltex、Fiberhome、FortiSwitch、FS、Hirschmann、Netonix、Alcatel-Lucent（AOS）、OmniSwitch（ALE）、Parks、SNR、Yamaha、Aruba、Brocade、D-Link、Extreme、Netgear、QTech、TP-Link、Zyxel、DellForce、HP HPN、MikroTik（共 37 个） |
| 路由器（Router） | Router | 华为 AR（Huawei AR）、Juniper MX、Adtran、Draytek、Lancom、NEC、Vyatta（共 7 个） |
| 防火墙（Firewall） | Firewall | CheckPoint、Fortinet、Palo Alto、SonicWall、Sophos、Hillstone（山石）、ScreenOS（Juniper）、Forcepoint、opnSense、pfSense、Stormshield、WatchGuard（共 12 个） |
| 负载均衡（Loadbalance） | Loadbalance | F5、A10、Alteon（Radware）、FortiADC、NetScaler（Citrix ADC）（共 5 个） |

各厂商预置指标涵盖 CPU、内存、接口流量、系统运行时长、会话数（防火墙）等核心健康维度，单对象指标数因厂商能力不同有所差异（约 3–24 项/插件）。对应 PRD 见 [[../../prd/监控系统/集成.md#3.1.1 网络设备 SNMP 插件覆盖范围]]。

> 证据来源：`server/apps/monitor/support-files/plugins/Telegraf/snmp_*/` 各子目录（metrics.json、UI.json、*.child.toml.j2、policy.json）　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.2 告警策略预览接口【已实现/已存在】

`monitor_policy` ViewSet 新增 `POST /api/v1/monitor/monitor_policy/preview/` 动作（`views/monitor_policy.py:466-468`），由 `PolicyPreviewService`（`services/policy_preview.py`）提供服务端预览能力。

接口契约：
- **入参**：`query_condition`（指标 ID 或原生 PromQL 查询）、`period`（检测周期，type 为 min/hour/day）、`algorithm`（聚合算法）、`group_by`（分组维度列表）、`preview`（实例标识值与展示数据点数）、`metric_unit` / `calculation_unit`（单位换算参数，可选）。
- **出参**：`query`（最终执行的 PromQL 语句）、`data`（VictoriaMetrics 范围查询结果，已完成单位换算；展示单位以 `data.unit` 子字段返回）、`warnings`（换算跳过等非阻塞提示）。
- **单位换算**：若 `source_unit` 与 `target_unit` 均存在且不同，则调用 `UnitConverter` 逐点转换；不可换算时写入 `warnings` 并返回原始值，不抛错。
- **PromQL 构建**：`query_condition.type == "pmq"` 时直接使用原生查询串；否则按 `metric_id` 查指标定义，拼接实例过滤条件与用户追加过滤器后替换 `__$labels__` 占位符。

对应 PRD 见 [[../../prd/监控系统/事件.md#3.2 策略]]。

> 证据来源：`server/apps/monitor/views/monitor_policy.py:466-468`、`server/apps/monitor/services/policy_preview.py`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.3 监控对象展示列名国际化【已实现/已存在】

`MonitorObjectViewSet.list`（`views/monitor_object.py:63`）在序列化后对 `display_fields` 做额外翻译处理（`_translate_display_fields`，`views/monitor_object.py:40-61`）：

- 列名（`display_fields[].name`）一律取该列绑定指标（`metrics[0].metric`）在当前用户语言（`request.user.locale`）下的 i18n 译名（键格式 `{MONITOR_OBJECT_METRIC}.{object_name}.{metric_name}.name`）。
- 无绑定指标或无对应译名时回退原列名。
- 不就地修改原数组，返回新副本；因此编辑（添加/删除/排序）后不会因 `display_fields_customized` 标记干扰译名展示，始终随账号语言切换。

> 证据来源：`server/apps/monitor/views/monitor_object.py:40-61,63-92`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.4 网络设备实例身份统一编码【已实现/已存在】

`InstanceConfigService`（`services/node_mgmt.py`）对 `_NETWORK_DEVICE_MONITOR_OBJECT_NAMES = {"Switch", "Router", "Firewall", "Loadbalance"}` 四类对象（`node_mgmt.py:35`）应用专用的身份适配器（`_prepare_network_device_identity_instances`，`node_mgmt.py:679-694`）：

- 从实例中提取 `cloud_region_id`（或 `cloud_region`）与 `ip`，若字段缺失则尝试从 `instance_id` 字符串按 `:` 或 `_` 分隔解析（`node_mgmt.py:697-716`）。
- 以 `build_safe_instance_id(cloud_region, ip)` 生成规范化种子，再经 `normalize_instance_identity` 产出 `storage_instance_key`，作为最终落库与查询的实例 ID。
- 效果：同一台设备（同云区域 + IP）无论通过哪个厂商 SNMP 插件上报，均映射到同一 `storage_instance_key`，多插件采集数据收敛到同一资产实例，避免重复实例。

> 证据来源：`server/apps/monitor/services/node_mgmt.py:35,648-650,679-716,780-782`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.5 已有接口（汇总）

各为独立 ViewSet 路由：`monitor_object`、`monitor_object_type`、`metrics_group`、`metrics`、`metrics_instance`、`organization_rule`、`monitor_instance`、`monitor_policy`、`monitor_plugin`、`monitor_alert`、`monitor_event`、`manual_collect`、`unit`、`monitor_condition`、`system_mgmt`、`node_mgmt`；开放端点 `open_api/infra`。

**MonitorPolicy 写入契约（校验层）**：`MonitorPolicySerializer` 新增字段级校验——`validate_threshold` 挡非法运算符/等级；`validate_query_condition` 校结构完整性并对 `filter` 中的 label name（`_LABEL_NAME_RE`）与运算符（`_VALID_LABEL_METHODS`）执行注入白名单校验；`validate_source` 检查 type∈{instance,organization}；`validate_algorithm` 挡不在下游支持集内的聚合函数。非法配置在 API 写入边界即被拒绝，不延迟到后台扫描期崩溃。

> 证据来源：`server/apps/monitor/serializers/monitor_policy.py:21-128`　|　同步基线：0fbb99c2　|　【已实现】

- Celery 任务与调度【已实现/已存在】：
  - `tasks/grouping_rule.py:sync_instance_and_group`（同步实例分组，查 VM）—— 由 beat 每 10 分钟触发（`config.py:8-11`）。
  - `tasks/monitor_policy.py:retry_alert_center_lifecycle_notify_task`（告警中心生命周期通知重试，`monitor_policy.py:100`）—— 由 beat 每 5 分钟触发（`config.py:12-15`）。
  - `tasks/monitor_policy.py:scan_policy_task`（策略扫描评估）—— 不在静态 `config.py` 中，而是按每条策略的 `schedule`（min/hour/day）动态注册为 django-celery-beat 的 `PeriodicTask`（任务名 `scan_policy_task_{policy_id}`），在策略保存时由 `views/monitor_policy.py:380-395` 创建/更新（crontab 由 `format_crontab` 依策略调度生成，`views/monitor_policy.py:340-378`）；仍属周期调度，只是周期随策略而定，非 NATS 触发。
- 策略扫描服务层 `tasks/services/policy_scan/`：`scanner.py`、`metric_query.py`、`alert_detector.py`、`event_alert_manager.py`、`snapshot_recorder.py`（入口 `MonitorPolicyScan`）。
- `retry_alert_center_lifecycle_notify_task` 关键约束【已实现/已存在】：每次最多取 200 条待重试告警（`monitor_policy.py:110`）；单条最大重试 10 次（`alert_center_retry_count__lt=10`，`monitor_policy.py:109`）；达上限的告警以 ERROR 汇总告警并不再补偿，需人工介入（`monitor_policy.py:149-154`）。
- NATS【已实现/已存在】：`nats/monitor.py` 注册大量 handler，经 `apps/rpc/monitor.py` 暴露并被 operation_analysis、opspilot 消费：
  - 创建类（`monitor.py:471-519`）：`create_monitor_object_type` / `create_monitor_object` / `create_monitor_plugin` / `create_metric_group` / `create_metric` / `create_monitor_policy`。
  - 查询类（`monitor.py:520-1063`）：`monitor_objects` / `monitor_object_instance_count` / `monitor_metrics` / `monitor_object_instances` / `query_monitor_data_by_metric` / `monitor_instance_metrics` / `query_monitor_alert_segments` / `query_latest_active_alerts` / `mm_query` / `mm_query_range` / `get_monitor_statistics`。
  - 权限授权类：`_get_authorized_monitor_instances` 等内部辅助（`monitor.py:425-462`）；`nats/permission.py:7,33` 另注册 `get_monitor_module_data` / `get_monitor_module_list`，按组织过滤实例/策略/条件。
  - **`get_monitor_statistics` 权限口径加固**：本轮引入 `_scope_count_queryset` 统一收窄逻辑——超管返回全量；非超管且无 team 视为零授权，**返回空集（`qs.none()`）而非全量**，杜绝无组织归属用户跨组织计数泄露。平台级目录（监控对象/类型/插件/指标/指标分组）属全局配置、非租户数据，不做组织收窄；仅监控实例/采集配置/策略及下游告警类计数按 org 收窄。

> 证据来源：`server/apps/monitor/nats/monitor.py:1041-1051`（_scope_count_queryset，qs.none()）、`:1055-1109`（get_monitor_statistics 收窄逻辑）　|　同步基线：0fbb99c2　|　【已实现】

- 流量监控接入（NetFlow/sFlow）【已实现/已存在】：服务层 `services/flow_*.py` 承载流量接入能力，对应 PRD「集成·流量监控接入」：
  - `flow_access_guide.py:10` 定义协议监听端口 `PROTOCOL_PORT_MAP = {netflow:2055, sflow:6343}`，依赖 `apps/rpc/node_mgmt` 拼接云区域接入地址。
  - `flow_onboarding.py:17` 创建/绑定流量资产，兜底采样率默认 1000（`DEFAULT_FALLBACK_SAMPLING_RATE`）。资产标识键由 `_build_asset_key(cloud_region_id, ip)` 生成，底层调用 `utils/dimension.py:build_safe_instance_id` 基于 region+ip 组合构建安全实例 ID（替代旧 `flow:{obj}:{region}:{ip}` 格式）；`_ensure_asset_storage_key` 检测已有实例是否使用旧键格式，若发现则通过 `_move_asset_references` 将存储键与历史实例引用迁移至新格式，保证兼容性。
  - `flow_env_config.py` 按云区域刷新采集器环境变量（`refresh_collect_configs`）。
  - `flow_sampling.py:10` 的 `FlowSamplingService.normalize_payload` 归一化上报载荷，产出 `effective_sampling_rate` 字段及来源标记 `sampling_rate_source`（上报值 `reported_effective_sampling_rate` / 派生 `normalized_from_*` / 兜底 `fallback_sampling_rate`）。

> 证据来源：`server/apps/monitor/services/flow_onboarding.py:405-442`（_build_asset_key/_ensure_asset_storage_key/_move_asset_references）、`server/apps/monitor/utils/dimension.py:build_safe_instance_id`　|　同步基线：0fbb99c2　|　【已实现】

## 5. 数据流【已实现/已存在】
- 指标采集与告警评估：telegraf 采集 → VictoriaMetrics →（PromQL）scan_policy_task → 阈值/聚合/恢复评估 → MonitorEvent → MonitorAlert（原始快照存 MinIO）。
- 事件写入一致性：事件原始数据（MonitorEventRawData）写入由逐条 `save` 改为 `bulk_create` 并置于 `transaction.atomic` 事务保护，告警中心通知延后到 `on_commit` 回调后触发，确保通知不早于数据持久化完成。

> 证据来源：`server/apps/monitor/tasks/services/policy_scan/event_alert_manager.py`（transaction.atomic / bulk_create / _schedule_notifications on_commit）　|　同步基线：0fbb99c2　|　【已实现】

- 流量监控接入：网络设备发送 NetFlow(2055)/sFlow(6343) → 采集器按云区域环境变量监听（`flow_env_config.py`） → 采样率归一化（`flow_sampling.py`） → 入 VictoriaMetrics，复用上述告警评估链路。
- 漏跑补偿机制【已实现/已存在】：`scan_policy_task` 基于策略 `last_run_time` 与当前时间计算 gap，按周期数自动补偿历史扫描点（`tasks/monitor_policy.py:59-77`）。补偿上限：单次最多 `MAX_BACKFILL_COUNT=30` 个周期、最大补偿时间范围 `MAX_BACKFILL_SECONDS=24*3600` 秒，超出范围的历史数据不再补偿（`constants/alert_policy.py:5-7`）。

## 6. 风险 / 待确认
- VM 高基数查询的性能与限流策略【待确认】。
- 与 alerts 模块的告警职责边界（monitor 自有 Alert vs 统一 alerts）【推断为分层，需确认收敛路径】。

## 7. 证据来源
`server/apps/monitor/{urls.py,config.py,constants/alert_policy.py,models/*,tasks/*,views/monitor_policy.py,views/monitor_object.py,services/flow_*.py,services/node_mgmt.py,services/policy_preview.py,utils/victoriametrics_api.py,nats/monitor.py,nats/permission.py}`、`server/apps/rpc/monitor.py`、`server/apps/monitor/support-files/plugins/Telegraf/snmp_*/`。
