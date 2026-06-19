# 模块 ARD：Log（日志中心）

> 路径 `server/apps/log` ｜ API 前缀 `api/v1/log/`

## 1. 职责【已实现/已存在】
日志采集配置、基于 VictoriaLogs 的查询管线、以及基于日志模式的告警策略执行。

## 2. 数据模型与存储【已实现/已存在】
| 模型 | 文件 | 说明 |
|------|------|------|
| CollectType | `models/collect_type.py` | 采集方式（采集器、默认查询） |
| CollectInstance / CollectInstanceOrganization / CollectConfig | `models/instance.py` | 采集实例（绑定 node）、组织权限、采集配置 |
| LogGroup / LogGroupOrganization / SearchCondition | `models/log_group.py` | 多租户日志分组、组织权限、保存的搜索条件 |
| Policy / PolicyOrganization / Alert / Event / EventRawData | `models/policy.py` | 日志告警策略、生成的告警/事件/原始日志 |
| AlertSnapshot | `models/policy.py:127` | 告警生命周期快照（存 S3/MinIO，支持压缩） |

**存储**：PostgreSQL（元数据）；**VictoriaLogs**（日志，`utils/query_log.py` + `constants/victoriametrics.py`，环境变量 `VICTORIALOGS_*`）。

## 3. 接口【已实现/已存在】
`collect_types`/`collect_instances`/`collect_configs`/`k8s_collect`/`node_mgmt`/`log_group`/`search`/`search_conditions`/`policy`/`alert`/`event`/`event_raw_data`/`system_mgmt`；开放端点 `open_api/k8s`。

## 4. 依赖与通信【已实现/已存在】
- 依赖 `apps.core`（logger/异常/权限工具）、`apps.rpc.node_mgmt.NodeMgmt`（K8s 节点）。
- **当前组织上下文读取**【已实现/已存在】：日志模块全部视图与服务（`services/access_scope.py`、`views/collect_config.py`、`views/policy.py`、`views/search.py`、`views/node.py`、`views/system_mgmt.py`，共 6 个文件）中读取 `current_team` 的调用，已统一替换为 `apps.core.utils.team_utils.get_current_team(request)`（`apps/core/utils/team_utils.py:23`）。该 helper 的来源优先级为：① `request._api_current_team`（`APISecretMiddleware` 在 API Key 认证时注入）→ ② `request.COOKIES["current_team"]`（浏览器登录时携带）→ ③ `default`（`None`）。此重构使日志模块的组织/权限过滤（采集类型、采集实例、策略、告警、搜索条件、节点、system_mgmt 用户/渠道查询、`LogAccessScopeService` 组织校验）在 **API Key 调用**场景下也能正确解析当前组织上下文，此前仅浏览器 cookie 场景可解析。无新增接口、无契约破坏、无存储后端变化；组织信息缺失时的报错语义（「当前组织信息不存在，请重新登录」）不变。
- 业务服务层：`services/`（`access_scope.py` 权限范围 `LogAccessScopeService`、`collect_type.py` `CollectTypeService`、`k8s_collect.py` `K8sLogCollectService`、`search.py` `SearchService`）封装采集/查询/权限的业务逻辑（注：`services/policy.py` 为 0 字节空占位文件，策略业务逻辑实际落在 `views/policy.py` 与 `tasks/services/policy_scan.py`）；策略评估核心为 `tasks/services/policy_scan.py:22` `LogPolicyScan`（窗口计算、关键字分组查询、阈值比较等扫描逻辑）。
- Celery（静态 beat）：仅 `compensate_log_notice_task`（通知补偿，`config.py:5` 静态注册于 `CELERY_BEAT_SCHEDULE`，crontab `*/5` 每 5 分钟一次；实现见 `tasks/policy.py`）。
- Celery（动态 PeriodicTask）：`tasks/policy.py:scan_log_policy_task(policy_id)` 不在静态 `CELERY_BEAT_SCHEDULE` 中，而是在策略保存/启停时由 `views/policy.py:461` `update_or_create_task` 按策略动态创建 `django-celery-beat` 的 `PeriodicTask`（name=`log_policy_task_<policy_id>`，crontab 调度，`args=[policy_id]`）来周期触发（扫描时间窗，支持补扫，更新 `last_run_time`）。
- NATS：`nats/log.py` 提供 `log_search`/`log_hits`/`get_vmlogs_disk_usage`/`query_log_alert_segments`；`nats/permission.py` 提供 `get_log_module_data`（获取日志模块权限数据）与 `get_log_module_list`（获取日志模块列表），供系统管理侧获取日志模块权限数据/列表。

## 5. 风险 / 待确认
- VictoriaLogs 写入路径（采集器→VLogs）的采集器实现【已实现】：采集器插件以目录形式注册（`constants/plugin.py:5` DIRECTORY=`apps/log/support-files/plugins`，`management/services/plugin.py:23` 扫描各子目录 `collect_type.json`），共 6 类采集器、合计 18 个采集类型——**Filebeat**（9 类：apache/elasticsearch/kafka/mongodb/mysql/nginx/postgresql/rabbitmq/redis，`support-files/plugins/Filebeat/*/collect_type.json`，各文件 `"collector": "Filebeat"`）、**Vector**（4 类：docker/file/kubernetes/syslog，`support-files/plugins/Vector/syslog/collect_type.json:3`）、**Packetbeat**（2 类：flows/http）、**Auditbeat**（file_integrity）、**Snmptrapd**（SNMP Trap，`support-files/plugins/Snmptrapd/network/collect_type.json:3`）、**Winlogbeat**（Windows 事件日志）。
- 查询限额默认值与对应环境变量【已实现，见 `constants/victoriametrics.py:16-22`，均可由环境变量覆盖】：
  - `QUERY_LIMIT_MAX`=1000（env `VICTORIALOGS_QUERY_LIMIT_MAX`，单次日志检索条数上限）
  - `FIELD_VALUES_LIMIT_MAX`=1000（env `VICTORIALOGS_FIELD_VALUES_LIMIT_MAX`，字段值枚举上限）
  - `HITS_FIELDS_LIMIT_MAX`=100（env `VICTORIALOGS_HITS_FIELDS_LIMIT_MAX`，hits 分组字段上限）
  - SSE 连接：`MAX_CONNECTION_TIME`=1800s（env `SSE_MAX_CONNECTION_TIME`）、`KEEPALIVE_INTERVAL`=45s（env `SSE_KEEPALIVE_INTERVAL`）
  - 上述限额对大查询的影响【需运维核对】。

## 6. 证据来源
`server/apps/log/{urls.py,models/*,services/*,utils/query_log.py,constants/victoriametrics.py:16-22,constants/plugin.py:5,config.py:5,views/policy.py:461-476,tasks/policy.py:14-15,tasks/services/policy_scan.py:22,nats/log.py,nats/permission.py:6-7,29-30,management/services/plugin.py:23,support-files/plugins/{Filebeat,Vector,Packetbeat,Auditbeat,Snmptrapd,Winlogbeat}/*/collect_type.json,support-files/plugins/Vector/syslog/collect_type.json:3,support-files/plugins/Snmptrapd/network/collect_type.json:3}`；当前组织读取统一化：`server/apps/core/utils/team_utils.py:23-41`（`get_current_team` 实现与优先级）；调用侧：`server/apps/log/services/access_scope.py:26`、`server/apps/log/views/collect_config.py:160,199,304,463`、`server/apps/log/views/policy.py:49,144,224,532,585,600,732,747`、`server/apps/log/views/search.py:185,210,233,250,260,289`、`server/apps/log/views/node.py:28`、`server/apps/log/views/system_mgmt.py:12,20`。
