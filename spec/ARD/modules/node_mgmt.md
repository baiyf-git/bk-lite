# 模块 ARD：Node Management（节点管理）

> 路径 `server/apps/node_mgmt` ｜ API 前缀 `api/v1/node_mgmt/`

## 1. 职责【已实现/已存在】
纳管分布式基础设施：节点、控制器（controller）、采集器（collector）、云区域（cloud region）与 sidecar 配置；负责 agent 部署、健康检查、采集器生命周期与配置下发（经 NATS）。

## 2. 数据模型与存储【已实现/已存在】
| 模型 | 文件 | 说明 |
|------|------|------|
| Node / Collector / Controller | `models/sidecar.py` | 节点、采集组件、管理 agent；Node 含 `node_type`（默认 host，支持容器节点类型）与 `install_method` 字段，二者影响安装与采集行为（`models/sidecar.py:44-49`），migration `0035_backfill_container_node_cpu_architecture.py` 对容器节点 CPU 架构做回填 |
| SidecarApiToken | `models/sidecar.py:162` | sidecar 鉴权令牌（`node_id` + `token`），节点激活后注册获得（对齐 PRD 云区域.md §5） |
| NodeCollectorConfiguration | `models/sidecar.py:120` | 节点与采集器配置的关联 |
| NodeCollectorInstallStatus | `models/installer.py:9` | 节点-采集器安装状态跟踪 |
| CloudRegion / SidecarEnv | `models/cloud_region.py` | 部署区域、sidecar 环境变量；CloudRegion 含 `proxy_address` 字段（migration `0027_cloudregion_proxy_address.py` 新增，`models/cloud_region.py:9`），被 NATS handler `get_cloud_region_proxy_address` 与采集器配置下发逻辑消费；SidecarEnv 新增键 `NATS_TLS_CA_WIN_FILE`（Windows 节点 CA 文件路径）：NATS handler `cloudregion_tls_env_by_node_id`（`nats/node.py:468`）按节点云区域返回含该键的环境变量字典（`nats/node.py:476,481,489`），Linux/Windows 的 CA 路径区分由采集器模板按 OS 变体渲染实现——Windows 侧 `nats` 模板引用 `${NATS_TLS_CA_WIN_FILE}`、Linux 侧引用 `${NATS_TLS_CA_FILE}`（`support-files/collectors/{Telegraf,Vector,NATS-Executor}.json`） |
| CloudRegionService | `models/cloud_region.py:30` | 云区域服务（stargazer/nats-executor）的部署与健康状态，为 §4 `check_all_region_services` 健康检查的存储载体 |
| PackageVersion | `models/package.py` | agent/采集器安装包（存 MinIO） |
| ControllerTask(Node) / CollectorActionTask(Node) | `models/{installer,action}.py` | 安装/升级、采集器启停动作及节点级状态 |
| NodeComponentVersion | `models/node_version.py` | 组件版本与可升级标记 |

**存储**：PostgreSQL（ORM）；MinIO（安装包，`utils/s3.py`）。

## 3. 接口【已实现/已存在】
REST 路由组：`node`/`cloud_region`/`sidecar_env`/`collector`/`controller`/`configuration`/`child_config`/`installer`/`package`；`open_api`（sidecar 可访问，`OpenSidecarViewSet`）。路由组未增减，API 前缀不变。

**RBAC 鉴权收口**（写操作均已加 `@HasPermission` 装饰器）：
- 云区域视图：`partial_update`→`cloud_region-Edit`、`create`→`cloud_region-Create`、`destroy`→`cloud_region-Delete`、`deploy_command`→`cloud_region-DeployCommand`（`views/cloud_region.py:71,97,121,135`）。
- 变量视图：`create`/`partial_update`→`cloud_region_env-Edit`、`destroy`/`bulk_delete`→`cloud_region_env-Delete`（`views/sidecar_env.py`）。
- 安装器视图：控制器 install/retry/manual_install/get_install_command→`cloud_region_node-Edit`、控制器 uninstall→`cloud_region_node-Delete`、采集器 install/install_nodes→`cloud_region_node-OperateCollector`；节点安装操作另对入参 `node_ids` 调 `authorize_node_ids` 做二次授权，采集器安装汇总查询按 `get_authorized_node_queryset` 过滤结果（`views/installer.py`、`utils/permission.py`）。

NATS handlers（`@nats_client.register`，`nats/node.py`）：
- `install_collector(data)` / `install_managed_component(data)`：经 NATS 触发采集器 / 受管组件安装，二者共用内部 `_install_collector_by_nats`（`nats/node.py:695-710`）。
- `get_cloud_region_proxy_address(cloud_region_id, organization_ids)`：返回云区域代理地址，支持按组织过滤；优先读 `CloudRegion.proxy_address`，为空时回退环境变量 `PROXY_ADDRESS`（`nats/node.py:534-569`）。

> 证据来源：`views/cloud_region.py:71,97,121,135`、`views/sidecar_env.py:21,26,30,34`、`views/installer.py:31,56,72,85,131,150,212`、`utils/permission.py:authorize_node_ids,get_authorized_node_queryset`、`nats/node.py:695-710`　|　同步基线：0fbb99c25　|　【已实现】

## 4. 通信机制【已实现/已存在】
- NATS：`nats/{node,permission}.py` 节点数据同步与权限。安装日志事件流走 NATS core 订阅：`installer.py` 通过 `subscribe_lines_sync` 订阅普通 subject `executor.stream.{execution_id}`，并未使用 JetStream 持久消费者（`tasks/installer.py:591-604`）。`subscribe_lines_sync` 定义在服务端顶层包 `server/nats_client/clients.py:256-285`（用 `nc.subscribe(subject, cb=...)` 即 core 订阅）；同文件另有 JetStream 原语 `ensure_stream`/`iter_jetstream_subject`（`server/nats_client/clients.py:304,332`），但 node_mgmt installer 未引用。
- SSH：`utils/installer.py` 远程安装控制器。
- Celery：
  - 控制器：`install/uninstall_controller`。
  - 采集器：`install_collector`（实际执行安装）；`uninstall_collector` 当前为占位任务，函数体仅 `pass`、未实现卸载逻辑（`tasks/installer.py:1148-1150`）。
  - 收敛 / 超时（两组）：控制器安装侧 `converge_controller_install_connectivity_for_node`（`tasks/installer.py:722`）/ `timeout_controller_install_task`（`tasks/installer.py:766`）；采集器动作侧 `converge_collector_action_task_for_node`（`tasks/action_task.py:153`）/ `timeout_collector_action_task`（`tasks/action_task.py:217`）。
  - 其他：`discover_node_versions`（组件版本发现，Windows 节点改用 PowerShell 执行版本命令，`tasks/version_discovery.py:87-88`）、`sync_node_properties_to_sidecar`（推送配置到 sidecar.yaml）、`check_all_region_services`（健康检查 nats-executor/stargazer）。

> 证据来源：`tasks/version_discovery.py:87-88`　|　同步基线：0fbb99c25　|　【已实现】

## 5. 安全加固【已实现/已存在】

以下三项安全加固已在本轮实现：

1. **外呼 TLS 验证**：webhook 与 manual-install 外部 HTTP 请求由原先硬编码 `verify=False` 改为调用 `get_webhook_tls_verify()` 读取配置决策，支持环境级 TLS 信任策略（`services/cloudregion.py:171`、`views/sidecar.py:500`、`utils/installer.py:70`）。
2. **模板渲染沙箱化**：采集器配置与 sidecar 配置模板渲染由 `jinja2.Template` 直接实例化改为 `core.build_sandboxed_env().from_string()`，防止 SSTI 注入（`services/node.py`、`services/sidecar.py:849`）。
3. **节点列表 fail-closed**：`NodeService.get_node_list` 在无权限上下文、无 `organization_ids` 限定、且未显式 `skip_permission=True` 时返回 `Node.objects.none()`，不再返回全表；系统级内部调用（如 NATS handler `node_list`）需显式传 `skip_permission=True` 绕过（`services/node.py:347-372`、`nats/node.py:586-599`）。

> 证据来源：`services/cloudregion.py:171`、`views/sidecar.py:500`、`utils/installer.py:70`、`services/node.py:347-372`、`services/sidecar.py:849`、`nats/node.py:586-599`　|　同步基线：0fbb99c25　|　【已实现】

## 6. 风险 / 待确认
- 安装日志事件流采用 NATS core 订阅（`subscribe_lines_sync` 订阅 `executor.stream.{execution_id}`），不依赖 JetStream，订阅在超时或 `stop_event` 后即解订阅、不做持久化与重放，进程/网络中断期间的日志行可能丢失【已实现，见 `tasks/installer.py:591-604`、`server/nats_client/clients.py:256-285`】。
- SSH 凭据/私钥的存储与保护（部分存 MinIO）【待确认】。
- sidecar 心跳不再以 group tag 覆盖服务端组织归属：sidecar 每次心跳上报时已移除 `sync_groups` 逻辑，节点组织归属由服务端/UI 维护，不再被 sidecar 侧 tag 覆盖还原（`services/sidecar.py:476-481`）【已实现】。

## 7. 证据来源
- `server/apps/node_mgmt/{urls.py,models/*,nats/*,tasks/*,utils/{s3,installer,permission,token_auth}.py,constants/cloudregion_service.py,management/commands/reset_node_token.py}`。
- 视图鉴权：`views/cloud_region.py:71,97,121,135`、`views/sidecar_env.py:21,26,30,34`、`views/installer.py:31,56,72,85,131,150,212`。
- 权限工具：`utils/permission.py:35`（get_node_permission 改用 get_current_team）、`utils/permission.py:260-285`（authorize_target_organizations 超管直通 + GroupUtils.get_group_with_descendants）。
- 模型：`models/sidecar.py:44-49`（Node.node_type/install_method）、`models/sidecar.py:162-168`（SidecarApiToken）、`models/cloud_region.py:9`（CloudRegion.proxy_address）、`models/cloud_region.py:30-42`（CloudRegionService）。
- NATS handlers：`nats/node.py:468,476,481,489`（cloudregion_tls_env_by_node_id / NATS_TLS_CA_WIN_FILE）、`nats/node.py:534-569`（get_cloud_region_proxy_address）、`nats/node.py:586-599`（node_list skip_permission）、`nats/node.py:695-710`（install_collector / install_managed_component / _install_collector_by_nats）。
- 安装事件流（NATS core）：`tasks/installer.py:591-604`、`server/nats_client/clients.py:256-285`。
- Celery 收敛/超时与卸载：`tasks/installer.py:722,766`、采集器卸载占位任务 `tasks/installer.py:1148-1150`、`tasks/action_task.py:153,217`。
- 版本发现：`tasks/version_discovery.py:87-88`（Windows PowerShell 版本命令）。
- 安全加固：`services/cloudregion.py:171`、`views/sidecar.py:500`、`utils/installer.py:70`（TLS 验证）、`services/node.py`（沙箱 jinja / fail-closed）、`services/sidecar.py:476-481`（移除 sync_groups）、`services/sidecar.py:849`（沙箱 jinja）。
- migration：`migrations/0027_cloudregion_proxy_address.py`、`migrations/0035_backfill_container_node_cpu_architecture.py`。
- 其他：`utils/token_auth.py`（decode_token 增 node_id 参数，运维友好诊断日志）、`utils/task_result_schema.py`（新增 installer_summary 字段）、`management/commands/reset_node_token.py`（reset_node_token 管理命令）。
