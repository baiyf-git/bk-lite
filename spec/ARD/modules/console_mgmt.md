# 模块 ARD：Console Management（控制台）

> 路径 `server/apps/console_mgmt` ｜ API 前缀 `api/v1/console_mgmt/`

## 1. 职责【已实现/已存在】
用户首登初始化、站内通知、用户应用偏好；作为控制台 UI 的网关，对接 system_mgmt 获取角色/组/权限。

## 2. 数据模型与存储【已实现/已存在 / PostgreSQL】
| 模型 | 文件 | 说明 |
|------|------|------|
| Notification | `models/notification.py` | 站内消息（时间/模块/内容/来源）；另保留 `is_read` 字段，verbose_name 标注「已废弃，保留兼容」并带 `db_index`，已读状态实际不再依赖此字段【已实现/已存在 `models/notification.py:12`】 |
| NotificationRead | `models/notification.py` | 每用户独立的通知状态（`unique_together` notification+user）；字段含 `is_read`、`read_at`（已读时间）、`is_deleted`（按用户软删除），同时承载按用户隔离的已读与删除状态，而非单纯已读标记【已实现/已存在 `models/notification.py:32-46`】 |
| UserAppSet | `models/user_app_set.py` | 用户应用看板配置（app_config_list JSON） |

**临时状态存储（Django cache，非持久化）**：邮箱验证码与发送速率限制均存于 Django cache，key 前缀分别为 `vc:`（验证码，TTL 受环境变量 `EMAIL_CODE_TTL` 控制）与 `send_email_code_rate:`（速率令牌，TTL 60s）；cache 内容随 TTL 自动失效，不写入数据库。

> 证据来源：`server/apps/console_mgmt/views.py:26-28`（`_email_code_cache_key`）、`views.py:20,23,232,272`　|　同步基线：0fbb99c2　|　【已实现】

## 3. 接口【已实现/已存在】

### 3.1 函数视图（views.py）
`init_user_set/`、`update_user_base_info/`、`validate_pwd/`、`validate_email_code/`、`send_email_code/`、`reset_pwd/`、`get_user_info/`。

其中 `send_email_code`/`validate_email_code` 采用**服务端有状态验证码**机制（已由旧"无状态前端哈希"方案整体替换）【已实现/已存在 `views.py:222-294,184-219`】：

**send_email_code**：使用密码学安全 PRNG（`secrets.randbelow`）生成 6 位数字验证码，经 `SystemMgmt.send_email_to_receiver` RPC 发往目标邮箱；验证码以 `vc:{username}:{email}` 为键存入服务端 Django Cache，TTL 由环境变量 `EMAIL_CODE_TTL` 控制（默认 600 秒/10 分钟）。响应体**不再包含** `data.hashed_code`，前端无法获知验证码值。

接口响应契约（send_email_code）：
```json
{"result": true, "message": "..."}
```
（旧契约中含 `"data": {"hashed_code": "..."}` 字段，已移除【已实现/已存在 `views.py:287-292`】）

**validate_email_code**：请求参数由旧版 `hashed_code` 改为 `email`【已实现/已存在 `views.py:184-219`】。服务端以 `vc:{username}:{email}` 从 Cache 取出已存储验证码，用常数时间比对（`secrets.compare_digest`）防时序攻击；验证通过后立即从 Cache 删除（**一次性使用**），验证码过期或未发送则返回 `error.verification_code_expired`。

接口请求契约（validate_email_code）：
```json
{"email": "target@example.com", "input_code": "123456"}
```
（旧契约中使用 `hashed_code` 字段，已移除【已实现/已存在 `views.py:192-202`】）

**速率限制**：同一已登录用户对同一目标邮箱，60 秒内最多发送 1 次验证码请求（`EMAIL_CODE_RATE_LIMIT_SECONDS=60`）。实现采用 `cache.add()` 原子操作（set-if-not-exists）避免 TOCTOU 竞态；匿名用户（未取到 `username`）不受此限制约束【已实现/已存在 `views.py:240-254`】。超限时返回：
```json
{"result": false, "message": "Please wait before requesting another verification code"}
```
速率限制 key 前缀 `send_email_code_rate:`，TTL 60s。

> 证据来源：`server/apps/console_mgmt/views.py:184-294`（`send_email_code`、`_email_code_cache_key`、`EMAIL_CODE_RATE_LIMIT_SECONDS`、`_EMAIL_CODE_TTL`）、`views.py:171-206`（`validate_email_code`）　|　同步基线：0fbb99c2　|　【已实现】

另见功能清单约束：[[../../fuctionlist/08-控制台-功能清单#§6 身份校验与安全操作]]。

**reset_pwd 鉴权约束**：`reset_pwd` 视图在执行密码重置前，必须从请求 Cookie 中读取 `bklite_token`；若 Cookie 缺失则直接返回失败响应（`{"result": false, "message": "Please provide Token"}`，HTTP 200），不调用后端 RPC【已实现/已存在 `views.py:374-377`】。令牌通过 `caller_token` 参数随 RPC 调用转发给 `SystemMgmt.reset_pwd`【已实现/已存在 `views.py:380`】，由后端 NATS handler 完成调用方身份校验。

> 证据来源：`server/apps/console_mgmt/views.py:360-388`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.2 NotificationViewSet（`notifications`）
按用户隔离已读/删除状态，`http_method_names` 限定为 get/post/delete【`viewsets/notification.py:17`】，`create`/`update`/`partial_update` 被显式覆写禁用返回 405【已实现/已存在 `viewsets/notification.py:55-65`】。自定义 action：
- `mark_as_read`（detail post）：标记单条为当前用户已读【`notification.py:77-91`】。
- `mark_all_as_read`（detail=False post）：批量标记所有未读为已读【`notification.py:93-120`】。
- `mark_batch_as_read`（detail=False post）：按 `ids` 批量标记已读【`notification.py:122-146`】。
- `unread_count`（detail=False get）：返回当前用户未读数（排除已删除/已读）【`notification.py:148-164`】。
- `destroy`（delete）：软删除，仅按用户写 `NotificationRead.is_deleted=True`，非物理删除，不影响其他用户【`notification.py:67-75`】。

### 3.3 UserAppSetViewSet（`user_app_sets`）
`http_method_names` 限定为 get/post【`viewsets/user_app_set.py:16`】，标准的 list/create/retrieve/update/partial_update/destroy 均被显式覆写禁用，返回 405【已实现/已存在 `viewsets/user_app_set.py:18-64`】。对外仅暴露两个自定义 action：
- `current_user_apps`（detail=False get）：取当前用户应用配置【`user_app_set.py:82-120`】。
- `configure_user_apps`（detail=False post）：保存当前用户应用配置【`user_app_set.py:122-142`】。

## 4. 依赖与通信【已实现/已存在】
- `apps.rpc.system_mgmt.SystemMgmt`：本模块函数视图经其调用三个方法——`init_user_default_attributes`（首登初始化用户默认属性/组/角色）【已实现/已存在 `views.py:119`】、`send_email_to_receiver`（发送邮箱验证码邮件）【已实现/已存在 `views.py:278`】、`reset_pwd`（重置密码，附带 `caller_token` 参数由 NATS handler 校验调用方身份）【已实现/已存在 `views.py:380`】；另管理命令 `init_guest_role` 额外调用 `create_guest_role`/`create_default_rule`（见下）。
- `apps.rpc.opspilot.OpsPilot`：管理命令 `init_guest_role` 依赖 `SystemMgmt.create_guest_role`/`create_default_rule` 与 `OpsPilot.get_guest_provider`，用 Guest 角色对应的 LLM/OCR/embed/rerank 模型初始化默认规则【已实现/已存在 `management/commands/init_guest_role.py:4-30`】。
- NATS：`nats_api.py:create_notification(app, message)` 创建通知，内容上限 2000 字。app 校验为「白名单 OR App 表存在」二选一【已实现/已存在 `nats_api.py:33`】：app 命中 `BUILTIN_APP_MODULES`（monitor/cmdb/node_mgmt/job_mgmt/alerts/log/opspilot/system_mgmt/console_mgmt/mlops/operation_analysis）直接放行；未命中白名单时，只要 `App` 表存在同名 `name` 记录亦放行，二者皆不满足才拒绝。

## 5. 风险 / 待确认
- 通知的实时推送通道（WebSocket/SSE）是否存在【待确认】——当前仅见 ORM 落库。

## 6. 证据来源
`server/apps/console_mgmt/{urls.py,models/*,views.py,nats_api.py}`、`server/apps/console_mgmt/viewsets/{notification.py,user_app_set.py}`、`server/apps/console_mgmt/management/commands/init_guest_role.py`、`apps/rpc/system_mgmt.py`、`apps/rpc/opspilot.py`。
