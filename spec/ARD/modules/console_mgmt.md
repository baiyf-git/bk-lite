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

## 3. 接口【已实现/已存在】

### 3.1 函数视图（views.py）
`init_user_set/`、`update_user_base_info/`、`validate_pwd/`、`validate_email_code/`、`send_email_code/`、`reset_pwd/`、`get_user_info/`。

其中 `send_email_code`/`validate_email_code` 采用**服务端有状态验证码**机制【已实现/已存在 `views.py:19-28,227-242,269-279`】：

- **速率限制**：`send_email_code` 在已登录用户场景下，以 `cache.add()`（原子 set-if-not-exists）实现每用户每目标邮箱 60 秒内最多发送 1 次（key=`send_email_code_rate:{username}:{email}`，TTL=`EMAIL_CODE_RATE_LIMIT_SECONDS=60`）【已实现/已存在 `views.py:20,227-241`】。
- **CSPRNG 生成**：使用 `secrets.randbelow(10)` 生成 6 位密码学安全随机数字验证码（替代原 `random.randint`）【已实现/已存在 `views.py:244`】。
- **服务端持码**：邮件发送成功后，验证码以 key=`vc:{username}:{email}` 存入 Django cache，TTL 由环境变量 `EMAIL_CODE_TTL` 控制（默认 600s / 10 分钟）；响应体**不再返回** `data.hashed_code`【已实现/已存在 `views.py:22-23,269-278`】。
- **一次性校验**：`validate_email_code` 入参由原 `hashed_code` 改为 `email`，从 cache 取出存储码后以 `secrets.compare_digest` 比对；校验通过即立即 `cache.delete`（一次性使用）；若 cache 中无记录则返回"已过期/不存在"错误【已实现/已存在 `views.py:171-206`】。

原「无状态」机制（`make_password`/`check_password`/前端持哈希）已完全移除。

`reset_pwd` 视图新增调用方身份校验前置步骤【已实现/已存在 `views.py:361-367`】：从 `request.COOKIES.get("bklite_token")` 读取 token，缺失时直接返回"请提供 Token"错误，不进入 RPC 调用；存在时作为 `caller_token` 透传给 `SystemMgmt.reset_pwd`，由 NATS handler 端校验 token 与 username 会话一致性【已实现/已存在 `views.py:364-367`】。

### 3.2 NotificationViewSet（`notifications`）
按用户隔离已读/删除状态，`http_method_names` 限定为 get/post/delete【`viewsets/notification.py:17`】，`create`/`update`/`partial_update` 被显式覆写禁用返回 405【已实现/已存在 `viewsets/notification.py:55-65`】。自定义 action：
- `mark_as_read`（detail post）：标记单条为当前用户已读【`notification.py:77-91`】。
- `mark_all_as_read`（detail=False post）：批量标记所有未读为已读，全部集合运算留在 DB 侧【已实现/已存在 `notification.py:97-134`】。实现分两步：① `UPDATE`：对当前用户已存在且 `is_read=False` **且 `is_deleted=False`** 的 `NotificationRead` 行直接置为已读（软删除通知不被触碰）；② `bulk_create`：对完全无 `NotificationRead` 行的通知批量插入，分批大小由环境变量 `MARK_ALL_READ_BATCH_SIZE` 控制（默认 2000）。**行为变化**：已被当前用户软删除的通知不再受「一键全部已读」影响【已实现/已存在 `notification.py:108-113`】。
- `mark_batch_as_read`（detail=False post）：按 `ids` 批量标记已读【`notification.py:136-160`】。
- `unread_count`（detail=False get）：返回当前用户未读数，改用 `Exists` 子查询单次 SQL 统计（排除 `is_deleted=True` **或** `is_read=True` 的记录），替代原三次独立查询【已实现/已存在 `notification.py:162-173`】。
- `destroy`（delete）：软删除，仅按用户写 `NotificationRead.is_deleted=True`，非物理删除，不影响其他用户【`notification.py:67-75`】。

### 3.3 UserAppSetViewSet（`user_app_sets`）
`http_method_names` 限定为 get/post【`viewsets/user_app_set.py:16`】，标准的 list/create/retrieve/update/partial_update/destroy 均被显式覆写禁用，返回 405【已实现/已存在 `viewsets/user_app_set.py:18-64`】。对外仅暴露两个自定义 action：
- `current_user_apps`（detail=False get）：取当前用户应用配置【`user_app_set.py:82-120`】。
- `configure_user_apps`（detail=False post）：保存当前用户应用配置【`user_app_set.py:122-142`】。

## 4. 依赖与通信【已实现/已存在】
- `apps.rpc.system_mgmt.SystemMgmt`：本模块函数视图经其调用三个方法——`init_user_default_attributes`（首登初始化用户默认属性/组/角色）、`send_email_to_receiver`（发送邮箱验证码邮件，`views.py:265`）、`reset_pwd`（重置密码，`views.py:367`）【已实现/已存在】；另管理命令 `init_guest_role` 额外调用 `create_guest_role`/`create_default_rule`（见下）。`reset_pwd` RPC 方法签名已新增 `caller_token=""` 形参，调用形式为 `client.run("reset_pwd", ..., caller_token=caller_token)`，由控制台从 `bklite_token` cookie 透传【已实现/已存在 `apps/rpc/system_mgmt.py:152-159`】。
- `apps.rpc.opspilot.OpsPilot`：管理命令 `init_guest_role` 依赖 `SystemMgmt.create_guest_role`/`create_default_rule` 与 `OpsPilot.get_guest_provider`，用 Guest 角色对应的 LLM/OCR/embed/rerank 模型初始化默认规则【已实现/已存在 `management/commands/init_guest_role.py:4-30`】。
- NATS：`nats_api.py:create_notification(app, message)` 创建通知，内容上限 2000 字。app 校验为「白名单 OR App 表存在」二选一【已实现/已存在 `nats_api.py:33`】：app 命中 `BUILTIN_APP_MODULES`（monitor/cmdb/node_mgmt/job_mgmt/alerts/log/opspilot/system_mgmt/console_mgmt/mlops/operation_analysis）直接放行；未命中白名单时，只要 `App` 表存在同名 `name` 记录亦放行，二者皆不满足才拒绝。

## 5. 风险 / 待确认
- 通知的实时推送通道（WebSocket/SSE）是否存在【待确认】——当前仅见 ORM 落库。

## 6. 证据来源
`server/apps/console_mgmt/{urls.py,models/*,views.py,nats_api.py}`、`server/apps/console_mgmt/viewsets/{notification.py,user_app_set.py}`、`server/apps/console_mgmt/management/commands/init_guest_role.py`、`server/apps/rpc/system_mgmt.py`、`server/apps/rpc/opspilot.py`。

本轮增量修订关键行号：
- 验证码机制重写：`server/apps/console_mgmt/views.py:19-28`（常量/辅助函数）、`views.py:171-206`（validate_email_code）、`views.py:227-279`（send_email_code 速率限制 + 持码逻辑）
- reset_pwd 鉴权：`server/apps/console_mgmt/views.py:361-367`、`server/apps/rpc/system_mgmt.py:152-159`
- mark_all_as_read 行为变化：`server/apps/console_mgmt/viewsets/notification.py:108-113`（is_deleted=False 过滤）
- unread_count 重写：`server/apps/console_mgmt/viewsets/notification.py:162-173`
