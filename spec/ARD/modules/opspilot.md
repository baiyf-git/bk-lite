# 模块 ARD：OpsPilot（AI 助手）

> 路径 `server/apps/opspilot` ｜ API 前缀 `api/v1/opspilot/`

## 1. 职责【已实现/已存在】
AI 助手平台：RAG 检索增强、知识库管理、Bot 编排、LLM 厂商接入、工作流自动化与记忆管理。

## 2. 数据模型与存储【已实现/已存在】

模型可按子域分组（文件即子域边界）。下表覆盖各子域全部模型类。

**模型供应商 / 技能子域（`models/model_provider_mgmt.py`）**

| 模型 | 行 | 说明 |
|------|----|------|
| ModelVendor | `:27` | 厂商（OpenAI/Azure/Aliyun/Zhipu/Baidu/Anthropic/DeepSeek/other）；`api_key` 加密；含持久化字段 `protocol_type`（CharField，choices=openai/anthropic，迁移 `0049_modelvendor_protocol_type.py`，默认 openai）（`:30`） |
| LLMModel | `:68` | LLM 模型（关联厂商）。`protocol_type` 为只读 property（`:100-110`）：anthropic 厂商→anthropic；deepseek/other→读取 `vendor.protocol_type`；其余→openai，支撑非 OpenAI 协议接入 |
| EmbedProvider / RerankProvider | `:118,154` | Embed / Rerank 模型（密钥经厂商解密） |
| OCRProvider | `:190` | OCR 解析提供方（EncryptMixin，供 KnowledgeDocument 解析） |
| LLMSkill | `:232` | 智能体/技能（LLM 模型、提示词、RAG 配置、工具列表、技能类型、对话历史窗口、知识库路由等） |
| SkillTools | `:295` | 工具集（参数、标签、tools 列表，可复用注册） |
| SkillRequestLog | `:309` | 技能调用请求日志（请求/响应明细、来源 IP、成败状态） |

**Bot / 工作流子域（`models/bot_mgmt.py`）**

| 模型 | 行 | 说明 |
|------|----|------|
| Bot / BotChannel | `:22,70` | Bot（Rasa 模型/技能/渠道/部署）、渠道（GitLab/钉钉/企微/企微机器人/公众号，渠道密钥加密）。Bot 含两个组织字段：`team`（管理组织，JSONField，工作台可见/编辑/删除/授权，`:25`）与 `usage_team`（使用组织，JSONField default=list，`:29`），不变式 `team ⊆ usage_team`（管理组织恒并入使用组织、不可删）【已实现/已存在】（`models/bot_mgmt.py:25-29`；`migrations/0058_bot_usage_team.py:32-38`；存量回填：迁移将 `usage_team` 初始化为 `team` 保持行为一致）。管理组织可通过 `authorize_usage_team` 动作将 bot 开放给其它组织发起对话（不授予管理权）（`viewsets/bot_view.py:216-243`）。 |
| BotConversationHistory | `:172` | Bot 对话历史（用户/机器人角色、引用知识、通道用户） |
| ConversationTag | `:189` | 对话标注（问题/答案关联到知识库与文档） |
| RasaModel | `:200` | Rasa 模型文件（MinIO `munchkin-private`） |
| ChannelUser / ChannelGroup / UserGroup | `:220,239,248` | 消息通道用户、通道群组、用户-群组关联 |
| BotWorkFlow | `:256` | 机器人工作流（flow/web JSON，保存时同步 ChatApplication） |
| ChatApplication | `:421` | 聊天应用（按工作流入口节点自动生成，mobile/web_chat 两类） |
| WorkflowAttachmentAsset | `:290` | 工作流附件资产（关联 FileKnowledge，下载令牌、execution/attachment 去重约束） |
| WorkFlowTaskResult | `:278` | 工作流执行主记录（执行实例、状态、输入/输出）。新增字段 `is_test`（BooleanField, default=False, db_index=True, `:292`）【已实现/已存在】（`migrations/0057_workflowtaskresult_is_test.py`），用于区分配置页测试执行（`is_test=True`，由 `chat_flow_test_execute_task` 通过 `engine.is_test=True` 透传写入）与真实对话执行（`is_test=False`）；执行记录列表支持 `is_test` 过滤（`viewsets/workflow_task_result_view.py:23`）；配置页画布仅恢复 `is_test=True` 的运行中执行（`viewsets/bot_view.py:104-110`）；同 bot 同时仅允许一个运行中测试执行（`views.py:700-705`）。 |
| WorkFlowTaskNodeResult | `:325` | 工作流节点执行明细（节点输入/输出、状态、耗时） |
| WorkFlowConversationHistory | `:361` | ChatFlow 对话历史（用户输入 + 系统输出两条/次，入口类型分流，定时触发不记录） |

**知识库子域（`models/knowledge_mgmt.py`）**

| 模型 | 行 | 说明 |
|------|----|------|
| KnowledgeBase | `:28` | 知识库（embed/rerank、naive/QA/graph RAG 开关、阈值/召回模式） |
| KnowledgeDocument | `:56` | 知识文档（解析模式、分块类型、OCR、训练状态） |
| FileKnowledge / WebPageKnowledge / ManualKnowledge | `:120,149,177` | 文件知识（MinIO `munchkin-private`）、网页知识（可定时同步）、手工录入知识 |
| QAPairs | `:192` | 问答对（生成模型、问/答提示词、状态） |
| KnowledgeGraph / GraphChunkMap / KnowledgeTask | `:218,228,234` | 知识图谱（一对一知识库）、Chunk↔Graph 映射、知识训练任务（进度/状态） |

**记忆子域（`models/memory_mgmt.py`）**

| 模型 | 行 | 说明 |
|------|----|------|
| MemorySpace | `:9` | 记忆空间（storage_type 枚举 local/mem0/zep/custom，个人/团队范围，配置敏感字段加密） |
| Memory | `:104` | 记忆条目（按用户/组织隔离，标题 + 内容） |
| MemoryWriteCache | `:137` | 记忆批量写缓存（workflow/node/target 去重，PENDING/PROCESSING 状态机） |

**其他（`models/user_pin.py`）**

| 模型 | 行 | 说明 |
|------|----|------|
| UserPin | `:4` | 用户置顶记录（按用户隔离，置顶 Bot 或 LLMSkill） |

**存储**：PostgreSQL + **pgvector**（向量）；MinIO（知识文件/Rasa 模型/工作流附件，桶 `munchkin-private`）；Elasticsearch（metis 工具检索）。

## 3. 接口【已实现/已存在】
`model_provider_mgmt/*`、`bot_mgmt/*`（含 OpenAI 兼容 `/v1/chat/completions`、`/lobe_chat/v1/chat/completions`）、`channel_mgmt/*`、`knowledge_mgmt/*`、`memory_mgmt/*`。

## 4. AI / RAG 集成【已实现/已存在】
- LangChain（`langchain_core.messages`）；`metis/llm/` 引擎（分块：fixed/semantic/recursive；embedding manager）。
- 内置工具（`metis/llm/tools/tools_loader.py:31-52` 的 `ToolsLoader.TOOL_MODULES`，约 19 类）：attachment_file、agent_browser、browser_use、current_time（date）、duckduckgo（search）、elasticsearch、fetch、github、jenkins、kubernetes、kubernetes_data_collection、mssql、mysql、oracle、postgres、python、redis、shell、ssh；cmdb 已注释临时关闭（`:35`）。
- monitor 工具不在 `TOOL_MODULES`，由 `services/builtin_tools.py:4,58` 单独装配（与 redis/mysql/oracle/mssql/attachment_file 一并作为内置工具暴露）。
- RAG 模式：naive（**本地 pgvector**）/QA/graph（`services/{rag_service,knowledge_search_service,chat_service}.py`）。
- **外部依赖更正**（基于代码核对）：
  - Kubernetes：**已使用**，但经运行时 `kubeconfig_data` 参数加载（`metis/llm/tools/kubernetes/{utils,connection}.py`），**非** `KUBE_CONFIG_FILE` 环境变量。
  - `METIS_SERVER_URL`、`MUNCHKIN_BASE_URL`、`CONVERSATION_MQ_*`：仅在 `config.py` 中定义，**代码中未被引用**（占位/预留，当前 RAG 走本地 pgvector）。【待确认是否为历史遗留】

## 5. 鉴权与租户隔离【已实现/已存在】

### 5.1 current_team 上下文读取

`current_team` 统一经 `apps.core.utils.team_utils.get_current_team`（`apps/core/utils/team_utils.py:23`）读取，优先级：`request._api_current_team`（APISecretMiddleware 在无浏览器 cookie 时注入）> `request.COOKIES["current_team"]`（浏览器登录态）> default。使 API Key 调用与浏览器调用经同一路径解析 team 上下文，下游无需区分来源（`utils/team_permission_mixin.py:20`）。

### 5.2 execute_chat_flow 对话鉴权

【已实现/已存在】（`views.py:638,650-661`）  
正常对话（`is_test=False`）按 `usage_team__contains=[current_team]` 过滤 Bot，额外叠加 `OpsPilotGuest` 顶级组（嵌入/访客对话场景）。测试执行（`is_test=True`，仅管理页发起）按 `team__contains=[current_team]` 过滤，即仅管理组织可发起测试——因测试执行会回填画布并占用"同 bot 同时仅一个测试"槽位，属管理活动，使用组织不得触发。由于不变式 `team ⊆ usage_team`，管理组织天然具备正常对话权。

### 5.3 submit_approval / submit_choice 鉴权收紧

【已实现/已存在】（`views.py:790-866`）  
两个接口由原匿名豁免（`@api_exempt`）改为强制有效 API Token 鉴权（`validate_openai_token`）+ `execution_id` 归属校验（`WorkFlowTaskResult.bot_work_flow__bot__team__contains=int(user.team)`）。归属校验失败（跨租户或不存在）统一返回 404，防止伪造审批/选择决策及 `execution_id` 枚举。

### 5.4 工作流执行节点查询与会话历史

【已实现/已存在】  
- **工作流执行节点查询**（`viewsets/workflow_task_result_view.py:44-71`）：`_authorize_execution` 通过 `get_queryset()`（内含 `team__contains` 过滤）解析 `WorkFlowTaskResult`，不存在或属于他团队一律 `NotFound(404)`，两种情况不区分，避免 `execution_id` 存在性枚举。
- **会话历史**（`viewsets/history_view.py:158-162`）：批量拉取 `BotConversationHistory` 时叠加 `bot__team__contains=[current_team]`，防止跨租户枚举他团队对话记录。

### 5.5 节点 in-band 失败传播

【已实现/已存在】（`utils/chat_flow_utils/engine/node_runner.py:193-213`；`utils/chat_flow_utils/engine/engine.py:61,216`；`tasks.py:1094-1095`）  
节点以 `{"success": False}` 表达业务失败（如 LLM 调用失败、意图越界）时，`NodeRunnerMixin` 将其转为失败 `NodeResult` 并将 `WorkFlowTaskResult` 记为失败状态，避免同步执行路径（Celery/NATS/第三方渠道）将错误结构误当正常回复下发。`ChatFlowEngine.is_test` 标志经 `engine.py:216` 透传至 `WorkFlowTaskResult.is_test`。

## 6. 任务与 NATS【已实现/已存在】

- 定时（`config.py`）：`cleanup-expired-workflow-attachments`（每日 3 点）、`flush-pending-memory-write-cache`（每日 0 点）。
- NATS（`nats_api.py` 中 `@nats_client.register` 注册，共 5 个）：`get_opspilot_module_list`（`:65`）、`get_opspilot_module_data`（`:85`）、`get_guest_provider`（`:118`）、`consume_bot_event`（`:162`）、`trigger_workflow_by_nats`（`:212`）。

## 7. 风险 / 待确认
- `METIS_SERVER_URL`/`MUNCHKIN_BASE_URL`/`CONVERSATION_MQ_*` 在 config.py 定义但未被代码引用——是历史遗留还是外部联动入口【待确认】。
- LLM 调用的成本/限流/审计【待确认】。

## 8. 证据来源
`server/apps/opspilot/{urls.py,models/*,services/*,metis/llm/*,tasks.py,config.py,nats_api.py}`；模型表见 `models/{model_provider_mgmt.py,bot_mgmt.py,knowledge_mgmt.py,memory_mgmt.py,user_pin.py}`；内置工具见 `metis/llm/tools/tools_loader.py:31-52`、`services/builtin_tools.py`；protocol_type 持久化见 `migrations/0049_modelvendor_protocol_type.py`。

本轮新增证据：
- `models/bot_mgmt.py:25-29`（Bot.usage_team 字段）；`migrations/0058_bot_usage_team.py:32-38`（usage_team 迁移与存量回填）
- `models/bot_mgmt.py:292`（WorkFlowTaskResult.is_test 字段）；`migrations/0057_workflowtaskresult_is_test.py`
- `viewsets/bot_view.py:104-110`（画布仅恢复 is_test=True 执行）；`viewsets/bot_view.py:129-143`（create 时写入 usage_team）；`viewsets/bot_view.py:172-186`（update 维护不变式）；`viewsets/bot_view.py:216-243`（authorize_usage_team action）
- `views.py:638,650-661`（execute_chat_flow 按 usage_team/team 分流鉴权）；`views.py:700-705`（同 bot 仅一个运行中测试）；`views.py:790-866`（submit_approval/submit_choice 去除 @api_exempt，加 Token+归属校验）
- `viewsets/workflow_task_result_view.py:23`（is_test 过滤器）；`viewsets/workflow_task_result_view.py:44-71`（_authorize_execution team 作用域鉴权，越权/不存在统一 404）
- `viewsets/history_view.py:158-162`（会话历史叠加 bot__team__contains 防跨租户枚举）
- `utils/team_permission_mixin.py:20`（get_current_team 调用点）；`apps/core/utils/team_utils.py:23-41`（get_current_team 实现，优先 _api_current_team 属性）
- `utils/chat_flow_utils/engine/node_runner.py:193-213`（节点 in-band {success:False} 失败传播）；`utils/chat_flow_utils/engine/engine.py:61,216`（is_test 标志透传至 WorkFlowTaskResult）；`tasks.py:1094-1095`（chat_flow_test_execute_task 设置 engine.is_test=True）
