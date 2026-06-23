# OpsPilot 智能运维助手 · 功能清单

**文档版本：** V1.2
**发布日期：** 2026-06-23
**适用范围：** BK-Lite OpsPilot 智能运维助手模块
**编制依据：** OpsPilot PRD v1.1（2026-05-28）、工作台 PRD（同步基线 0fbb99c2）与 `server/apps/opspilot`、`web/src/app/opspilot` 源代码核对；增量更新基于 rogerly 分支（git diff master..HEAD -- server/apps/opspilot，核对日期 2026-06-23）

---

## 一、模块定位

OpsPilot 是 BK-Lite 的智能应用构建与运营平台，提供从基础模型接入、工具与知识库管理、记忆管理、智能体与 ChatFlow 工作流编排，到多渠道对话交付与日志统计的全链路能力。模型密钥、工具密码、渠道密钥等敏感配置全程加密或脱敏，资源可见范围以**团队分组（即系统管理中的组织/组，详见编制规范 SOP 2.2）**为边界。本清单仅列已实现能力；演进展望类内容不纳入。

## 二、功能清单

### 1. 模型管理

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 模型类型管理 | 四类基础模型的统一管理 | LLM、Embed（嵌入）、Rerank（重排）、OCR | GA |
| 模型 CRUD 与启停 | 模型新增、编辑、删除、启用 / 停用与分组展示 | — | GA |
| 模型分组 | 模型分组维护与排序调整 | — | GA |
| 供应商管理 | 模型供应商维护与详情查看 | 供应商类型：OpenAI、Azure、阿里云、智谱、百度、Anthropic、DeepSeek、其它 | GA |
| 协议类型 | 供应商协议类型选择 | OpenAI 兼容、Anthropic 兼容；DeepSeek 与"其它"类型可选协议，Anthropic 固定 anthropic，其余按 openai 推导 | GA |
| 密钥加密存储 | 供应商 API Key 等密钥配置加密存储 | 读取时不明文展示 | GA |
| 团队可见范围 | 按团队分组控制模型可见范围 | 非超级管理员仅可访问有权限团队内资源 | GA |

### 2. 工具管理

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 工具列表与检索 | 工具列表展示，按名称 / 标签检索 | — | GA |
| 工具 CRUD | 工具的新增、编辑、删除 | 工具名称唯一 | GA |
| MCP 链接配置 | 配置 MCP 链接与变量 | — | GA |
| 变量类型 | 工具变量支持类型区分 | 含文本与密码类型；密码类型字段加密保存 | GA |
| MCP 子工具拉取 | 从 MCP 拉取可用子工具能力 | — | GA |
| 工具展示名 | 内置工具支持中英文展示名（display_name） | 通过语言包 en.yaml / zh-Hans.yaml 配置 | GA |
| 团队可见范围 | 按团队分组控制工具可见范围 | — | GA |

### 3. 知识库管理

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 知识库 CRUD | 知识库的新增、编辑、删除、详情查看 | 名称唯一；删除前检查是否被智能体引用 | GA |
| 知识来源 | 支持三类知识来源 | 本地文件、网页链接、自定义文本 | GA |
| 文档预处理 | 文本提取、分块预览与训练 | 默认分块大小 256、重叠 32，分块方式默认 fixed_size | GA |
| OCR 解析 | 文档可选启用 OCR 解析 | 依赖已配置的 OCR 模型 | GA |
| 文档训练状态 | 文档训练状态展示 | 5 态：待处理(Pending)、分块中(Chunking)、训练中(Training)、就绪(Ready)、错误(Error) | GA |
| 检索配置 | 配置检索模式、阈值、返回规模 | 默认检索类型 similarity_score_threshold，默认分数阈值 0.7 | GA |
| Rerank 与召回 | 配置 Rerank 模型与召回 | 默认启用 Rerank，默认 Top K 10；召回模式默认 chunk | GA |
| RAG 模式 | 支持多种 RAG 模式开关 | 朴素 RAG（默认开）、问答对 RAG（默认开）、知识图谱 RAG（默认关） | GA |
| 问答对管理 | 问答对生成、导入、编辑、删除、预览 | — | GA |
| 知识图谱 | 知识图谱创建、查看、更新与社区重建 | — | GA |
| 基础模型变更约束 | 变更知识库基础模型后须对文档重训练 | — | GA |

### 4. 记忆管理

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 记忆空间 CRUD | 记忆空间的新增、编辑、删除、详情查看 | — | GA |
| 可见范围 | 记忆空间可见范围设置 | 2 种：个人记忆(personal)、团队记忆(team) | GA |
| 存储引擎 | 记忆空间支持多种存储后端 | 4 种：本地存储(local，默认)、Mem0、Zep、自定义 API(custom)；引擎通过 MemoryEngineRegistry 注册，local 开箱即用，Mem0/Zep 需安装对应 SDK | GA |
| 空间配置 | 配置简介、写入规则、默认模型与存储引擎配置 | 存储配置中的敏感字段（如 api_key）加密存储 | GA |
| 写入测试 | 基于写入规则与默认模型由 LLM 处理输入并返回结果 | 缺少写入规则时直接返回原始输入 | GA |
| 记忆条目管理 | 记忆条目的新增、编辑、删除、查看 | 含标题与内容；条目归属记忆空间，空间删除时条目一并删除 | GA |
| 条目可见性 | 个人记忆空间内条目仅创建者可见；团队记忆空间按团队可见性共享 | 个人记忆按 owner_username / owner_domain 隔离，组织记忆按 organization_id 隔离 | GA |
| 条目筛选 | 记忆条目按记忆空间筛选 | — | GA |
| 记忆写入缓冲 | 支持按工作流节点分批缓冲写入，合并后再落库 | MemoryWriteCache 模型；Celery Beat 在每日 00:00 自动冲刷全部待处理缓冲 | GA |
| 引擎管理 API | 可查询已注册的记忆引擎列表、获取引擎配置 Schema、对非 local 引擎进行连接测试 | `GET /api/proxy/opspilot/memory_mgmt/memory_engines/`、`GET /api/proxy/opspilot/memory_mgmt/memory_engines/{type}/schema/`、`POST /api/proxy/opspilot/memory_mgmt/memory_engines/{type}/test/`（DRF 路由 basename=memory_engines，url_path 子路径 schema/test） | GA |
| ChatFlow 记忆节点 | 在 ChatFlow 中通过记忆节点引用记忆能力 | 含记忆读取(memory_read)、记忆写入(memory_write)节点 | GA |

> 证据来源：server/apps/opspilot/models/memory_mgmt.py（MemorySpace.STORAGE_CHOICES、MemoryWriteCache）、server/apps/opspilot/memory/engines/registry.py、server/apps/opspilot/viewsets/memory_engine_view.py、server/apps/opspilot/config.py（flush-pending-memory-write-cache Beat 任务）

### 5. 智能体管理

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 智能体列表 | 列表展示、搜索与置顶 | 支持置顶状态切换 | GA |
| 智能体 CRUD | 智能体的创建、编辑、删除 | — | GA |
| 模板化创建 | 智能体模板列表与模板化创建 | — | GA |
| 基础配置 | 配置模型、提示词、温度、简介、分组 | 默认温度 0.7 | GA |
| 增强配置 | 聊天历史、RAG、工具增强 | 默认对话窗口大小 10 | GA |
| 知识库阈值与严格模式 | 每知识库独立阈值配置与 RAG 严格模式配置 | 关闭 RAG 时清空关联知识库与阈值映射 | GA |
| 技能类型 | 智能体技能类型 | 4 种：基础工具、知识工具、Plan-Execute、LATS | GA |
| 流式执行 | 智能体执行（流式响应）与 AG-UI 协议执行 | — | GA |

### 6. 工作台（Studio）与 ChatFlow

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 应用机器人管理 | 应用机器人列表管理与上线 / 下线；列表按**管理组织**（team）过滤，使用组织不可在工作台查看 | 上线后可对外服务，下线后停止对外响应；仅管理组织成员可见与操作 | GA |
| 机器人二级授权模型 | 机器人同时维护「管理组织」（team）与「使用组织」（usage_team）两个维度的授权 | 管理组织：可在工作台查看 / 编辑 / 删除 / 授权；使用组织：仅可调用对话接口，不可管理；不变式 team ⊆ usage_team，管理组织恒并入使用组织且不可删除（`bot_mgmt.py:25-29`） | GA |
| 对外授权使用组织 | 管理组织可将机器人对话权开放给其它组织，被授权组织仅获得对话权、不获得管理权 | 请求体传入期望的完整 usage_team 列表，后端强制并入 team；仅可新增调用方自身有权限的组织（`bot_view.py:216-244`）；接口 `POST /api/proxy/opspilot/bot_mgmt/bot/{id}/authorize_usage_team/` | GA |
| 应用类型 | 支持三类应用 | Pilot、LobeChat、ChatFlow | GA |
| ChatFlow 画布编排 | ChatFlow 画布编排与节点配置 | 应用由工作流保存时自动同步，不通过应用接口直接创建 | GA |
| 节点类别 | ChatFlow 支持的节点类别 | 触发、应用、智能体、记忆、逻辑判断（条件/意图分类）、动作（HTTP/通知）等 | GA |
| 节点执行测试 | 节点执行测试与执行过程查看 | 节点状态：pending/running/completed/failed | GA |
| 节点业务失败传播 | 同步执行链（Celery/NATS/第三方渠道等非流式路径）下，节点以带内 `{"success": False}` 表达的业务失败会被正确判为失败 | 失败结果不再被当作正常回复回传、任务不再被误记为成功（`node_runner.py:198-213`） | GA |
| 执行测试隔离 | 配置页测试执行与真实对话执行相互隔离 | 仅 is_test=True 的运行中执行回填配置画布（WorkFlowTaskResult.is_test 字段区分）；测试并发守卫只计测试执行（同一机器人同时仅一个活跃测试执行）；被授权使用组织不可发起测试 | GA |
| 流程中断与提交 | 执行流程中断、审批提交与选择提交 | 任务状态：running/interrupt_requested/interrupted/success/fail；审批提交/选择提交需有效 API Token 且 execution_id 归属调用者组织 | GA |
| 执行与会话日志 | 执行日志检索、会话日志查看、输出数据查看；支持按「是否测试执行」过滤 | 主任务与节点级结果均保留；`is_test` 字段随结果返回；执行日志/节点结果/对话历史详情均按调用者组织作用域返回，越权返回 404 | GA |
| NATS 触发节点同步 | ChatFlow 发布时，workflow 中 type=nats 的触发节点自动同步为 system_mgmt 中的 NATS 通道 | 通道名 `{bot名} - {节点label}`，config 中携带 source="opspilot"/bot_id/node_id；删除应用时自动清理托管通道 | GA |
| 工作流附件文件 | 工作流执行中可生成可下载的附件文件并通过签名 URL 分发 | 支持格式：md、pdf、docx/word；附件存储到 MinIO，签名 URL 默认有效期 24 小时（可配置 WORKFLOW_ATTACHMENT_DOWNLOAD_MAX_AGE）；Celery Beat 在每日 03:00 清理 3 天前的附件 | GA |
| 统计视图 | 会话量、活跃用户、Token 消耗等统计 | — | GA |
| 操作日志 | 工作台、渠道、记忆空间、知识图谱等资源的 CRUD 操作自动写入平台操作日志 | 通过 log_operation 统一记录，涵盖新增/编辑/删除/启动/停止操作 | GA |

> 证据来源：server/apps/opspilot/models/bot_mgmt.py（usage_team 字段、WorkflowAttachmentAsset 模型）、viewsets/bot_view.py（_merge_usage_team、authorize_usage_team、UPDATABLE_FIELDS）、services/nats_channel_sync.py、services/workflow_attachment_service.py、config.py（cleanup-expired-workflow-attachments Beat 任务）、viewsets/channel_view.py、viewsets/memory_view.py、viewsets/knowledge_graph_view.py、utils/chat_flow_utils/engine/node_runner.py:198-213（节点业务失败传播）　|　同步基线：rogerly 分支 2026-06-23　|　【已实现】
> 参见：[[../ARD/modules/opspilot.md#3-接口]]、[[../prd/OpsPilot/工作台.md#4-关键规则]]

### 7. 渠道与会话

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| 渠道类型 | 支持的渠道类型 | 6 种：企业微信、企业微信机器人、微信公众号、钉钉、Web、GitLab | GA |
| 渠道参数配置 | 渠道参数配置，敏感字段脱敏展示 | 密钥字段加密存储，对外返回以掩码显示 | GA |
| 会话列表 | Web / Mobile 会话列表查询 | 按用户维度返回，按最近会话时间倒序 | GA |
| 会话历史消息 | 会话历史消息查询 | 支持 Web 与 Mobile 入口类型 | GA |
| 引导语查询 | 技能引导语查询 | — | GA |
| 会话删除 | 按会话删除历史记录 | 仅作用于当前用户指定会话 | GA |

### 8. 对外接口与触发

| 功能项 | 功能说明 | 规格 / 约束 | 状态 |
|---|---|---|---|
| OpenAI 风格接口 | OpenAI 风格聊天补全接口 | — | GA |
| LobeChat 兼容接口 | LobeChat 兼容聊天补全接口 | — | GA |
| ChatFlow 执行接口 | 按 bot_id / node_id 执行 ChatFlow；鉴权与 bot 可见范围按调用场景区分 | 正常对话（is_test=false）：按**使用组织**（usage_team）放行，含 OpsPilotGuest 访客组；配置页测试（is_test=true）：仅**管理组织**（team）可发起，同一机器人同时仅允许一个测试执行（`views.py:646-708`） | GA |
| 企业渠道触发 | 企业微信、微信公众号、钉钉触发入口 | — | GA |
| NATS 触发入口 | 由告警中心通过 NATS 消息触发 OpsPilot ChatFlow workflow | NATS API `trigger_workflow_by_nats`；team 限单组织 ID；执行类型记为 `nats`；入参校验完整（message/team/user_ids/bot_id/node_id）| GA |
| 工作流执行类型 | 支持的工作流执行类型 | 共 11 种：OpenAI、RESTful、Celery（定时）、企业微信、微信公众号、钉钉、嵌入式对话、Web、Mobile、AG-UI、NATS | GA |
| 人机协同审批接口 | 提交审批决策（submit_approval），用户对智能体危险操作进行批准 / 拒绝 | 必须携带有效 API Token；校验 execution_id 归属调用方所在组织的 Bot，跨组织伪造决策返回 404（`views.py:790`） | GA |
| 人机协同选择接口 | 提交用户选择（submit_choice），用户从多个选项中做出选择 | 必须携带有效 API Token；同上归属校验，拒绝跨组织劫持他人工作流选择（`views.py:855`） | GA |
| 工作流附件下载 | 工作流执行生成的附件通过签名 URL 下载 | `GET /api/proxy/opspilot/bot_mgmt/workflow_attachment/download/{token}/`；Token 绑定 aid+eid，TimestampSigner 签名防猜测与越权；默认 24 小时有效期 | GA |

## 三、能力边界与约束

资源可见范围以团队分组为边界，非超级管理员仅可访问有权限团队内资源，关键资源编辑需通过模块权限点校验。应用机器人区分管理组织（team）与使用组织（usage_team），不变式 team⊆usage_team 在创建/更新/授权时强制维持；使用组织仅可对话不可管理；审批/选择提交、执行日志与对话历史详情严格按组织作用域鉴权，越权访问一律返回不可见（404）。知识库名称唯一，删除前须检查智能体引用，变更基础模型后须重训练文档；文档须经"上传—处理—训练—可检索"全状态机方可使用。个人记忆条目仅创建者可见，记忆空间删除时其条目一并删除；记忆写入支持 LLM 异步合并，团队/个人写入路径均通过 Celery 任务异步处理。应用由 ChatFlow 工作流保存时自动同步，不经应用接口直接创建。模型密钥、工具密码、渠道密钥、记忆存储配置中的 api_key 全程加密存储且对外脱敏展示。模型供应商被子模型引用时删除请求返回 400（而非 500），需先删除子模型才可删除供应商；Bot 更新接口仅允许白名单字段写入，防止 mass-assignment。工作流附件签名 URL 绑定附件主键与执行 ID，默认 24 小时过期；附件文件每日 03:00 清理 3 天前的历史记录（MinIO + DB 同步清理）。NATS 触发仅限单组织调用，多组织 team 拒绝处理。本模块不含非 OpsPilot 模块的资产管理、作业编排与监控能力，不定义第三方平台的组织权限模型。

## 四、平台协同

OpsPilot 的知识库与智能体可结合 CMDB 资产事实数据回答运维问询；ChatFlow 的触发节点支持 Web、移动端、企业微信 / 钉钉 / 微信公众号、GitLab 等渠道，与控制台及外部协作工具对接；定时触发依赖 Celery 调度。团队分组与权限语义与系统管理的组织及 RBAC 体系一致；执行日志、会话日志与统计数据支撑审计追溯。

## 五、支持的模型、知识与工具范围

以下枚举均以后端 `apps/opspilot/enum.py`、`models/*` 与前端 `web/src/app/opspilot/constants` 为准。

> **状态：本节 5.1–5.x 所列模型类型、供应商、知识来源/文件类型、渠道、工具类目、ChatFlow 节点等枚举均为 GA。** 例外说明：CMDB 工具在工具目录中存在但当前未在加载器 `TOOL_MODULES` 中启用（已注释临时关闭），不计入可用工具范围；monitor 已作为内置工具（builtin）可用，但不经 TOOL_MODULES 加载（见 5.5 备注）；其余无 Beta/试验项。

### 5.1 模型类型

| 模型类型 | 后端模型 | 说明 |
|---|---|---|
| LLM 大语言模型 | `LLMModel` | 对话/推理基础模型 |
| Embed 向量模型 | `EmbedProvider` | 文档向量化 |
| Rerank 重排模型 | `RerankProvider` | 检索结果重排 |
| OCR 模型 | `OCRProvider` | 图片/扫描件文字识别 |

共 4 类模型，各自支持内置（`is_build_in`）与自定义。

### 5.2 模型供应商类型（VENDOR_TYPE_CHOICES）与协议类型（PROTOCOL_TYPE_CHOICES）

| 供应商类型 | 取值 |
|---|---|
| OpenAI | `openai` |
| Azure | `azure` |
| 阿里云 | `aliyun` |
| 智谱 | `zhipu` |
| 百度 | `baidu` |
| Anthropic | `anthropic` |
| DeepSeek | `deepseek` |
| 其它 | `other` |

供应商类型共 8 种；协议类型 2 种：OpenAI 兼容（`openai`）、Anthropic 兼容（`anthropic`）。Anthropic 类供应商固定 Anthropic 协议，DeepSeek/其它类型支持协议选择。

### 5.3 知识库文档来源类型（knowledge_source_type）

| 来源类型 | 取值 |
|---|---|
| 文件上传 | `file` |
| 网页 | `web_page` |
| 手动录入 | `manual` |

共 3 种来源（另含 QA 问答对衍生数据）。文件来源支持扩展名 10 种：md、docx、xlsx、csv、pptx、pdf、txt、png、jpg、jpeg（`KNOWLEDGE_TYPES`）。

### 5.4 知识库检索能力

| 能力 | 字段 | 默认 |
|---|---|---|
| 朴素 RAG（分块检索） | `enable_naive_rag` | 开 |
| QA 问答对 RAG | `enable_qa_rag` | 开 |
| 图谱 RAG（GraphRAG） | `enable_graph_rag` | 关 |
| 重排（Rerank） | `enable_rerank` | 开（默认 Top K 10） |

检索方式默认 `similarity_score_threshold`（相似度阈值）；召回模式默认按 chunk。共 3 类 RAG 检索能力可组合启用。

### 5.5 内置可用工具（ToolsLoader 注册类目）

后端 `metis/llm/tools/tools_loader.py` 静态注册以下工具类目（每类含多个具体工具，按 `StructuredTool` 实例发现并写入 SkillTools 表）：

| 工具类目 | 标识 | 说明 |
|---|---|---|
| 工作流附件文件 | `attachment_file` | 生成 Markdown/PDF/Word 附件并返回签名下载链接 |
| 浏览器代理 | `agent_browser` / `browser_use` | 智能浏览 |
| 当前时间 | `current_time` | 时间获取 |
| DuckDuckGo 搜索 | `duckduckgo` | 联网搜索 |
| 网页抓取 | `fetch` | HTML/文本/Markdown 抓取 |
| GitHub | `github` | 代码仓库查询 |
| Jenkins | `jenkins` | 流水线查询 |
| Kubernetes | `kubernetes` / `kubernetes_data_collection` | 集群巡检/数据采集 |
| Elasticsearch | `elasticsearch` | 索引/查询 |
| MySQL | `mysql` | 数据库分析 |
| PostgreSQL | `postgres` | 数据库分析 |
| Oracle | `oracle` | 数据库分析 |
| MSSQL | `mssql` | 数据库分析 |
| Redis | `redis` | 缓存分析 |
| Shell | `shell` | 命令执行 |
| SSH | `ssh` | 远程批量执行/上传 |
| Python | `python` | 代码执行 |

加载器 `TOOL_MODULES` 实际启用 19 个工具模块键（上表 17 个功能类目，其中浏览器类含 `agent_browser` / `browser_use`、Kubernetes 类含 `kubernetes` / `kubernetes_data_collection` 各为 2 个键）；CMDB 类目在工具目录中存在但当前未在加载器中启用（已在 `TOOL_MODULES` 中注释临时关闭）。

此外，`monitor`（监控查询）作为**内置工具（builtin）**，通过 `build_builtin_monitor_tool` 构建，不经 TOOL_MODULES 注册，而是在智能体技能配置中作为内置选项提供；其 CONSTRUCTOR_PARAMS 需配置 username/password/domain/team_id。monitor 内置工具包含 6 个子工具函数：`monitor_list_objects`、`monitor_list_object_instances`、`monitor_list_object_metrics`、`monitor_list_instance_metrics`、`monitor_query_metric_data`、`monitor_list_active_alerts`。

> 证据来源：server/apps/opspilot/metis/llm/tools/tools_loader.py:31-52（TOOL_MODULES，19 键）、server/apps/opspilot/metis/llm/tools/monitor/__init__.py（monitor 内置工具及 CONSTRUCTOR_PARAMS）、server/apps/opspilot/services/builtin_tools.py（build_builtin_monitor_tool、build_builtin_attachment_file_tool）

### 5.6 智能体技能类型（SkillTypeChoices）与机器人类型（BotTypeChoice）

| 类别 | 枚举值 | 数量 |
|---|---|---|
| 技能类型 | 基础工具（Basic Tool）、知识工具（Knowledge Tool）、Plan-Execute、Lats | 4 |
| 机器人类型 | Pilot、LobeChat、ChatFlow | 3 |

### 5.7 ChatFlow 节点类型（前端 chatflow 节点库）

| 节点分类 | 节点类型 |
|---|---|
| 触发器（Triggers） | celery（定时）、restful、openai、agui |
| 应用（Applications） | embedded_chat、web_chat、mobile、enterprise_wechat、dingtalk、wechat_official |
| 智能体（Agents） | agents |
| 逻辑（Logic） | condition（条件分支）、intent_classification（意图分类） |
| 记忆（Memory） | memory_read、memory_write |
| 动作（Actions） | http、notification |

共 6 个分类、17 种节点类型（`constants/chatflow.ts`、`components/studio/chatflowSettings.tsx`）。工作流执行类型（WorkFlowExecuteType）后端枚举 11 种：openai、restful、celery、enterprise_wechat、wechat_official、dingtalk、embedded_chat、web_chat、mobile、agui、**nats**（告警中心 NATS 触发）。

> 证据来源：server/apps/opspilot/enum.py:67-68（WorkFlowExecuteType.NATS）

### 5.8 对话渠道类型（ChannelChoices）

| 渠道 | 取值 |
|---|---|
| 企业微信 | `enterprise_wechat` |
| 企业微信机器人 | `enterprise_wechat_bot` |
| 微信公众号 | `wechat_official_account` |
| 钉钉 | `ding_talk` |
| Web | `web` |
| GitLab | `gitlab` |

共 6 种对话渠道。

> 说明：上述枚举均直接来自源代码常量、模型字段或前端节点库注册，不含演进展望项。工具类目以 ToolsLoader 实际注册为准（`TOOL_MODULES` 启用 19 个模块键、17 个功能类目，含 `attachment_file`），目录中存在但未启用的 CMDB 类不计入；monitor 以内置工具形式提供，不经 TOOL_MODULES 注册；ChatFlow 节点 17 种以前端节点库为准，后端 WorkFlowExecuteType（11 种，含 `nats`）为执行入口/渠道层枚举，二者口径不同。


## 六、枚举与对象取值明细附录

> 本附录列出 OpsPilot 模块的关键枚举与对象取值，取自源码常量定义。共 16 类（较上一版本新增：工作流执行类型 NATS 条目、知识任务状态、记忆存储引擎类型、工具附件文件类目、工作流执行记录标识字段）。

### 内置LLM模型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| OpenAI | `chat-gpt` | OpenAI ChatGPT 模型 |
| 智谱AI | `zhipu` | 智谱 AI 模型 |
| Hugging Face | `hugging_face` | Hugging Face 模型 |
| DeepSeek | `deep-seek` | DeepSeek 模型 |
| 百川 | `Baichuan` | 百川大语言模型 |

### 协议类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| OpenAI 兼容 | `openai` | OpenAI 兼容协议 |
| Anthropic 兼容 | `anthropic` | Anthropic 兼容协议 |

### 对话渠道

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 企业微信 | `enterprise_wechat` | 企业微信渠道 |
| 企业微信机器人 | `enterprise_wechat_bot` | 企业微信机器人渠道 |
| 微信公众号 | `wechat_official_account` | 微信公众号渠道 |
| 钉钉 | `ding_talk` | 钉钉对话渠道 |
| Web | `web` | Web 网页渠道 |
| GitLab | `gitlab` | GitLab 渠道 |

### 工作流任务状态

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 运行中 | `running` | 工作流任务运行中 |
| 请求中断 | `interrupt_requested` | 已请求中断工作流任务 |
| 已中断 | `interrupted` | 工作流任务已中断 |
| 成功 | `success` | 工作流任务成功 |
| 失败 | `fail` | 工作流任务失败 |

### 工作流执行记录标识字段

`WorkFlowTaskResult` 模型含 `is_test` 布尔字段（`bot_mgmt.py:292`），随执行记录持久化并在查询接口中返回，支持过滤（`workflow_task_result_view.py:23`）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `is_test` | Boolean，默认 False | True 表示该执行由配置页测试发起；False 表示真实对话或定时触发 |

### 工作流执行类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| OpenAI | `openai` | 通过 OpenAI 接口执行工作流 |
| RESTful | `restful` | 通过 RESTful 接口执行工作流 |
| Celery | `celery` | 通过 Celery 异步执行工作流 |
| 企业微信 | `enterprise_wechat` | 企业微信触发执行工作流 |
| 微信公众号 | `wechat_official` | 微信公众号触发执行工作流 |
| 钉钉 | `dingtalk` | 钉钉触发执行工作流 |
| 嵌入式对话 | `embedded_chat` | 嵌入式对话触发执行工作流 |
| Web 对话 | `web_chat` | Web 对话触发执行工作流 |
| 移动端 | `mobile` | 移动端触发执行工作流 |
| AG-UI | `agui` | AG-UI 触发执行工作流 |
| NATS | `nats` | NATS 消息触发执行工作流（告警中心集成） |

### 工具类目（TOOL_MODULES 键）

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| attachment_file | `attachment_file` | 工作流附件文件工具（生成 md/pdf/docx 并返回签名下载链接） |
| agent_browser | `agent_browser` | 智能体浏览器工具 |
| browser_use | `browser_use` | 浏览器操作工具 |
| current_time | `current_time` | 当前时间工具 |
| duckduckgo | `duckduckgo` | DuckDuckGo 搜索工具 |
| elasticsearch | `elasticsearch` | Elasticsearch 查询工具 |
| fetch | `fetch` | 网页抓取工具 |
| github | `github` | GitHub 工具 |
| jenkins | `jenkins` | Jenkins 工具 |
| kubernetes | `kubernetes` | Kubernetes 工具 |
| kubernetes_data_collection | `kubernetes_data_collection` | Kubernetes 数据采集工具 |
| mssql | `mssql` | SQL Server 数据库工具 |
| mysql | `mysql` | MySQL 数据库工具 |
| oracle | `oracle` | Oracle 数据库工具 |
| postgres | `postgres` | PostgreSQL 数据库工具 |
| python | `python` | Python 执行工具 |
| redis | `redis` | Redis 工具 |
| shell | `shell` | Shell 命令工具 |
| ssh | `ssh` | SSH 远程工具 |
| cmdb | `cmdb` | CMDB 工具（源码中已注释关闭，未启用） |

### 技能类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| Basic Tool | `1` | 基础工具技能 |
| Knowledge Tool | `2` | 知识库工具技能 |
| Plan Execute | `3` | 计划-执行型技能 |
| Lats | `4` | LATS 推理型技能 |

### 文档状态

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 训练中 | `0` | 知识文档训练中 |
| 就绪 | `1` | 知识文档就绪可用 |
| 错误 | `2` | 知识文档处理出错 |
| 等待中 | `3` | 知识文档等待处理 |
| 分块中 | `4` | 知识文档分块处理中 |

### 机器人类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| Pilot | `1` | Pilot 类型机器人 |
| LobeChat | `2` | LobeChat 类型机器人 |
| ChatFlow | `3` | ChatFlow 类型机器人 |

### 模型供应商类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| OpenAI | `openai` | OpenAI 供应商 |
| Azure | `azure` | 微软 Azure 供应商 |
| 阿里云 | `aliyun` | 阿里云供应商 |
| 智谱 | `zhipu` | 智谱 AI 供应商 |
| 百度 | `baidu` | 百度（千帆）供应商 |
| Anthropic | `anthropic` | Anthropic 供应商 |
| DeepSeek | `deepseek` | DeepSeek 供应商 |
| 其它 | `other` | 其它自定义供应商 |

### 模型类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| LLM Model | `llm_model` | 大语言模型（LLM） |
| Embed Model | `embed_provider` | 文本向量化（嵌入）模型 |
| Rerank Model | `rerank_provider` | 检索结果重排序模型 |
| OCR Model | `ocr_provider` | OCR 光学字符识别模型 |

### 知识文件类型

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| md | `md` | 支持的知识文件格式：.md |
| docx | `docx` | 支持的知识文件格式：.docx |
| xlsx | `xlsx` | 支持的知识文件格式：.xlsx |
| csv | `csv` | 支持的知识文件格式：.csv |
| pptx | `pptx` | 支持的知识文件格式：.pptx |
| pdf | `pdf` | 支持的知识文件格式：.pdf |
| txt | `txt` | 支持的知识文件格式：.txt |
| png | `png` | 支持的知识文件格式：.png |
| jpg | `jpg` | 支持的知识文件格式：.jpg |
| jpeg | `jpeg` | 支持的知识文件格式：.jpeg |

### 知识来源

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 文件 | `file` | 来自上传文件的知识 |
| 网页 | `web_page` | 来自网页抓取的知识 |
| 手动 | `manual` | 手动录入的知识 |

### 知识任务状态（KnowledgeTaskStatus）

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 运行中 | `running` | 知识处理任务运行中 |
| 成功 | `success` | 知识处理任务成功 |
| 失败 | `failed` | 知识处理任务失败 |

> 证据来源：server/apps/opspilot/enum.py:80-87（KnowledgeTaskStatus）；用于 knowledge_mgmt 模型的 `task_status` 字段。

### 记忆存储引擎类型（MemorySpace.STORAGE_CHOICES）

| 枚举项 | 取值 | 中文含义 |
|---|---|---|
| 本地存储 | `local` | 使用 PostgreSQL 数据库存储记忆（开箱即用，默认） |
| Mem0 | `mem0` | 使用 Mem0 存储（需安装 mem0 SDK） |
| Zep | `zep` | 使用 Zep 存储（需安装 zep-cloud SDK） |
| 自定义 API | `custom` | 使用自定义 HTTP API 存储（需 httpx） |

> 证据来源：server/apps/opspilot/models/memory_mgmt.py（MemorySpace.STORAGE_CHOICES）、server/apps/opspilot/memory/engines/registry.py（check_sdk_availability）

### 工作流附件支持的文件类型（normalize_attachment_file_type）

| 枚举项 | 取值 | MIME 类型 |
|---|---|---|
| Markdown | `md` | `text/markdown` |
| PDF | `pdf` | `application/pdf` |
| Word 文档 | `docx` / `word` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

> 证据来源：server/apps/opspilot/services/workflow_attachment_service.py（ATTACHMENT_FILE_TYPE_CONFIG）；txt、xlsx、csv、html 等格式由前端传入后兜底为通用文件，当前服务端仅上述 3 类有显式生成逻辑。【待确认：txt/csv/html 是否在后续迭代中加入服务端转换】
