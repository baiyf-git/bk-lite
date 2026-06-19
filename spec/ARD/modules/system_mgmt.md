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
| OperationLog | `models/operation_log.py` | 审计追踪（操作日志）。字段：`username`、`source_ip`、`app`、`action_type`（db_index）、`summary`、`domain`（db_index）；新增 `target_type`（CharField 50，db_index）、`target_id`（CharField 100，db_index）、`detail`（JSONField，default=dict）用于结构化记录操作目标与详情【已实现/已存在】 |
| UserLoginLog / ErrorLog | `models/*.py` | 登录日志与错误日志审计追踪 |

## 3. 接口【已实现/已存在】
DRF Router 注册 12 个路由组：`group`/`user`/`role`/`channel`/`group_data_rule`/`system_settings`/`app`（AppViewSet，应用清单）/`login_module`/`custom_menu_group`/`user_login_log`/`operation_log`/`error_log`。企业版路由在 `enterprise/urls.py` 存在时追加合并。

### NATS 接口（新增）
- `search_opspilot_nats_channels(teams, bot_id, include_children)`【已实现/已存在】：按 `config.source == "opspilot"` 在 Python 侧过滤 `ChannelChoices.NATS` 类型通道，返回含路由字段 `bot_id`/`node_id` 的列表；`teams` 为空则全局列举，`include_children=True` 时递归展开子组织。

## 4. 认证与权限【已实现/已存在】
- `nats_api.py`：`login`、`bk_lite_user_login`、`verify_otp_login`、`reset_pwd`、`get_all_groups`、`get_authorized_groups_scoped`、`create_guest_role` 等。
- JWT（含 jti/exp）、OTP（二维码/挑战/限频）、token 黑名单。
- 角色继承：`get_user_all_roles` 沿 `parent_id`+`allow_inherit_roles` 递归汇总；权限缓存 TTL 由 `PERMISSION_CACHE_TTL` 配置（默认 600s），token 信息缓存 TTL 由 `TOKEN_INFO_CACHE_TTL` 配置（默认 60s）。
- 密码策略：`utils/password_validator.py`（失败锁定）；`utils/pwd_policy_cache.py` 提供批量缓存层（TTL 300s，key `system_settings:pwd_policy`），将 login 路径中原本分散的多次单键 `SystemSettings` 查询合并为一次批量查询；`SystemSettingsViewSet.update_sys_set` 更新任一 `pwd_set_*` 配置时调用 `invalidate_pwd_policy_cache()` 主动清除缓存，确保新策略在下次登录时即时生效【已实现/已存在】。
- `reset_pwd` 安全语义变更【已实现/已存在】：签名新增 `caller_token` 参数（Python 签名为 `caller_token=""`，默认空串，但接口逻辑将其视为必填——为空直接返回 `{"result": False, "message": "caller_token is required"}`）；接口强制校验调用方身份——`caller_token` 必须为有效 JWT，且 token 所属用户的 `username`+`domain` 须与目标用户一致（仅允许本人自助改密）；token 无效或不匹配时返回 `{"result": False, "message": "Unauthorized: ..."}` 阻止越权。
- `verify_otp_code` 限频增强【已实现/已存在】：新增 `client_ip` 参数；验证前先调用 `check_rate_limit(client_ip, username)` 按 IP+用户名联合限频；验证成功调用 `reset_rate_limit`，失败调用 `record_failed_attempt`；用户不存在或未配置 OTP 返回明确错误，不再抛出异常。
- `verify_token` 组树范围收窄与性能修复【已实现/已存在】（Issue #3458）：缓存未命中路径不再对非超管执行全表 `Group` 扫描——新增 `_collect_ancestor_group_ids` 沿 `parent_id` 链向上收集用户直属组及其祖先 ID，`build_group_tree` 仅以该范围内的组构建嵌套结构；可观察影响是非超管返回的 `groups`/组树仅含其直属分支路径（直属组 + 祖先），不再返回全量组树；超管仍返回完整组树。`get_user_all_roles` 同步改为仅按祖先范围 `prefetch_related("roles")` 加载（消除全表 prefetch）。

## 5. 通知渠道【已实现/已存在】
`models/channel.py` 的 `ChannelChoices` 定义 7 类渠道：`email`（邮件）、`enterprise_wechat`（企微）、`enterprise_wechat_bot`（企微机器人）、`nats`（NATS 消息）、`feishu_bot`（飞书机器人）、`dingtalk_bot`（钉钉机器人）、`custom_webhook`（自定义 Webhook）。发送实现见 `utils/channel_utils.py`；BK 用户对接 `utils/bk_user_utils.py`。

## 6. 核心数据流 / 任务【已实现/已存在】
`tasks.py` 定义 3 个 Celery 任务：
- `write_error_log_async`：异步写入错误日志到 `ErrorLog`（`bind=True, max_retries=3, default_retry_delay=60`，失败按重试机制重试，超限返回失败）。
- `sync_user_and_group_by_login_module`：按 `LoginModule`（须 enabled）经 `RpcClient` 调用对应 namespace 的 `sync_data`，将外部用户/组同步入库（递归建组、external_id 映射、批量增改删）。
- `check_password_expiry_and_notify`：定时检查密码即将/已过期用户，读取 `pwd_set_validity_period`/`pwd_set_expiry_reminder_days` 系统设置，经 email 渠道发送提醒邮件（validity_days<=0 视为永不过期则跳过）。

## 7. 当前团队解析【已实现/已存在】
`GroupFilterMixin._parse_current_team_cookie` 已改为经 `core.utils.team_utils.get_current_team(request, default)` 解析当前团队：优先读取 API Key 注入的属性，回退到 `current_team` cookie，使 API Key 调用场景下的数据范围过滤正确生效。

## 8. 风险 / 待确认
- domain 多租户隔离在所有 ViewSet 是否强制【待确认】。
- 外部登录模块（LDAP/WeChat/BK）配置与回退【推断，需确认覆盖范围】。

## 9. 证据来源
- 路由：`server/apps/system_mgmt/urls.py:19-35`（含 `app` 路由 `urls.py:25`、企业版合并 `urls.py:33-37`）。
- 模型：`server/apps/system_mgmt/models/user.py:7-62`（User 字段与 `save()` 重写）、`models/sensitive_info_authorization.py:33-42`、`models/channel.py:7-14`（ChannelChoices 7 类）、`models/role.py`、`models/group_data_rule.py`。
- OperationLog 新字段：`server/apps/system_mgmt/models/operation_log.py:39-41`（`target_type`/`target_id`/`detail` 字段定义）、`server/apps/system_mgmt/migrations/0033_operationlog_target_detail.py:13-26`（迁移）。
- `save_operation_log` 签名扩展：`server/apps/system_mgmt/nats_api.py:1960-1996`（新增 `target_type`/`target_id`/`detail` 参数）。
- `search_opspilot_nats_channels`：`server/apps/system_mgmt/nats_api.py:948-1016`。
- `reset_pwd` 身份校验：`server/apps/system_mgmt/nats_api.py:1366-1387`。
- `verify_otp_code` 限频：`server/apps/system_mgmt/nats_api.py:1548-1575`、`server/apps/system_mgmt/otp_challenge.py:83,105,123`。
- 密码策略缓存：`server/apps/system_mgmt/utils/pwd_policy_cache.py:1-56`（TTL/默认值/批量查询/失效函数）、`server/apps/system_mgmt/viewset/system_settings_viewset.py:72-75`（`invalidate_pwd_policy_cache` 主动清除）、`server/apps/system_mgmt/nats_api.py:1288-1290,1326-1334,1662-1668`（login/verify_otp_login 路径调用）。
- `verify_token` 组树范围收窄/性能修复：`server/apps/system_mgmt/nats_api.py:64-92`（`_collect_ancestor_group_ids`）、`nats_api.py:255-273`（`verify_token` 非超管按祖先范围过滤）、`nats_api.py:108-116`（`get_user_all_roles` 按祖先范围 prefetch）。
- 当前团队解析：`server/apps/system_mgmt/utils/group_filter_mixin.py:6,124-125`（`get_current_team` 替换 cookie 直读）。
- 认证/权限缓存 TTL：`server/apps/core/utils/permission_cache.py:22,25`。
- Celery 任务：`server/apps/system_mgmt/tasks.py:14`（write_error_log_async）、`tasks.py:42`（sync_user_and_group_by_login_module）、`tasks.py:251`（check_password_expiry_and_notify）。
- 其他：`server/apps/system_mgmt/{services/role_manage.py,utils/*}`。
