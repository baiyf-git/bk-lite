# 模块 ARD：Job Management（作业平台）

> 路径 `server/apps/job_mgmt` ｜ API 前缀 `api/v1/job_mgmt/`

## 1. 职责【已实现/已存在】
在目标主机上执行脚本、playbook 与文件分发；通过两类驱动路由执行：**nats-executor**（sidecar 节点）与 **ansible-executor**（手动/外部目标），完成回调经 NATS。

## 2. 数据模型与存储【已实现/已存在】
| 模型 | 文件 | 说明 |
|------|------|------|
| JobExecution | `models/execution.py` | 作业记录（类型/状态/目标/结果/celery_task_id/team）；另含对外/审计字段：`callback_url`（第三方回调地址）、`trigger_source`（manual/api/scheduled）、`playbook_version`（执行时版本快照）、`executor_user`（执行用户快照）、`overwrite_strategy` 等。**`status` 字段加 `db_index`；新增复合索引 `jobexec_task_status_idx(scheduled_task, status)`**（migration 0010）【已实现/已存在】`models/execution.py:22,86-88`。**执行状态枚举新增 `cancelling`（取消中）非终态过渡态**（migration 0011）【已实现/已存在】`constants/choices.py:76,85,90`；状态集合见下表。 |
| Script | `models/script.py` | 脚本模板（SHELL/PYTHON/POWERSHELL/BATCH，Jinja2） |
| Playbook | `models/playbook.py` | Ansible playbook ZIP（存 MinIO `job-mgmt-private`） |
| Target | `models/target.py` | 手动目标（driver=ANSIBLE/NATS_EXECUTOR，SSH/WinRM 凭据）；SSH 密钥文件经 `ssh_key_file` 存于 MinIO 桶 `job-mgmt-private`（与 Playbook 同桶），即该桶承载 Playbook ZIP 与 SSH 密钥两类文件 |
| DistributionFile | `models/distribution_file.py` | 临时分发文件（file_key + 过期清理）；文件实际上传到 NATS JetStream Object Store（前缀 `job-files/`，经 node_mgmt `upload_file_to_s3`），而非 MinIO；`is_permanent` 字段已在 migration 0009 删除，现已无「永久保存」选项，仅 `expire_at` 过期清理 |
| ScheduledTask | `models/scheduled_task.py` | 定时任务（并发策略） |
| DangerousRule / DangerousPath | `models/*.py` | 危险命令/路径黑名单 |

**JobExecution 执行状态枚举（含新增过渡态）**【已实现/已存在】`constants/choices.py:71-90`：

| 状态值 | 显示名 | 类型 |
|--------|--------|------|
| `pending` | 待执行 | 中间态 |
| `running` | 执行中 | 中间态 |
| `cancelling` | 取消中 | 非终态过渡态（已请求取消，等真实结果回写收敛） |
| `success` | 成功 | 终态 |
| `failed` | 失败 | 终态 |
| `timeout` | 超时 | 终态 |
| `cancelled` | 已取消 | 终态 |

终态集合 `TERMINAL_STATES = (success, failed, timeout, cancelled)`；`cancelling` 不在终态集内，Runner 检查点与 base service 均将其视为「已取消」而停止后续目标/批次。

## 3. 接口【已实现/已存在】
DRF 路由前缀均带 `api/` 段；结合 app 注册前缀 `api/v1/job_mgmt/`，对外完整路径为 `api/v1/job_mgmt/api/<resource>/`：`api/target`、`api/script`、`api/playbook`、`api/execution`、`api/scheduled_task`、`api/dashboard`、`api/distribution_file`、`api/dangerous_rule`、`api/dangerous_path`。开放端点 `api/open/upload_file`、`api/open/delete_file`（同样带 `api/` 前缀）。另有回调测试端点 `callback_test/`（`path('callback_test/', api_views.callback_test)`，不带 `api/` 前缀）。

**Dashboard 端点明细**【已实现/已存在】`views/dashboard.py`：

| 端点（相对 `api/v1/job_mgmt/api/dashboard/`） | 方法 | 说明 |
|---|---|---|
| `trend/` | GET | 执行趋势，支持 `days`（上限 30）或 `start_date`/`end_date` 自定义闭区间（最长 90 天）；返回字段含 `cancelled_count`、`avg_duration_seconds` |
| `success_rate_compare/` | GET | 当前周期成功率及上一等长周期环比；支持同上日期参数；返回 `avg_duration_seconds` |
| `stats/` | GET | 资产与执行计数汇总（目标/脚本/Playbook/执行/定时任务各维度计数）；含全局 `avg_duration_seconds` |
| `job_type_distribution/` | GET | 作业类型分布（按 job_type 分组计数） |
| `execution_status_distribution/` | GET | 执行状态分布（支持 `days` 或自定义区间，同 trend） |

`_resolve_date_range()` 辅助函数统一解析日期参数：自定义区间校验格式、顺序、跨度（≤90 天）及全未来日期，非法时返回 400【已实现/已存在】`views/dashboard.py:22-69`。

## 4. 执行机制【已实现/已存在】
- 脚本：危险命令校验 → Ansible（Windows 手动目标）或 nats-executor（sidecar）；日志发布到 JetStream。
- playbook：上传 ZIP 到 MinIO → 提交 `apps.rpc.ansible.AnsibleExecutor` → 异步回调。
- 文件分发：上传 NATS JetStream Object Store（前缀 `job-files/`，经 `node_mgmt.upload_file_to_s3`，非 MinIO）→ nats-executor 或 Ansible 推送。
- 回调：`nats_api.py:ansible_task_callback` 接收结果、更新 JobExecution、清理临时文件、推送 SSE 结束哨兵。
- Celery 任务清单：

| 任务名 | 说明 |
|--------|------|
| `execute_script_task` | 脚本执行主任务 |
| `execute_playbook_task` | Playbook 执行主任务 |
| `distribute_files_task` | 文件分发主任务 |
| `execute_scheduled_task` | 定时任务触发入口 |
| `cleanup_expired_distribution_files_task` | 每天 00:00 由 celery-beat 清理过期分发文件（schedule 见 `config.py`） |
| `do_callback_task` | 带 HMAC 签名 + SSRF 二次校验、指数退避重试最多 5 次的第三方回调任务 |
| `finalize_cancelling_execution` | **取消兜底收敛任务**（新增）：`CANCELLING` 状态滞留超过 `execution.timeout + 60s` 缓冲后，CAS 强制将其收敛为 `CANCELLED` 终态；对缺失结果的目标补「远端结果未知」`CANCELLED` 条目并发 done 哨兵；CAS 未命中（真实结果已先行回写收敛）则静默 no-op 【已实现/已存在】`tasks.py:37-76` |

- NATS handler：除 `ansible_task_callback` 外，`nats_api.py` 还注册了数据权限类 `get_job_mgmt_module_list`/`get_job_mgmt_module_data`，以及供第三方 App（如补丁管理）经 NATS 调用的开放接口 `job_script_execute`（脚本执行）/`job_file_distribute`（文件分发）/`job_status_batch_query`（批量状态查询）/`job_detail_query`（作业详情）/`job_target_list`（目标列表）。
- 依赖 `apps.rpc.{executor,ansible,node_mgmt}`。

### 4.1 取消语义与状态机【已实现/已存在】

取消接口（`POST api/v1/job_mgmt/api/execution/{id}/cancel/`）按当前状态做 CAS 分流，消除竞态与「假取消」【已实现/已存在】`views/execution.py:222-281`：

```
PENDING  ──CAS──► CANCELLED（直接终态；finished_at 同步写入）
RUNNING  ──CAS──► CANCELLING（非终态过渡态）──► CANCELLED
                         │                          ▲
                         └─ 调度兜底收敛任务 ─────────┘
                            （timeout + 60s 后触发）
终态 / CANCELLING ────────► 拒绝 400
CAS 未命中（并发改变）──────► 拒绝 400（提示刷新重试）
```

- **PENDING → CANCELLED**：Worker 尚未取走，`filter(id=pk, status=PENDING).update(status=CANCELLED, finished_at=now)` 原子写入终态，返回 `{"status": "cancelled"}`。
- **RUNNING → CANCELLING**：`filter(id=pk, status=RUNNING).update(status=CANCELLING)` 原子进入过渡态；同步调度 `finalize_cancelling_execution.apply_async(countdown=execution.timeout + 60)` 兜底；返回 `{"status": "cancelling"}`。
- **真实结果回写（`ansible_task_callback`）**：检测到 `was_cancelling=True`，落完结果后将状态收敛为 `CANCELLED` 而非 `SUCCESS/FAILED`【已实现/已存在】`nats_api.py:121-122,232-238`。
- **Runner 检查点（`execution_base_service.is_cancelled`）**：读库后若状态为 `CANCELLING` 或 `CANCELLED` 均返回 True，使 Runner 立即停止后续目标/批次【已实现/已存在】`services/execution_base_service.py:98-106`。
- **base service 结果聚合**：`CANCELLING` 与 `CANCELLED` 均触发保留已完成真实结果并收敛为 `CANCELLED` 终态的分支【已实现/已存在】`services/execution_base_service.py:131-138`。
- **L0 revoke**：无论 PENDING/RUNNING，均尝试 `revoke` Celery 队列中尚未被 Worker 取走的任务，失败不阻断取消流程【已实现/已存在】`views/execution.py:250-257`。

### 4.2 高危规则检查——进程缓存与信号失效【已实现/已存在】

危险命令/路径规则查询改为进程级缓存读取，避免每次执行都打 DB【已实现/已存在】`services/dangerous_checker.py:13-50`：

- 缓存键：`dangerous_checker:cmd_rules`（命令规则）、`dangerous_checker:path_rules`（路径规则）。
- TTL：由环境变量 `DANGEROUS_RULES_CACHE_TTL` 控制，默认 120 秒；进程启动时读取，修改后需重启生效。
- 主动失效：新增 `signals.py`，监听 `DangerousRule` / `DangerousPath` 的 `post_save`/`post_delete` 信号，变更时立即 `cache.delete` 对应缓存键【已实现/已存在】`signals.py:1-23`。
- `apps.py:ready()` 新增 `import apps.job_mgmt.signals`，确保信号在 Django 启动时注册【已实现/已存在】`apps.py:11`。
- `DangerousChecker.add_match()` 兼容 ORM 对象与缓存 dict 两种入参格式【已实现/已存在】`services/dangerous_checker.py:70-96`。

## 5. 风险 / 待确认
- 危险命令黑名单覆盖度与绕过风险【待确认】。
- JetStream 日志流依赖（默认关闭）【已实现风险】。
- 水平越权防护【已实现/已存在】：`utils/team_authz.py` 提供团队归属授权校验（BL-NEW-002 修复），视图层按 ID 加载 Script/Playbook/Target/DistributionFile 后，用 `is_team_authorized` 校验对象 `team` 是否落在「当前用户授权团队」内，防止 Team A 用户引用 Team B 的对象越权执行；无团队归属的对象对非超管一律拒绝。

## 6. 证据来源
- 接口：`server/apps/job_mgmt/urls.py:20-53`（路由前缀 `api/`、`api/open/*`、`callback_test/`）。
- 数据模型：`models/execution.py:22,28,55,70,73`、`models/distribution_file.py:6-28`、`models/target.py:11,58-64`、`models/playbook.py:10`、`migrations/0009_distributionfile_expire_at.py:36-39`、`views/open_api.py:175-179`。
- JobExecution 索引与新状态：`models/execution.py:22,86-88`（`db_index` + 复合索引 `jobexec_task_status_idx`）、`migrations/0010_add_status_index_to_jobexecution.py:24-37`、`migrations/0011_alter_jobexecution_status.py:14-30`、`constants/choices.py:71-90`（`cancelling` 枚举、CHOICES 及 `TERMINAL_STATES`）。
- 取消状态机：`views/execution.py:225-281`（CAS 分流逻辑）、`tasks.py:37-76`（`finalize_cancelling_execution`）、`services/execution_base_service.py:59-61,98-106,131-138`（Runner 检查点 `is_cancelled` 与结果聚合 `finalize_execution`）、`nats_api.py:121-122,232-238`（回调收敛 `CANCELLING→CANCELLED`）。
- Dashboard 新端点：`views/dashboard.py:22-69`（`_resolve_date_range`）、`views/dashboard.py:82-125`（`trend` 含 `cancelled_count`/`avg_duration_seconds`）、`views/dashboard.py:127-165`（`success_rate_compare` 支持自定义区间）、`views/dashboard.py:175-206`（`stats`）、`views/dashboard.py:208-242`（`job_type_distribution`/`execution_status_distribution`）、`serializers/dashboard.py:13-30`（`DashboardStatsSerializer`）。
- 高危规则缓存：`services/dangerous_checker.py:13-50`（缓存键/TTL/`_get_cmd_rules`/`_get_path_rules`）、`services/dangerous_checker.py:70-96`（`add_match` 兼容 dict）、`signals.py:1-23`（`post_save`/`post_delete` 信号失效）、`apps.py:11`（`ready()` 导入 signals）。
- 执行机制：`tasks.py:156-178`（清理任务）、`tasks.py:198-250`（`do_callback_task`）、`config.py:4-9`（beat schedule）、`nats_api.py:20,40,78,275,365,460,497,538`（NATS handler）、`views/distribution_file.py:64-67` 与 `views/open_api.py:175-179`（文件分发上传 NATS JetStream OS `job-files/`，非 MinIO）。
- 越权防护：`utils/team_authz.py:1-63`。
- 其它：`server/apps/job_mgmt/{services/*}`、`apps/rpc/{executor,ansible,node_mgmt}.py`。
