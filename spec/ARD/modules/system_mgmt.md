# 模块 ARD：System Management（系统管理）

> 路径 `server/apps/system_mgmt` ｜ API 前缀 `api/v1/system_mgmt/`

## 1. 职责【已实现/已存在】
多租户用户/组/角色/权限管理、登录流程（密码/OTP/外部认证）、权限矩阵、审计日志、系统设置与通知渠道。

## 2. 数据模型与存储【已实现/已存在 / PostgreSQL】
| 模型 | 文件 | 说明 |
|------|------|------|
| User | `models/user.py` | 用户（username+domain 唯一）。除基础字段外含 `phone`、`last_login`、`password_last_modified`、`password_error_count`、`account_locked_until`、`otp_secret`；`save()` 重写：改密时自动 `password_last_modified=now`、重置 `password_error_count=0`、清空 `account_locked_until`，并清除该用户权限缓存 |
| Group | `models/user.py` | 层级组（parent_id、allow_inherit_roles、M2M Role） |
| Role | `models/role.py` | 角色（app、menu_list） |
| GroupDataRule / UserRule | `models/group_data_rule.py` | 数据级访问规则 |
| Menu / LoginModule / SystemSettings | `models/*.py` | 菜单、登录提供方、系统配置 |
| SensitiveInfoAuthorization | `models/sensitive_info_authorization.py` | 敏感信息脱敏授权白名单（企业版）：`username`+`domain` 唯一，`sensitive_types`（JSON，限 email/phone）记录被授权可见的敏感字段类型 |
| OperationLog / UserLoginLog / ErrorLog | `models/*.py` | 审计追踪；OperationLog 除基础字段外含 `target_type`（操作目标类型）、`target_id`（操作目标主键）、`detail`（JSONField，操作变更明细）三个结构化字段，支持审计记录精确定位被操作对象并保留变更快照 |

## 3. 接口【已实现/已存在】
DRF Router 注册 12 个路由组：`group`/`user`/`role`/`channel`/`group_data_rule`/`system_settings`/`app`（AppViewSet，应用清单）/`login_module`/`custom_menu_group`/`user_login_log`/`operation_log`/`error_log`。企业版路由在 `enterprise/urls.py` 存在时追加合并。

## 4. 认证与权限【已实现/已存在】
- `nats_api.py`：`login`、`bk_lite_user_login`、`verify_otp_login`、`reset_pwd`、`get_all_groups`、`get_authorized_groups_scoped`、`create_guest_role` 等。
- JWT（含 jti/exp）、OTP（二维码/挑战/限频）、token 黑名单。
- 角色继承：`get_user_all_roles` 沿 `parent_id`+`allow_inherit_roles` 递归汇总；权限缓存 TTL 由 `PERMISSION_CACHE_TTL` 配置（默认 600s），token 信息缓存 TTL 由 `TOKEN_INFO_CACHE_TTL` 配置（默认 60s）。
- 密码策略：`utils/password_validator.py`（失败锁定）；`utils/pwd_policy_cache.py` 将 login 路径原本分散的多次单键 `SystemSettings` 查询合并为一次批量读取并以短 TTL（300s）缓存，管理员经 `update_sys_set` 更新 `pwd_set_*` 配置时调用 `invalidate_pwd_policy_cache()` 主动失效，确保新策略立即生效。
- **OTP 验证限频**【已实现/已存在】：`verify_otp_code` 在查库前先按「客户端IP + 用户名」维度查询缓存计数器（`otp_challenge.check_rate_limit`）；5 分钟窗口内连续失败超过 5 次（`RATE_LIMIT_MAX_ATTEMPTS=5`，`RATE_LIMIT_TTL=300s`）时直接拒绝，验证成功后重置计数。限频状态以 Redis Cache（`RATE_LIMIT_PREFIX`）存储，无持久化。
- **密码重置调用方校验**【已实现/已存在】：`reset_pwd` NATS 接口要求调用方携带 `caller_token`；接口先通过 `_verify_token` 验证 token 有效性，再校验 token 所属用户（username + domain 双字段）与目标用户一致，任一校验失败均返回 Unauthorized，阻止内网服务越权修改他人密码。

## 5. 通知渠道【已实现/已存在】
`models/channel.py` 的 `ChannelChoices` 定义 7 类渠道：`email`（邮件）、`enterprise_wechat`（企微）、`enterprise_wechat_bot`（企微机器人）、`nats`（NATS 消息）、`feishu_bot`（飞书机器人）、`dingtalk_bot`（钉钉机器人）、`custom_webhook`（自定义 Webhook）。发送实现见 `utils/channel_utils.py`；BK 用户对接 `utils/bk_user_utils.py`。

### 5.1 OpsPilot 托管 NATS 通道查询【已实现/已存在】
`search_opspilot_nats_channels`（NATS 注册函数）专门列举由 OpsPilot 托管的 NATS 类型通道（`channel.config.source == "opspilot"`），区别于通用的 `search_channel_list`。

- **查询维度**：支持按 `teams`（组织 ID 列表）或 `bot_id` 过滤，两者均为可选；`teams` 为空时跨全局列举。
- **子组织展开**：当 `include_children=True` 时，递归遍历组织父子关系，将指定团队的所有下级组织纳入过滤范围。
- **返回结构**：每条记录包含 `id`、`name`、`description`、`team`、`bot_id`、`node_id`，`bot_id`/`node_id` 来自 `channel.config`，供 OpsPilot 路由使用。
- **过滤机制**：数据库层仅按 `channel_type=NATS` 过滤，`source`/`bot_id` 匹配在 Python 侧完成（无额外 DB 索引）。

> 证据来源：`server/apps/system_mgmt/nats_api.py:948-1014`　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 6. 核心数据流 / 任务【已实现/已存在】
`tasks.py` 定义 3 个 Celery 任务：
- `write_error_log_async`：异步写入错误日志到 `ErrorLog`（`bind=True, max_retries=3, default_retry_delay=60`，失败按重试机制重试，超限返回失败）。
- `sync_user_and_group_by_login_module`：按 `LoginModule`（须 enabled）经 `RpcClient` 调用对应 namespace 的 `sync_data`，将外部用户/组同步入库（递归建组、external_id 映射、批量增改删）。
- `check_password_expiry_and_notify`：定时检查密码即将/已过期用户，读取 `pwd_set_validity_period`/`pwd_set_expiry_reminder_days` 系统设置，经 email 渠道发送提醒邮件（validity_days<=0 视为永不过期则跳过）。

## 7. 风险 / 待确认
- domain 多租户隔离在所有 ViewSet 是否强制【待确认】。
- 外部登录模块（LDAP/WeChat/BK）配置与回退【推断，需确认覆盖范围】。

## 8. 证据来源
- 路由：`server/apps/system_mgmt/urls.py:19-35`（含 `app` 路由 `urls.py:25`、企业版合并 `urls.py:33-37`）。
- 模型：`server/apps/system_mgmt/models/user.py:7-62`（User 字段与 `save()` 重写）、`models/sensitive_info_authorization.py:33-42`、`models/channel.py:7-14`（ChannelChoices 7 类）、`models/role.py`、`models/group_data_rule.py`。
- OperationLog 结构化字段：`server/apps/system_mgmt/models/operation_log.py:39-41`（`target_type`、`target_id`、`detail` JSONField）；写入侧 NATS 接口 `server/apps/system_mgmt/nats_api.py:1960-2002`（`save_operation_log`，新增 `target_type`/`target_id`/`detail` 形参，默认值向后兼容旧调用方）。
- 认证/权限：`server/apps/system_mgmt/nats_api.py:1264`（`login`）、`nats_api.py:1706`（`bk_lite_user_login`）、`nats_api.py:1598`（`verify_otp_login`）、`nats_api.py:1367-1386`（`reset_pwd` 调用方身份校验）；缓存 TTL `server/apps/core/utils/permission_cache.py:27,30`。
- OTP 限频：`server/apps/system_mgmt/nats_api.py:1548-1573`（`verify_otp_code`）、`server/apps/system_mgmt/otp_challenge.py:83-135`（`check_rate_limit`/`record_failed_attempt`/`reset_rate_limit`，阈值 5 次/300s）。
- OpsPilot NATS 通道查询：`server/apps/system_mgmt/nats_api.py:948-1014`（`search_opspilot_nats_channels`）。
- Celery 任务：`server/apps/system_mgmt/tasks.py:14`（write_error_log_async）、`tasks.py:42`（sync_user_and_group_by_login_module）、`tasks.py:251`（check_password_expiry_and_notify）。
- 其他：`server/apps/system_mgmt/{services/role_manage.py,utils/*}`。

> 证据来源：见各节内联标注　|　同步基线：0fbb99c2　|　【已实现/已存在】
