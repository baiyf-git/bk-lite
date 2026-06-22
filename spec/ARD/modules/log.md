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
| Policy / PolicyOrganization / Alert / Event / EventRawData | `models/policy.py` | 日志告警策略、生成的告警/事件/原始日志；`Event` 新增 `notified`（BooleanField，db_index，通知是否已成功发送）与 `notice_retry_count`（IntegerField，通知重试次数），承载通知 at-least-once 可靠性 |
| AlertSnapshot | `models/policy.py:127` | 告警生命周期快照（存 S3/MinIO，支持压缩） |

**存储**：PostgreSQL（元数据）；**VictoriaLogs**（日志，`utils/query_log.py` + `constants/victoriametrics.py`，环境变量 `VICTORIALOGS_*`）。

## 3. 接口【已实现/已存在】
`collect_types`/`collect_instances`/`collect_configs`/`k8s_collect`/`node_mgmt`/`log_group`/`search`/`search_conditions`/`policy`/`alert`/`event`/`event_raw_data`/`system_mgmt`；开放端点 `open_api/k8s`。

**接口契约变化（破坏性）**：`alert/{id}/closed` 关闭告警接口新增 Operate 权限校验，调用方须持有该告警归属组织的 Operate 操作权限，否则返回 403。证据：`views/policy.py:AlertViewSet._authorize_alert_operate` + `closed`  |  同步基线：77bb6c6  |  【已实现】

## 4. 依赖与通信【已实现/已存在】
- 依赖 `apps.core`（logger/异常/权限工具）、`apps.rpc.node_mgmt.NodeMgmt`（K8s 节点）。
- 业务服务层：`services/`（`access_scope.py` 权限范围 `LogAccessScopeService`、`collect_type.py` `CollectTypeService`、`k8s_collect.py` `K8sLogCollectService`、`search.py` `SearchService`）封装采集/查询/权限的业务逻辑（注：`services/policy.py` 为 0 字节空占位文件，策略业务逻辑实际落在 `views/policy.py` 与 `tasks/services/policy_scan.py`）；策略评估核心为 `tasks/services/policy_scan.py:22` `LogPolicyScan`（窗口计算、关键字分组查询、阈值比较等扫描逻辑）。
- Celery（静态 beat）：仅 `compensate_log_notice_task`（通知补偿，`config.py:5` 静态注册于 `CELERY_BEAT_SCHEDULE`，crontab `*/5` 每 5 分钟一次；实现见 `tasks/policy.py`）。补偿任务依赖 `Event.notified` 标记识别发送失败事件，阈值全部 env 可调（`NOTICE_COMPENSATE_*`，含最大重投次数、补偿窗口、批处理量、最小 age 门槛）。详见 [[../../prd/日志系统/事件.md#3.3-通知可靠性]]。
- Celery（动态 PeriodicTask）：`tasks/policy.py:scan_log_policy_task(policy_id)` 不在静态 `CELERY_BEAT_SCHEDULE` 中，而是在策略保存/启停时由 `views/policy.py:461` `update_or_create_task` 按策略动态创建 `django-celery-beat` 的 `PeriodicTask`（name=`log_policy_task_<policy_id>`，crontab 调度，`args=[policy_id]`）来周期触发（扫描时间窗，支持补扫，更新 `last_run_time`）。
- NATS：`nats/log.py` 提供 `log_search`/`log_hits`/`get_vmlogs_disk_usage`/`query_log_alert_segments`；其中 `log_search`/`log_hits` 在执行前通过 `_apply_log_group_scope` 解析请求携带的 `user_info` 确定可见日志分组范围（超级管理员不限；无可见分组则返回 DENY_ALL 空结果），再改写查询语句实现基于可管理组织的权限范围过滤。`nats/permission.py` 提供 `get_log_module_data`（获取日志模块权限数据）与 `get_log_module_list`（获取日志模块列表），供系统管理侧获取日志模块权限数据/列表。

## 5. 风险 / 待确认
- VictoriaLogs 写入路径（采集器→VLogs）的采集器实现【已实现】：采集器插件以目录形式注册（`constants/plugin.py:5` DIRECTORY=`apps/log/support-files/plugins`，`management/services/plugin.py:23` 扫描各子目录 `collect_type.json`），共 6 类采集器、合计 18 个采集类型——**Filebeat**（9 类：apache/elasticsearch/kafka/mongodb/mysql/nginx/postgresql/rabbitmq/redis，`support-files/plugins/Filebeat/*/collect_type.json`，各文件 `"collector": "Filebeat"`）、**Vector**（4 类：docker/file/kubernetes/syslog，`support-files/plugins/Vector/syslog/collect_type.json:3`）、**Packetbeat**（2 类：flows/http）、**Auditbeat**（file_integrity）、**Snmptrapd**（SNMP Trap，`support-files/plugins/Snmptrapd/network/collect_type.json:3`）、**Winlogbeat**（Windows 事件日志）。
- 查询限额默认值与对应环境变量【已实现，见 `constants/victoriametrics.py:16-22`，均可由环境变量覆盖】：
  - `QUERY_LIMIT_MAX`=1000（env `VICTORIALOGS_QUERY_LIMIT_MAX`，单次日志检索条数上限）
  - `FIELD_VALUES_LIMIT_MAX`=1000（env `VICTORIALOGS_FIELD_VALUES_LIMIT_MAX`，字段值枚举上限）
  - `HITS_FIELDS_LIMIT_MAX`=100（env `VICTORIALOGS_HITS_FIELDS_LIMIT_MAX`，hits 分组字段上限）
  - SSE 连接：`MAX_CONNECTION_TIME`=1800s（env `SSE_MAX_CONNECTION_TIME`）、`KEEPALIVE_INTERVAL`=45s（env `SSE_KEEPALIVE_INTERVAL`）
  - 上述限额对大查询的影响【需运维核对】。
- 告警通知与快照限额（env 可调）【已实现】：
  - `LOG_MAX_ALERT_SNAPSHOTS`=500：单告警快照保留最新 N 条，超限丢弃最旧，防 S3 对象膨胀。
  - `LOG_GROUPED_ALERT_MAX_WORKERS`=10：关键字分组告警检测并发线程上限。
  - `LOG_NOTICE_SEND_MAX_ATTEMPTS`=3：send_notice 内联重试总尝试次数（含首发）。
  - `LOG_NOTICE_SEND_RETRY_BACKOFF_SECONDS`=1：内联重试线性退避基准秒数。
  - `LOG_NOTICE_COMPENSATE_MAX_RETRY`=5：单事件补偿任务最多重投次数。
  - `LOG_NOTICE_COMPENSATE_WINDOW_SECONDS`=86400（24 小时）：补偿任务回扫的时间窗口。
  - 上述阈值的合理取值需根据通知渠道可靠性与扫描频率在运维侧调校【需运维核对】。

## 6. 证据来源
`server/apps/log/{urls.py,models/*,services/*,utils/query_log.py,constants/victoriametrics.py:16-22,constants/plugin.py:5,config.py:5,views/policy.py:461-476,tasks/policy.py:14-15,tasks/services/policy_scan.py:22,nats/log.py,nats/permission.py:6-7,29-30,management/services/plugin.py:23,support-files/plugins/{Filebeat,Vector,Packetbeat,Auditbeat,Snmptrapd,Winlogbeat}/*/collect_type.json,support-files/plugins/Vector/syslog/collect_type.json:3,support-files/plugins/Snmptrapd/network/collect_type.json:3}`。

本次增量修订（基线 77bb6c6）新增证据：
- `models/policy.py:100-101`（Event.notified / notice_retry_count 字段）
- `migrations/0016_event_notified_event_notice_retry_count.py`（migration 证据）
- `constants/alert_policy.py:13-25`（通知重试/补偿阈值常量）
- `tasks/policy.py:compensate_log_notice_task`（静态 beat 补偿实现）
- `tasks/services/policy_scan.py:12-16`（模块常量 `_MAX_ALERT_SNAPSHOTS`，env `LOG_MAX_ALERT_SNAPSHOTS`）；`policy_scan.py:226`（分组采样并发 `max_workers`，inline env `LOG_GROUPED_ALERT_MAX_WORKERS`，非模块级常量）
- `tasks/services/policy_scan.py:_keyword_grouped_alert_detection`（关键字分组告警检测）
- `tasks/services/policy_scan.py:_render_alert_name`（告警名 ${field} 渲染）
- `serializers/policy.py:93 get_alert_name`（AlertSerializer 展示渲染后名称）
- `views/policy.py:AlertViewSet._authorize_alert_operate + closed`（关闭权限校验）
- `nats/log.py:_apply_log_group_scope、_resolve_log_group_scope`（NATS 日志分组权限过滤）
- `utils/plugin_controller.py:validate_packetbeat_network_switches/validate_packetbeat_http_ports/normalize_packetbeat_device`（Packetbeat 参数校验与网卡规范化）
- `views/collect_config.py:_get_log_group_create_attrs`（日志分组创建字段发现范围）

> 证据来源：上述文件列表　|　同步基线：77bb6c6　|　【已实现】
