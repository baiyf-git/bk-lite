# 模块 ARD：Alerts（统一告警）

> 路径 `server/apps/alerts` ｜ API 前缀 `api/v1/alerts/`

## 1. 职责【已实现/已存在】
多源事件接入、标准化、丰富、指纹聚合/降噪、事件→告警→事件单（Incident）生命周期管理与通知分派。

## 2. 数据模型与存储【已实现/已存在 / PostgreSQL】
| 模型 | 文件 | 说明 |
|------|------|------|
| Event / Alert / Incident / IncidentUpdate / Level | `models/models.py` | 原始事件、聚合告警（指纹去重）、事件单、协作、级别；Event 与 Alert 各新增 `enrichment` JSONField，按来源命名空间分区存储丰富数据 |
| AlertSource | `models/alert_source.py` | 告警源（secret/team_secrets/config） |
| AlertAssignment / AlertShield / AlertReminderTask / AlertEscalationTask / AlarmStrategy / NotifyResult | `models/alert_operator.py` | 分派/抑制/提醒/升级/降噪策略/通知审计 |
| OperatorLog | `models/operator_log.py`（operator_log.py:10） | 操作审计 |
| SystemSetting | `models/sys_setting.py`（sys_setting.py:11） | 配置开关（全局默认值等） |
| EnrichmentRule | `models/enrichment.py` | 声明式丰富（Lookup）规则：`match_rules`(OR-of-AND 作用范围) / `provider_type`(默认 cmdb) / `input_binding`(入参绑定) / `provider_config`(Provider 专属配置) / `output_projection`(出参投影) / `on_multiple`(first/merge/list 多结果策略) / `namespace`(命名空间，缺省回落 provider_type) / `is_active` / `team`；表 `alerts_enrichment_rule`（migration 0019） |

> 证据来源：`models/models.py:51,150`，`models/enrichment.py:8-30`，`migrations/0019_*`　|　同步基线：0fbb99c25　|　【已实现/已存在】

## 3. 接口【已实现/已存在】
所有 ViewSet 路由组均以 `router.register(r"api/<name>", ...)` 注册（urls.py:27-44），故完整路径统一带 `api/` 段，例如 `api/v1/alerts/api/alert_source/`。路由组：`api/alert_source`/`api/alerts`/`api/events`/`api/level`/`api/settings`/`api/assignment`/`api/shield`/`api/incident`(+`/(?P<incident_pk>\d+)/updates`)/`api/alarm_strategy`/`api/log`/`api/enrichment`；开放端点 `open_api/k8s`（urls.py:44）。
path 端点（urls.py:47-49）：`api/test/`（request_test，receiver.py:107）、`api/receiver_data/`（receiver_data）、`api/source/<str:source_id>/webhook/`（receiver_source_data）。完整路径分别为 `api/v1/alerts/api/test/` 等。

`api/enrichment`（EnrichmentRuleModelViewSet）提供 CRUD 及自定义 GET action `metrics`（返回 total_rules/active_rules/active_rule_ratio/user_created_rules/total_alerts/enriched_alerts/enriched_alert_ratio 采纳漏斗指标）。CRUD 受细粒度权限码 `alert_enrichment-View/Add/Edit/Delete` 守卫（HasPermission），写操作（create/update/destroy）经 `record_operator_log` 留痕至 OperatorLog 并镜像进平台操作日志。参见 [[../../fuctionlist/03-告警中心-功能清单.md#14-告警丰富]]。

> 证据来源：`urls.py:35`，`views/enrichment.py:18-114`　|　同步基线：0fbb99c25　|　【已实现/已存在】

## 4. 接入与丰富【已实现/已存在】
- 适配器 `common/source_adapter/`：Prometheus / Zabbix / NATS / webhook / monitor / restful；基类 `base.py` 负责字段映射、恢复检测、屏蔽校验，并在 `create_events()` 整批映射后调用声明式丰富引擎执行批量丰富（旧的 `enable_rich_event` / `rich_event()` / `enrich_event()` 单条 CMDB 富化与 SystemSetting `alert_enrich` 开关已下线 @0fbb99c25）。
- `main()` 执行顺序【已实现/已存在】（`base.py:552-568`）：① `event_operator(bulk_events)`（屏蔽写入） → ② `InstantAlertDispatcher.dispatch(bulk_events)`（即时旁路） → ③ `handle_recovery_events()`（聚合/恢复）。屏蔽必须先于即时旁路执行，确保即时旁路按库内最新屏蔽状态过滤；`event_operator` 位于即时旁路之前执行（`base.py:557`）。
- 聚合主路径显式排除已屏蔽事件【已实现/已存在】：`AggregationProcessor.get_events_for_strategy()` 查询时追加 `.exclude(status=EventStatus.SHIELD)`（`aggregation/processor/aggregation_processor.py:136`），被屏蔽事件不参与指纹聚合也不产出告警。
- 即时旁路前置屏蔽过滤【已实现/已存在】：`InstantAlertDispatcher.dispatch()` 在收集命中规则之前调用 `_exclude_shielded(events)` 静态方法（`instant_dispatcher.py:273,310`），该方法按 `event_id` 查库过滤 `status=SHIELD` 的事件；内存中 `Event` 对象的状态可能滞后，故以库内当前值为准。
- 丰富引擎（`enrichment/`）【已实现/已存在】：`create_events()` 整批映射事件后调用 `EnrichmentEngine().enrich_batch()`，引擎执行以下流程：按 `is_active` 筛选规则 → matcher OR-of-AND 匹配（支持 eq/ne/contains/not_contains/正则 re/in/not_in） → keys 归一化入参绑定 → 批内 key 去重（避免重复 provider 查询） → 内存缓存（TTL=60s，含负缓存哨兵） → 单批 key 上限 500（截断保护） → `provider.fetch_batch()` 批量查询 → projection 投影（on_multiple first/merge/list）→ 写回 `event.enrichment[namespace]`，全程异常隔离不阻断主流程（`base.py:179`，`enrichment/engine.py:42-104`）。
- Provider 为可注册黑盒接口（`EnrichmentProvider` + `register_provider`/`get_provider` 注册表）；内置 `CMDBProvider` 经 `apps.rpc.cmdb.CMDB.search_instances_batch` 批量查询，RPC 拓扑 alerts→cmdb 保持不变、仅新增批量方法（`enrichment/providers/base.py`，`enrichment/providers/cmdb.py:13-58`，`rpc/cmdb.py:40-42`）。
- 收敛传播【已实现/已存在】：`AlertBuilder._merge_enrichment()` 按命名空间「首条非空优先」合并成员事件 `enrichment` 至 Alert 并 `save(update_fields=[..., "enrichment"])`（`aggregation/builder/alert_builder.py:122,178,284,361,375`）。
- 聚合 `aggregation/` 子目录：`processor` / `strategy`（指纹分组）/ `builder` / `recovery`（超时恢复）/ `window` / `core` / `engine` / `query` / `templates`【已实现/已存在，目录均存在】。

> 证据来源：`common/source_adapter/base.py:179`，`enrichment/engine.py:42-104`，`enrichment/matcher.py`，`enrichment/keys.py`，`enrichment/projection.py`，`enrichment/providers/base.py`，`enrichment/providers/cmdb.py:13-58`，`aggregation/builder/alert_builder.py:122,178,284,361,375`　|　同步基线：0fbb99c25　|　【已实现/已存在】

## 5. 旁路：操作日志镜像【已实现/已存在】
新增 `utils/operator_log.py` 提供 `record_operator_log` / `record_operator_logs_bulk` 两个 helper：写入 `OperatorLog` 的同时经 `apps.rpc.system_mgmt.SystemMgmt.save_operation_log` 镜像进平台操作日志（`app=alarm`）；镜像失败仅打 warning，不影响源写入（`operator_log.py:30-66`）。多处 view（含 EnrichmentRuleModelViewSet 的 create/update/destroy）已改走该 helper。

> 证据来源：`utils/operator_log.py:30-66`，`views/enrichment.py:50,65,85`　|　同步基线：0fbb99c25　|　【已实现/已存在】

## 6. 任务与 NATS【已实现/已存在】
- Celery（`tasks/tasks.py`，均 `@shared_task`）：`event_aggregation_alert`、`beat_close_alert`、`check_and_send_reminders`、`cleanup_reminder_tasks`、`check_and_send_escalations`（升级）、`async_auto_assignment_for_alerts`（自动分派）、`build_instant_alerts`（即时告警构建）、`sync_notify`、`sync_shield`、`sync_no_dispatch_alert_notice_task`。
  - `async_auto_assignment_for_alerts` 自带分片自调度：常量 `AUTO_ASSIGNMENT_CHUNK_SIZE=200`（tasks.py:17），当待处理 alert_ids 超过该阈值时按片切分并 `.delay` 再投（tasks.py:132,154-157）【已实现/已存在】。
  - `build_instant_alerts` 配置重试策略 `autoretry_for=(Exception,)`、`retry_backoff=True`、`max_retries=3`（tasks.py:198-202）【已实现/已存在】。
- 缺失检测告警自动分派【已实现/已存在】：`_trigger_missing_alert()` 创建告警后，通过 `transaction.on_commit(lambda: self._schedule_auto_assignment([alert_id]))` 延迟到事务提交后再触发自动分派（`aggregation_processor.py:419`）。延迟调度原因：该方法在 `select_for_update` 事务内执行，提交前调度可能因回滚造成空跑；`on_commit` 保证仅在事务成功持久化后才将 alert_id 送入分派链路，使缺失检测合成告警与常规聚合/即时告警一致进入自动分派。
- NATS（`nats/nats.py`）：`receive_alert_events` 接收事件（nats.py:532）；测试桩 `alert_test`（nats.py:675）。统计类 handler：`get_alert_trend_data`（:188）、`get_alert_source_event_top`（:265）、`get_alert_source_statistics`（:297）、`get_notification_statistics`（:350）、`get_notification_channel_stats`（:404）、`get_alert_data_quality`（:457）、`get_alert_statistics`（:684）、`get_alert_level_distribution`（:741）、`get_active_alert_top`（:782）供运营分析。
- 通知经 `utils/system_mgmt_util.py:SystemMgmtUtils.send_msg_with_channel()`（委托 system_mgmt 渠道）。

## 7. 风险 / 待确认
- 与 monitor/log 各自产生的 Alert 如何统一收敛到本模块【待确认】。
- 丰富引擎实现状态【已实现/已存在】：HEAD 下 `enrichment/` 为已跟踪 Python 源码包，包含 `engine.py`/`matcher.py`/`keys.py`/`projection.py`/`providers/base.py`/`providers/cmdb.py`；配套测试 `tests/test_enrichment_*.py`（6 个）及 `tests/test_alert_builder_enrichment.py` 均已存在；`AlertBuilder._merge_enrichment` 已在 `alert_builder.py` 实现（:122）；旧 SystemSetting `alert_enrich` 开关（`INIT_ALERT_ENRICH`）已删除，旧的 `enable_enrich`/`rich_event`/`enrich_event` 方法已下线，整套声明式 Lookup 丰富引擎已完整落地。

## 8. 证据来源
`server/apps/alerts/{urls.py:27-49,35, models/operator_log.py:10, models/sys_setting.py:11, models/models.py:51,150, models/enrichment.py:8-30, models/alert_source.py, models/alert_operator.py, common/source_adapter/base.py:179,552-568,557, aggregation/processor/aggregation_processor.py:136,419, aggregation/processor/instant_dispatcher.py:273,310,315, aggregation/{strategy,builder,recovery,window,core,engine,query,templates}/, aggregation/builder/alert_builder.py:122,178,284,361,375, enrichment/engine.py:42-104, enrichment/matcher.py, enrichment/keys.py, enrichment/projection.py, enrichment/providers/base.py, enrichment/providers/cmdb.py:13-58, views/enrichment.py:18-114, serializers/enrichment.py, filters/enrichment.py, utils/operator_log.py:30-66, tasks/tasks.py:17,132,154-157,198-202, nats/nats.py:188,265,297,350,404,457,532,675,684,741,782, views/receiver.py:107, constants/init_data.py:108,248-270, migrations/0019_*, utils/system_mgmt_util.py, rpc/cmdb.py:40-42}`；enrichment 目录已为完整 Python 源码包（engine/matcher/keys/projection/providers），并有配套测试 `tests/test_enrichment_*.py`（6 个）及 `tests/test_alert_builder_enrichment.py`；原「enrichment 目录仅含 `__pycache__`、测试 ModuleNotFoundError/AttributeError」表述已不成立，全部标【已实现/已存在】。
