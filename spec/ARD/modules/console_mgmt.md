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

> 证据来源：`server/apps/console_mgmt/views.py:26-28`（`_email_code_cache_key`）、`views.py:20,23,232,272`　|　同步基线：0fbb99c25　|　【已实现】

## 3. 接口【已实现/已存在】

### 3.1 函数视图（views.py）
`init_user_set/`、`update_user_base_info/`、`validate_pwd/`、`validate_email_code/`、`send_email_code/`、`reset_pwd/`、`get_user_info/`。

其中 `send_email_code`/`validate_email_code` 采用**服务端 cache 持有验证码**机制（已由旧"无状态前端哈希"方案整体替换）：

- **`send_email_code`**：用密码学安全 PRNG 生成 6 位数字验证码，经 `SystemMgmt.send_email_to_receiver` RPC 发往目标邮箱；验证码以 cache key `vc:{username}:{email}` 存入**服务端 cache**，TTL 由环境变量 `EMAIL_CODE_TTL` 控制（默认 600s/10 分钟）；**响应不返回任何哈希或验证码明文**。另有**速率限制**：每 (username, email) 60 秒内最多发送 1 次，使用 `cache.add()` 原子写（set-if-not-exists）避免 TOCTOU 竞争，超限返回 `error.email_code_rate_limit`（速率限制 key 前缀 `send_email_code_rate:`，TTL 60s）。
- **`validate_email_code`**：从服务端 cache 取已存储的码，用 `secrets.compare_digest` 常量时间比对前端提交的 `input_code`；校验通过即 `cache.delete` 令其**一次性失效**；cache 中无码（已过期或从未发送）时返回 `error.verification_code_expired`。验证码不再依赖前端回传任何哈希值。

> 证据来源：`server/apps/console_mgmt/views.py:20,23,26-28,209-281`（`send_email_code`、`_email_code_cache_key`、`EMAIL_CODE_RATE_LIMIT_SECONDS`、`_EMAIL_CODE_TTL`）、`views.py:171-206`（`validate_email_code`）　|　同步基线：0fbb99c25　|　【已实现】

另见功能清单约束：[[../../fuctionlist/08-控制台-功能清单#§6 身份校验与安全操作]]。

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
- `apps.rpc.system_mgmt.SystemMgmt`：本模块函数视图经其调用三个方法【已实现/已存在 `views.py:101,226,322`】——`init_user_default_attributes`（首登初始化用户默认属性/组/角色）、`send_email_to_receiver`（发送邮箱验证码邮件）、`reset_pwd`（重置密码）；另管理命令 `init_guest_role` 额外调用 `create_guest_role`/`create_default_rule`（见下）。`reset_pwd` 调用时额外从 cookie `bklite_token` 提取调用方令牌，并以 `caller_token` 参数转发至 NATS handler 做调用方身份校验【已实现/已存在 `views.py:362-367`】。
- `apps.rpc.opspilot.OpsPilot`：管理命令 `init_guest_role` 依赖 `SystemMgmt.create_guest_role`/`create_default_rule` 与 `OpsPilot.get_guest_provider`，用 Guest 角色对应的 LLM/OCR/embed/rerank 模型初始化默认规则【已实现/已存在 `management/commands/init_guest_role.py:4-30`】。
- NATS：`nats_api.py:create_notification(app, message)` 创建通知，内容上限 2000 字。app 校验为「白名单 OR App 表存在」二选一【已实现/已存在 `nats_api.py:33`】：app 命中 `BUILTIN_APP_MODULES`（monitor/cmdb/node_mgmt/job_mgmt/alerts/log/opspilot/system_mgmt/console_mgmt/mlops/operation_analysis）直接放行；未命中白名单时，只要 `App` 表存在同名 `name` 记录亦放行，二者皆不满足才拒绝。

## 5. 风险 / 待确认
- 通知的实时推送通道（WebSocket/SSE）是否存在【待确认】——当前仅见 ORM 落库。

## 6. 证据来源
`server/apps/console_mgmt/{urls.py,models/*,views.py,nats_api.py}`、`server/apps/console_mgmt/viewsets/{notification.py,user_app_set.py}`、`server/apps/console_mgmt/management/commands/init_guest_role.py`、`apps/rpc/system_mgmt.py`、`apps/rpc/opspilot.py`。
