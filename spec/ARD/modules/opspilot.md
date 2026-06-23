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
| Bot / BotChannel | `:22,70` | Bot（Rasa 模型/技能/渠道/部署）、渠道（GitLab/钉钉/企微/企微机器人/公众号，渠道密钥加密）。`team`（管理组织，工作台可见/编辑/删除/授权）与 `usage_team`（使用组织，仅可对话）并存，不变式 team ⊆ usage_team（`:25-29`）；管理组织天然具备使用权，存量数据由迁移 0058 回填 usage_team=team |
| BotConversationHistory | `:172` | Bot 对话历史（用户/机器人角色、引用知识、通道用户） |
| ConversationTag | `:189` | 对话标注（问题/答案关联到知识库与文档） |
| RasaModel | `:200` | Rasa 模型文件（MinIO `munchkin-private`） |
| ChannelUser / ChannelGroup / UserGroup | `:220,239,248` | 消息通道用户、通道群组、用户-群组关联 |
| BotWorkFlow | `:256` | 机器人工作流（flow/web JSON，保存时同步 ChatApplication） |
| ChatApplication | `:421` | 聊天应用（按工作流入口节点自动生成，mobile/web_chat 两类） |
| WorkflowAttachmentAsset | `:295` | 工作流附件资产（关联 FileKnowledge，下载令牌、execution/attachment 去重约束） |
| WorkFlowTaskResult | `:282` | 工作流执行主记录（执行实例、状态、输入/输出）；`is_test`（`:292`，BooleanField，带 db_index）标识该执行是否来自配置页测试，供查询接口过滤与画布回填逻辑使用 |
| WorkFlowTaskNodeResult | `:325` | 工作流节点执行明细（节点输入/输出、状态、耗时） |
| WorkFlowConversationHistory | `:361` | ChatFlow 对话历史（用户输入 + 系统输出两条/次，入口类型分流，定时触发不记录） |

> 证据来源：server/apps/opspilot/models/bot_mgmt.py:22-29（Bot.team/usage_team）,282,292（WorkFlowTaskResult.is_test）、migrations/0057_workflowtaskresult_is_test.py、migrations/0058_bot_usage_team.py　|　同步基线：0fbb99c25　|　【已实现】

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

### 3.1 机器人对外授权接口（`bot_mgmt/`）

- **`POST bot_mgmt/{id}/authorize_usage_team/`**【已实现/已存在】：管理组织将机器人开放给其它组织使用而不赋予管理权。三重防护：`get_object()`（team 作用域，非管理组织取不到 → 404）+ `HasPermission("bot_settings-Edit")`（管理编辑权）+ `_validate_org_field_permission`（只能授权授权人有权限的新增组织）。请求体 `usage_team` 为期望的完整使用组织列表，后端强制并入 `team`（管理组织恒不可删）。见 [[../../../server/apps/opspilot/viewsets/bot_view.py]] 及 [[../../../spec/prd/OpsPilot/工作台.md#4-关键规则]]。

> 证据来源：`server/apps/opspilot/viewsets/bot_view.py:216-244`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.2 工作流对话接口鉴权分支（`execute_chat_flow`）

`execute_chat_flow` 对测试请求（`is_test=True`）与正常对话（`is_test=False`）执行不同的 Bot 可见性校验：

- **测试执行**：仅按 `team`（管理组织）过滤 Bot，且同一 Bot 同时只允许一个测试执行实例（占位检查基于 `is_test=True` 的 RUNNING 记录）；使用组织不得发起测试执行。
- **正常对话**：按 `usage_team`（使用组织）过滤 Bot（管理组织因不变式 team ⊆ usage_team 已被包含），另外放行 `OpsPilotGuest` 顶级组（嵌入/访客对话场景）。Bot 须处于上线状态。
- 两类执行均须携带有效 API Token 并通过 `validate_openai_token` 校验。

> 证据来源：`server/apps/opspilot/views.py:645-665,700-708`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.3 人机协同接口认证变更（`submit_approval` / `submit_choice`）

`submit_approval` 与 `submit_choice` 两个人机协同决策接口原为免鉴权（`@api_exempt`），本轮变更为**必须携带有效 API Token**，并在 Token 通过后额外校验 `execution_id` 归属于调用方所在团队的 Bot（`bot_work_flow__bot__team__contains=int(user.team)`）；跨组织伪造决策将返回 404。此为对外调用契约的行为变化。

> 证据来源：`server/apps/opspilot/views.py:790-852,855-910`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.4 工作流执行结果查询（`workflow_task_result/`）

`WorkFlowTaskResultFilter` 新增 `is_test`（BooleanFilter）字段，列表接口支持按该字段过滤；序列化器已将 `is_test` 加入输出字段（`read_only_fields`）。执行上下文解析方法 `_authorize_execution` 同步改为通过 team 作用域的 `get_queryset()` 鉴权，非本团队或不存在的执行实例一律返回 404（不区分两种情况，避免 execution_id 存在性枚举）。

> 证据来源：`server/apps/opspilot/viewsets/workflow_task_result_view.py:23,44-77`；`server/apps/opspilot/serializers/workflow_task_result_serializer.py:24`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.5 对话历史批量查询的租户隔离（`HistoryViewSet`）

会话日志批量取数接口本轮收紧：`BotConversationHistory` 批量取数从按 `id__in` 直取改为叠加 `bot__team__contains=[current_team]` 团队作用域过滤，先经 `_validate_current_team_permission` 校验当前 team 再返回，防止跨租户按 id 枚举他人对话记录。`bot_serializer` 同步新增 `usage_team_name` 字段，工作台列表回显使用组织名称（与 `team_name` 同款，基于当前用户 `group_list`）。

> 证据来源：`server/apps/opspilot/viewsets/history_view.py:158-161`；`server/apps/opspilot/serializers/bot_serializer.py:13,37`　|　同步基线：0fbb99c2　|　【已实现/已存在】

### 3.6 `current_team` 解析改为 API Key 优先

`TeamPermissionMixin._parse_current_team_cookie` 及 llm/qa/knowledge/memory 等视图的 `current_team` 解析统一改用 `get_current_team(request, default)`：优先读取 API Key 注入的请求属性，回退到 `current_team` cookie。此变更使程序化（API Token）调用与浏览器会话调用走同一 team 作用域，支撑对外授权与对话接口的一致鉴权。

> 证据来源：`server/apps/opspilot/utils/team_permission_mixin.py:20-22`；`server/apps/opspilot/viewsets/{llm_view.py,qa_pairs_view.py,knowledge_base_view.py,memory_view.py}`　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 4. AI / RAG 集成【已实现/已存在】
- LangChain（`langchain_core.messages`）；`metis/llm/` 引擎（分块：fixed/semantic/recursive；embedding manager）。
- 内置工具（`metis/llm/tools/tools_loader.py:31-52` 的 `ToolsLoader.TOOL_MODULES`，共 19 个键）：attachment_file、agent_browser、browser_use、current_time（date）、duckduckgo（search）、elasticsearch、fetch、github、jenkins、kubernetes、kubernetes_data_collection、mssql、mysql、oracle、postgres、python、redis、shell、ssh；cmdb 已注释临时关闭（`:35`）。
- monitor 工具不在 `TOOL_MODULES`，由 `services/builtin_tools.py:4,58` 单独装配（与 redis/mysql/oracle/mssql/attachment_file 一并作为内置工具暴露）。
- RAG 模式：naive（**本地 pgvector**）/QA/graph（`services/{rag_service,knowledge_search_service,chat_service}.py`）。
- **外部依赖更正**（基于代码核对）：
  - Kubernetes：**已使用**，但经运行时 `kubeconfig_data` 参数加载（`metis/llm/tools/kubernetes/{utils,connection}.py`），**非** `KUBE_CONFIG_FILE` 环境变量。
  - `METIS_SERVER_URL`、`MUNCHKIN_BASE_URL`、`CONVERSATION_MQ_*`：仅在 `config.py` 中定义，**代码中未被引用**（占位/预留，当前 RAG 走本地 pgvector）。【待确认是否为历史遗留】

## 5. 任务与 NATS【已实现/已存在】
- 定时（`config.py`）：`cleanup-expired-workflow-attachments`（每日 3 点）、`flush-pending-memory-write-cache`（每日 0 点）。
- NATS（`nats_api.py` 中 `@nats_client.register` 注册，共 5 个）：`get_opspilot_module_list`（`:65`）、`get_opspilot_module_data`（`:85`）、`get_guest_provider`（`:118`）、`consume_bot_event`（`:162`）、`trigger_workflow_by_nats`（`:212`）。`get_opspilot_module_data` 对未知 `module`/`child_module` 改为返回失败结果而非 `KeyError`（`:100-106`）。
- 测试执行入口标记：配置页测试经 `chat_flow_test_execute_task` 异步执行时设置 `engine.is_test = True`（`tasks.py:1095`），落库的 `WorkFlowTaskResult.is_test` 据此为真。
- **同步执行链业务失败传播**【已实现/已存在】：节点以带内 `{"success": False}` 表达业务失败（如 agent 节点 LLM 调用失败、意图越界）时，`NodeRunnerMixin` 现将其转为失败的 `NodeResult`（`status=FAILED`、记录 `error_message`），否则 `_check_chain_result` 只看外层包装 `success=True` 会把失败误判为成功——错误结果被当正常回复回传、`WorkFlowTaskResult` 被误记为成功。影响 celery/nats/第三方渠道等非流式同步路径。
  > 证据来源：`server/apps/opspilot/utils/chat_flow_utils/engine/node_runner.py:198-213`　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 6. 风险 / 待确认
- `METIS_SERVER_URL`/`MUNCHKIN_BASE_URL`/`CONVERSATION_MQ_*` 在 config.py 定义但未被代码引用——是历史遗留还是外部联动入口【待确认】。
- LLM 调用的成本/限流/审计【待确认】。
- `usage_team` 的跨组织授权场景下，授权范围是否需要审计日志（当前已记录 operation log，深度待确认）【待确认】。

## 7. 证据来源
`server/apps/opspilot/{urls.py,models/*,services/*,metis/llm/*,tasks.py,config.py,nats_api.py}`；模型表见 `models/{model_provider_mgmt.py,bot_mgmt.py,knowledge_mgmt.py,memory_mgmt.py,user_pin.py}`；内置工具见 `metis/llm/tools/tools_loader.py:31-52`、`services/builtin_tools.py`；protocol_type 持久化见 `migrations/0049_modelvendor_protocol_type.py`；本轮变更迁移见 `migrations/0057_workflowtaskresult_is_test.py`、`migrations/0058_bot_usage_team.py`；授权接口见 `viewsets/bot_view.py:216-244`；对话鉴权见 `views.py:645-665`；人机协同鉴权见 `views.py:790-910`；执行记录查询见 `viewsets/workflow_task_result_view.py:23,44-77`；对话历史租户隔离见 `viewsets/history_view.py:158-161`；同步链失败传播见 `utils/chat_flow_utils/engine/node_runner.py:198-213`。
