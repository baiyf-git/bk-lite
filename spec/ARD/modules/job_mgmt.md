# 模块 ARD：Job Management（作业平台）

> 路径 `server/apps/job_mgmt` ｜ API 前缀 `api/v1/job_mgmt/`

## 1. 职责【已实现/已存在】
在目标主机上执行脚本、playbook 与文件分发；通过两类驱动路由执行：**nats-executor**（sidecar 节点）与 **ansible-executor**（手动/外部目标），完成回调经 NATS。

## 2. 数据模型与存储【已实现/已存在】
| 模型 | 文件 | 说明 |
|------|------|------|
| JobExecution | `models/execution.py` | 作业记录（类型/状态/目标/结果/celery_task_id/team）；另含对外/审计字段：`callback_url`（第三方回调地址）、`trigger_source`（manual/api/scheduled）、`playbook_version`（执行时版本快照）、`executor_user`（执行用户快照）、`overwrite_strategy` 等；`status` 字段加 `db_index=True`，复合索引 `(scheduled_task, status)` 命名 `jobexec_task_status_idx` |
| Script | `models/script.py` | 脚本模板（SHELL/PYTHON/POWERSHELL/BATCH，Jinja2） |
| Playbook | `models/playbook.py` | Ansible playbook ZIP（存 MinIO `job-mgmt-private`） |
| Target | `models/target.py` | 手动目标（driver=ANSIBLE/NATS_EXECUTOR，SSH/WinRM 凭据）；SSH 密钥文件经 `ssh_key_file` 存于 MinIO 桶 `job-mgmt-private`（与 Playbook 同桶），即该桶承载 Playbook ZIP 与 SSH 密钥两类文件 |
| DistributionFile | `models/distribution_file.py` | 临时分发文件（file_key + 过期清理）；文件实际上传到 NATS JetStream Object Store（前缀 `job-files/`，经 node_mgmt `upload_file_to_s3`），而非 MinIO；`is_permanent` 字段已在 migration 0009 删除，现已无「永久保存」选项，仅 `expire_at` 过期清理；新增 `team` 字段（IntegerField），开放上传/删除接口按 team 归属与鉴权【已实现/已存在】 |
| ScheduledTask | `models/scheduled_task.py` | 定时任务（并发策略） |
| DangerousRule / DangerousPath | `models/*.py` | 危险命令/路径黑名单 |

## 3. 接口【已实现/已存在】
DRF 路由前缀均带 `api/` 段；结合 app 注册前缀 `api/v1/job_mgmt/`，对外完整路径为 `api/v1/job_mgmt/api/<resource>/`：`api/target`、`api/script`、`api/playbook`、`api/execution`、`api/scheduled_task`、`api/dashboard`、`api/distribution_file`、`api/dangerous_rule`、`api/dangerous_path`。开放端点 `api/open/upload_file`、`api/open/delete_file`（同样带 `api/` 前缀）。`api/execution` 路由下另有 `api/execution/{id}/stream/`（GET，SSE 实时流式输出，非终态走 JetStream 实时回放+tail、终态走结果快照）【已实现/已存在】。

`callback_test/` 路由已于 2026-06-16 从生产路由中移除（安全债 #3402，commit d6c3aa3），当前 `urls.py` 中已不存在。

`api/dashboard` 下包含以下 action 端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `api/dashboard/trend/` | GET | 执行趋势（按日：执行次数、成功/失败/取消次数、当日平均执行时长；支持 `days` 快捷回退（默认近 7 天，上限 30 天）或自定义 `start_date`/`end_date` 闭区间（上限 90 天）；缺失日期补零） |
| `api/dashboard/success_rate_compare/` | GET | 当前周期执行成功率及与上一等长周期对比（返回：成功率、成功/失败数、平均时长、周期天数） |
| `api/dashboard/stats/` | GET | 资产与执行计数总览（目标/脚本/Playbook/定时任务总数及启用数；执行成功/失败/执行中/等待中计数；全量平均执行时长） |
| `api/dashboard/job_type_distribution/` | GET | 作业类型分布（脚本/文件分发/Playbook 各类型执行计数，降序排列） |
| `api/dashboard/execution_status_distribution/` | GET | 执行状态分布（支持同样的时间区间参数，按 `status` 分组聚合、降序排列） |

> 证据来源：`views/execution.py:190-219`（stream action）、`views/dashboard.py:83-245`（五个 dashboard action）、`serializers/dashboard.py:1-30`、`urls.py:20-52`（路由前缀 `api/`、`api/open/*`；`callback_test/` 已删除）　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 4. 执行机制【已实现/已存在】
- 脚本：危险命令校验 → Ansible（Windows 手动目标）或 nats-executor（sidecar）；日志发布到 JetStream。
- playbook：上传 ZIP 到 MinIO → 提交 `apps.rpc.ansible.AnsibleExecutor` → 异步回调。
- 文件分发：上传 NATS JetStream Object Store（前缀 `job-files/`，经 `node_mgmt.upload_file_to_s3`，非 MinIO）→ nats-executor 或 Ansible 推送。
- 回调：`nats_api.py:ansible_task_callback` 接收结果、更新 JobExecution、清理临时文件、推送 SSE 结束哨兵；对取消中（CANCELLING）的任务，收到真实结果后收敛为 CANCELLED 终态；回调数据中的 stdout/stderr/error/error_message 经 `apps.rpc.sensitive` 脱敏后再落库【已实现/已存在】。
- Celery：`execute_script_task`/`execute_playbook_task`/`distribute_files_task`/`execute_scheduled_task`；另有 `cleanup_expired_distribution_files_task`（每天 00:00 由 celery-beat 清理过期分发文件，schedule 见 `config.py`）、`do_callback_task`（带 HMAC 签名 + SSRF 二次校验、指数退避重试最多 5 次的回调任务），以及 `finalize_cancelling_execution`（兜底收敛任务：CANCELLING 状态超过 timeout + 缓冲后仍未收敛时强制置 CANCELLED 终态，并为缺失结果目标补充 CANCELLED 结果条目）。
- NATS handler：除 `ansible_task_callback` 外，`nats_api.py` 还注册了数据权限类 `get_job_mgmt_module_list`/`get_job_mgmt_module_data`，以及供第三方 App（如补丁管理）经 NATS 调用的开放接口 `job_script_execute`（脚本执行）/`job_file_distribute`（文件分发）/`job_status_batch_query`（批量状态查询）/`job_detail_query`（作业详情）/`job_target_list`（目标列表）；`job_script_execute` 和 `job_file_distribute` 在接收 callback_url 时做 SSRF 校验（`apps.core.utils.ssrf_validator`，宽松模式，阻断云元数据地址）。**`job_task_terminate`（远程取消作业执行）在当前代码中尚未实现，为演进计划项**【待确认】。
- 危险规则缓存：脚本/路径执行前置校验所用的高危命令、高危路径规则集走进程级缓存（`DangerousChecker._get_cmd_rules`/`_get_path_rules`，TTL 由环境变量 `DANGEROUS_RULES_CACHE_TTL` 控制，默认 120s），避免每次执行打 DB；规则增删改时经 `signals.py` 的 `post_save`/`post_delete` 信号主动失效缓存（缓存 key `dangerous_checker:cmd_rules`/`:path_rules`）。
- 依赖 `apps.rpc.{executor,ansible,node_mgmt,sensitive}`。

> 证据来源：`nats_api.py:17`（sensitive 脱敏导入），`nats_api.py:121-235`（CANCELLING 收敛+脱敏落库），`nats_api.py:326-336,415-425`（SSRF 校验），`apps/rpc/sensitive.py`（敏感信息脱敏 101 行），`tasks.py:37-75`（`finalize_cancelling_execution` 兜底收敛任务），`services/dangerous_checker.py:14-68`（危险规则缓存），`signals.py:14-22`（post_save/post_delete 失效缓存），`apps.py:11`（注册 signals）　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 4a. 执行状态机【已实现/已存在】

执行状态枚举共 7 种（较原 6 种新增 `cancelling` 过渡态）：

| 状态值 | 中文 | 分类 |
|--------|------|------|
| `pending` | 等待中 | 中间态 |
| `running` | 执行中 | 中间态 |
| `cancelling` | 取消中 | **过渡态**（非终态）|
| `success` | 成功 | 终态 |
| `failed` | 失败 | 终态 |
| `timeout` | 超时 | 终态 |
| `cancelled` | 已取消 | 终态 |

`TERMINAL_STATES = (success, failed, timeout, cancelled)`；`cancelling` 不属于终态。

**取消行为规则（CAS 分流，消除竞态与"假取消"）**：

1. **PENDING → CANCELLED**：worker 尚未取走任务，CAS 直接置终态，无需过渡。
2. **RUNNING → CANCELLING**：任务已在执行中，CAS 置过渡态，同时尽力 revoke 队列中尚未取走的 Celery 任务；随后调度兜底收敛任务（`finalize_cancelling_execution`，延迟 = execution.timeout + 缓冲秒数）；远端真实结果仍正常回写，最终状态收敛为 CANCELLED。多目标分批执行的 Runner 在每批之间检查 `is_cancelled`（CANCELLING/CANCELLED 均视为已取消），命中后不再向线程池提交后续批次，保证「取消即止」；被取消而未提交的目标在收尾时补发 CANCELLED 结果与 done 哨兵。
3. **终态 / CANCELLING**：重复取消操作返回 400，拒绝处理。
4. **CAS 未命中**（状态在读取后被并发修改）：返回 400，要求刷新后重试。

> 证据来源：`constants/choices.py:68-90`（7 种状态枚举与 TERMINAL_STATES）、`views/execution.py:224-281`（cancel CAS 分流逻辑）、`tasks.py:37-75`（`finalize_cancelling_execution` 兜底收敛任务）、`nats_api.py:120-127,236-242`（CANCELLING 处理与结果收敛）、`services/execution_base_service.py:99`（Runner 检查点 `is_cancelled`）　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 5. 风险 / 待确认
- 危险命令黑名单覆盖度与绕过风险【待确认】。
- JetStream 日志流依赖（默认关闭）【已实现风险】。
- 水平越权防护【已实现/已存在】：`utils/team_authz.py` 提供团队归属授权校验（BL-NEW-002 修复），视图层按 ID 加载 Script/Playbook/Target/DistributionFile 后，用 `is_team_authorized` 校验对象 `team` 是否落在「当前用户授权团队」内，防止 Team A 用户引用 Team B 的对象越权执行；无团队归属的对象对非超管一律拒绝。
- `job_task_terminate` NATS 远程取消接口【待确认】：当前代码中尚未注册此 handler，若作为演进项实现，应遵循与 REST cancel 端点相同的 CAS 分流规则。

## 6. 证据来源
- 接口：`server/apps/job_mgmt/urls.py:20-52`（路由前缀 `api/`、`api/open/*`；`callback_test/` 已从路由中移除）；`views/execution.py:190-219`（stream SSE endpoint）。
- 数据模型：`models/execution.py:22,28,55,70,73`（含 `status` `db_index=True`）、`models/execution.py:86-88`（复合索引 `(scheduled_task, status)` `jobexec_task_status_idx`）、`models/distribution_file.py:6-28`（含新增 `team` 字段:19）、`models/target.py:11,58-64`、`models/playbook.py:10`、`migrations/0009_distributionfile_expire_at.py:36-39`、`migrations/0010_add_status_index_to_jobexecution.py`、`migrations/0011_alter_jobexecution_status.py`（`status` 枚举补 `cancelling`）、`views/open_api.py:87-145,175-207`（team 归属写入与权限校验）。
- 执行机制：`tasks.py:37-75`（`finalize_cancelling_execution`）、`tasks.py:156-178`（清理任务）、`tasks.py:198-250`（`do_callback_task`）、`config.py:4-9`（beat schedule）、`nats_api.py:20,40,78,275,365,460,497,538`（NATS handler）、`nats_api.py:17,121-235`（脱敏导入 + CANCELLING 收敛+脱敏落库）、`nats_api.py:326-336,415-425`（SSRF 校验）、`views/distribution_file.py:64-67` 与 `views/open_api.py:175-179`（文件分发上传 NATS JetStream OS `job-files/`，非 MinIO）。
- 执行状态机与取消重构：`constants/choices.py:68-90`（7 种状态枚举与 TERMINAL_STATES）、`views/execution.py:224-281`（cancel CAS 分流逻辑）、`tasks.py:37-75`（`finalize_cancelling_execution` 兜底收敛任务）、`nats_api.py:120-127`（CANCELLING 处理）、`nats_api.py:236-242`（结果收敛为 CANCELLED）。
- Dashboard 接口：`views/dashboard.py:83-245`（`_resolve_date_range` 工具函数、`trend`/`success_rate_compare`/`stats`/`job_type_distribution`/`execution_status_distribution` 五个 action）、`serializers/dashboard.py:1-30`（`DashboardTrendSerializer` 含 `cancelled_count`/`avg_duration_seconds`，`DashboardStatsSerializer` 含 `avg_duration_seconds`）。
- 危险规则缓存：`services/dangerous_checker.py:14-68`（`_RULES_CACHE_TTL`/缓存 key/`_get_cmd_rules`/`_get_path_rules`）、`signals.py:14-22`（`post_save`/`post_delete` 失效缓存）、`apps.py:11`（注册 signals）。
- 越权防护：`utils/team_authz.py:1-63`。
- 其它：`server/apps/job_mgmt/{services/*}`、`apps/rpc/{executor,ansible,node_mgmt,sensitive}.py`。
