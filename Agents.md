#﻿# Agent 开发规范（面向 AI）

## 核心概念速览

| 概念 | 一句话 | 位置 |
|------|--------|------|
| **记忆 (Memory)** | Markdown 文件承载的独立知识单元，含 YAML 元数据，人类和 LLM 均可直读 | `memory-root/notes/` |
| **Agent 循环** | 用户消息 → 记忆检索 → 组装提示 → AI 流式响应 → 工具调用 → 候选记忆写入待审计队列 | `src/features/chat/handler.ts` |
| **待审计队列** | 候选记忆写回前暂存的 SQLite 队列，按 `memoryId` 串行消费 | `src/server/services/memory-service.ts` |
| **LLMWiki** | Markdown + YAML frontmatter 格式，每条记忆自包含 | `src/lib/storage/markdown-formatter.ts` |
| **向量召回** | SQLite 保存向量真源 + USearch HNSW ANN；版本失配自动重建，JS 精确扫描仅作降级 | `src/lib/vector/retriever.ts` / `src/lib/vector/backend.ts` |
| **图谱关系** | 文件内 `[[wikilink]]` 构建的内存索引，替代图数据库边表 | `src/lib/graph/wiki-graph.ts` |
| **降级模式** | LLM API 不可用时切换为本地检索模板回复，Embedding 不可用时降级为关键词匹配 | `src/lib/ai/model-adapter.ts` |
| **工具系统** | Zod schema 校验 + 异步执行器，结果分层为 `content`（给模型）和 `data`（给 UI） | `src/lib/ai/tool-caller.ts` |
| **会话系统** | 前端内存维护当前状态，服务端 JSONL 作为持久化真源；系统消息不保存（恢复时重建） | `src/components/chat/useChatSession.ts` / `src/server/services/chat-session-service.ts` |
| **提供商目录** | `providers.json` 声明式注册 AI 提供商和模型，零代码接入新端点 | `src/config/providers.json` |
| **存储路径热重载** | 数据库路径固定（env），笔记路径存 db 配置表可在设置面板修改并自动迁移 | `src/lib/storage/path-resolver.ts` |
| **工具会话采集** | 监听 Cursor/Codex/Claude Code 工作目录，解析会话文件自动入队 | `src/server/watchers/tool-dir-watcher.ts` |
| **用户画像演化** | 对话后自动分析画像，相似度 < 0.85 才回写，变更历史记 jsonl 供前端可视化 | `src/server/services/profile-updater.ts` |
| **浏览器采集** | 定时 copy Chrome/Edge 的 History SQLite，按域名分组总结成笔记 | `src/lib/browser/history-collector.ts` |

## 1. 文档目标
本文件用于描述系统架构、数据流、处理阶段、技术边界与推荐技术栈，供 AI 在编写、修改和审查代码时作为统一上下文。

## 2. 设计原则

以下 7 条是可逐条验证的架构约束，新代码应逐条对照审核：

1. **核心零 UI 依赖**：`src/features/` 和 `src/lib/` 不导入 React 组件、Next.js 路由细节或 CSS 模块。核心通过 `AiEvent` 流输出，UI 消费事件。

2. **事件是唯一契约**：快轨层 Agent 循环只通过 `ReadableStream<AiEvent>` 输出，前端只通过消费同一事件流来更新 UI。不引入框架特定的回调、全局 emitter 或状态管理库的跨层耦合。

3. **工具 = Zod schema + 异步执行器**：`tool-schemas.ts` 定义校验，`tool-registry.ts` 注册执行器，`tool-caller.ts` 调度。无全局变量、无装饰器、无代码生成。工具结果分层为 `content`（给模型读的自然语言）和 `data`（给 UI/日志的结构化元数据）。

4. **存储不可变追加**：记忆和会话记录采用追加式日志（Markdown 文件追加 + JSONL 行追加），不修改已写入的数据。冲突通过新条目标记解决，不覆盖旧数据。待审计队列 `pending_events` 按 `memoryId` 串行消费。

5. **系统配置重建而非快照**：持久化会话时不保存 system 角色消息。恢复会话时从当前 `PromptCache` 和工具注册表重建系统提示，确保升级配置后旧会话也受益。

6. **模型边界显式化**：任何 AI 调用都经过 `ModelAdapter` 层。LLM/Embedding API 不可用时降级到本地检索模板回复，降级状态必须在前端可见。提供商通过 `providers.json` 声明式注册，零代码接入新端点。

7. **文档跟随实现，差异有记录**：AGENTS.md 的偏差表（11.1）持续维护。任何与规范的偏差都必须记录在表中，附上优先级和预期修复版本。每个 Phase 结束必须更新偏差表和路线图。

## 3. 总体技术栈
- 语言：TypeScript
- 前端框架：React / Next.js
- AI 编排：Vercel AI SDK
- 样式：Tailwind CSS
- 状态管理：React Context
- **主存储：LLMWiki（Markdown + YAML frontmatter）**——每条记忆自包含，人类和 LLM 均可直读
- 加速层：SQLite（`better-sqlite3`）仅做向量索引和全文搜索缓存，主数据源是 Markdown 文件
- 向量存储：SQLite 承载 `vector_records` 真源，`VectorSearchBackend` 抽象搜索实现；默认 USearch HNSW ANN，索引以 `.usearch` sidecar 持久化且可从 SQLite 自动重建，`VECTOR_BACKEND=js` 时使用精确余弦 fallback
- 关系管理：`[[wikilink]]` 内嵌在 Markdown 正文中，替代传统图数据库边表
- 图谱查询：`src/lib/graph/wiki-graph.ts` 从文件扫描 wikilink 构建内存索引
- 队列存储：SQLite 表 `pending_events`，承载 `PendingEvent` 待审计队列，支持按 `memoryId` 串行消费
- 记忆索引：Markdown 索引地图、JSON 元数据、标签索引
- 向量检索：`src/lib/vector/*`，负责 embedding 生成、向量更新、召回和重排
- 图谱关系：`src/lib/graph/wiki-graph.ts`，基于文件 [[wikilink]] 扫描的关系查询（替代 SQLite graph_edges 表）
- 文件格式：`src/lib/storage/markdown-formatter.ts` + `markdown-parser.ts`，负责 YAML frontmatter 序列化/反序列化
- 模型适配：`src/lib/ai/*`，通过中转站适配层调用 LLM 和 embedding API，统一请求格式、响应格式和错误处理
- API 配置管理：`src/config/api.config.ts`，管理中转站 URL、API Key（从环境变量读取，不硬编码）、模型名称和降级开关
- SQLite 驱动：`better-sqlite3`（同步 API，适合本地单机场景）
- 文件监听：`chokidar`，监控 `memory-root/` 目录下 Markdown 文件变化，自动触发记忆导入与更新
- 后台 API 监听：`/api/listen` 端点，接收来自 Trae IDE、浏览器 AI 会话等外部工具的对话数据，自动提炼为结构化笔记
- 后台任务：Route Handlers、Node.js 任务、站内调度器；Cron 仅作为可选部署形态
- 外部能力接入：MCP 和 skills 兼具双重角色——既是数据采集输入源（从 Notion、浏览器历史、邮件等外部数据源采集信息生成记忆），又是能力调用输出方（把记忆检索结果提供给其他工具和上下文）；浏览器侧采集接口作为补充输入源

## 4. 项目结构与链路

### 4.1 结构层定义
项目按职责分为四个处理面：
- 入口层：前端交互、提示词编辑、记忆模式控制。
- 快轨层：低延迟响应与即时流式输出。
- 后台加工层：JSON 清洗、分类、索引构建、记忆提取。
- 审计持久化层：差异比对、冲突处理、写回与版本管理。

### 4.2 目录树与链路
```txt
src/
├─ app/
│  ├─ page.tsx                  # 入口页，对应前端 UI
│  ├─ layout.tsx                # 全局布局
│  └─ api/
│     ├─ chat/route.ts          # 快轨对话入口
│     ├─ chat/stream/route.ts   # 流式对话入口
│     ├─ memory/route.ts        # 记忆读写入口
│     ├─ memory/[id]/route.ts   # 单条记忆操作
│     ├─ memory/search/route.ts # 记忆搜索
│     ├─ prompt/route.ts        # 提示词更新入口
│     ├─ prompt/[id]/route.ts   # 单条提示词操作
│     ├─ ingest/route.ts        # 后台数据接入入口
│     ├─ listen/route.ts        # 外部工具监听入口（Trae/浏览器 AI 会话）
│     ├─ audit/route.ts         # 审计入口
│     ├─ audit/conflicts/route.ts # 冲突管理
│     └─ config/                # 配置管理（AI/MCP/Skills）
├─ components/
│  ├─ chat/                     # 人机交互组件
│  ├─ prompt/                   # 提示词编辑组件
│  ├─ memory/                   # 记忆模式相关组件
│  ├─ profile/                  # 用户画像面板（画像展示 + 演化时间线）
│  ├─ settings/                 # 设置页面组件（AI 配置、存储路径、工具采集、MCP、Skills）
│  ├─ common/                   # 公共组件
│  ├─ ui/                       # Magic UI / Aceternity UI 炫酷组件
│  └─ audit/                    # 审计相关组件
├─ features/
│  ├─ chat/                     # 快轨逻辑
│  ├─ prompt/                   # 提示词读写与回写
│  ├─ memory/                   # 记忆处理、分类、评分
│  ├─ ingest/                   # 后台输入接入与解析
│  │  ├─ parser.ts
│  │  ├─ normalizer.ts
│  │  ├─ adapter.ts
│  │  └─ conversation-processor.ts  # AI 对话专用处理器
│  └─ audit/                    # 审计、diff、冲突处理
├─ lib/
│  ├─ ai/                       # Vercel AI SDK 与模型适配
│  ├─ mcp/                      # MCP 接入
│  ├─ skills/                   # skills 接入
│  ├─ memory/                   # 记忆抽象
│  ├─ tools/                    # 工具会话解析器（Codex/Claude Code/Cursor/Markdown/Text）
│  ├─ browser/                  # 浏览器采集（Chrome/Edge 历史与书签）
│  ├─ vector/                   # 向量索引与检索
│  ├─ graph/
│  │  ├─ wiki-graph.ts          # 文件级 wikilink 图谱（主）
│  │  ├─ manager.ts             # SQLite 图谱（已废弃，保留兼容）
│  │  ├─ query.ts               # 图查询工具
│  │  └─ builder.ts             # 图构建工具
│  ├─ storage/                  # 本地存储与文件写回
│  │  ├─ markdown-formatter.ts  # LLMWiki 序列化
│  │  ├─ markdown-parser.ts     # LLMWiki 反序列化
│  │  ├─ path-resolver.ts
│  │  ├─ database.ts
│  │  ├─ file-manager.ts
│  │  ├─ lock.ts
│  │  └─ index-writer.ts
│  ├─ prompt/                   # 提示词模板与处理
│  └─ utils/                    # 通用工具
├─ server/
│  ├─ services/                 # 服务编排
│  ├─ workers/                  # 异步任务
│  ├─ pipelines/                # JSON 处理流水线
│  ├─ watchers/                 # 文件系统监听器（chokidar）
│  ├─ listener/                 # 后台监听服务（API 端口监听）
│  └─ schedulers/               # 定时任务
├─ types/
├─ config/
├─ styles/
public/
│  └─ bridge/capture.js         # 浏览器桥接脚本（捕获 AI 聊天页面）
docs/
instrumentation.ts              # Next.js 插桩入口，启动后台监听器
next.config.js                  # Next.js 配置，启用 instrumentationHook
```

入口层 -> `src/app/page.tsx` -> `src/components/chat/*` / `src/components/prompt/*` -> `src/features/chat/*` / `src/features/prompt/*`

快轨层 -> `src/features/chat/*` -> `src/lib/ai/*` -> `src/app/api/chat/route.ts` -> 流式输出

后台加工层 -> `src/app/api/ingest/route.ts` -> `src/features/ingest/*` -> `src/server/pipelines/*` -> `src/features/memory/*` -> `src/lib/vector/*` / `src/lib/graph/*`

审计持久化层 -> `src/app/api/audit/route.ts` -> `src/features/audit/*` -> `src/server/schedulers/*` -> `src/server/workers/*` -> `src/lib/storage/*`

持久化层属于审计持久化层的落盘子链路：`src/lib/storage/*` -> 本地文件 / 索引 / 标签 -> `src/features/prompt/*` -> `src/components/prompt/*` -> 前端状态同步

文件监听链路 -> `instrumentation.ts` -> `src/server/listener/listener-service.ts` -> `src/server/watchers/file-watcher.ts` -> `src/features/ingest/*` -> `src/server/services/memory-service.ts` -> 记忆写入 + 向量生成

外部工具监听链路 -> 外部工具 POST -> `/api/listen` -> `src/features/ingest/conversation-processor.ts` -> 对话格式化 + 话题提取 -> `MemoryService.stageCreateMemory()` -> 待审计队列 -> `Orchestrator` 以同一 memoryId 写入 SQLite 与 Markdown -> 返回知识卡片 + memoryId

### 4.3 术语定义
- 中转站适配层：用于封装模型供应商差异的本地适配模块，统一请求格式、响应格式和错误处理。
- 监听窗口：系统可接收外部输入的来源窗口，包含三种渠道：
  - **API 监听**：`/api/listen` 端点，Trae IDE、浏览器 AI 页面等外部工具通过 HTTP POST 发送结构化对话数据
  - **文件监听**：`memory-root/` 目录，自动检测 Markdown 文件新增/修改并导入
  - **前端交互**：Web UI 的聊天面板、记忆导入、设置页面
- 短时记忆：当前主题下的高频摘要与要点，存放在 `notes/*/Agent.md`。
- 长时记忆：可追溯的具体事实与事件，存放在 `notes/*/note-*.md`。
- 索引地图：记录目录、标签、关系入口和引用路径的 `index-map.md`。
- 关系映射层：描述记忆之间关系的本地图结构，使用文件内 `[[wikilink]]` 替代数据库边表；`wiki-graph.ts` 从文件扫描构建索引
- 向量索引适配层：负责 embedding 生成、更新、ANN 检索和重排的本地模块；SQLite 保存 `vector_records` 真源，USearch HNSW 图作为可重建 sidecar，JS 精确余弦仅作降级。
- 待审计队列：后台加工层产出的候选记忆事件在写入最终文件前暂存的持久化队列，存储于 SQLite 表 `pending_events`，按 `memoryId` 串行消费。
- 冲突分级：审计持久化层对候选记忆与现有记忆进行差异比对后的分级判断，分为自动可合并、需人工裁决和不可合并三级。
- API 降级：当模型 API（LLM 或 embedding）不可用时，系统自动切换到有限功能的备用模式，保证本地数据操作不受影响。

### 4.4 分层关系
- 入口层负责接入用户输入和控制模式。
- 快轨层负责即时响应，不直接写入持久化文件。
- 后台加工层负责结构化处理、索引构建和候选记忆生成。
- 审计持久化层负责比对、冲突解决、版本化写回和落盘。
- 持久化层是审计持久化层内部的存储实现，不是独立的第五层。

### 4.5 分层职责
**入口层**
- 收集用户输入
- 控制记忆模式
- 编辑和同步提示词

**快轨层**
- 处理即时对话
- 维持低延迟流式回复
- 只消费标准化事件的即时字段，不直接修改最终落盘文件

#### 4.5.1 快轨层 — Agent 循环引擎

Agent 循环是快轨层的核心引擎，它将用户消息、记忆检索和 AI 流式响应编织为统一的进度事件流。

**职责**

1. 接收用户消息、会话 ID、记忆模式（`ChatMode`）和可选关联记忆 ID 列表。
2. 执行意图分类（`AgentDispatcher.dispatch()`），将请求路由到记忆创建/查询/删除/更新等分支，或进入通用对话管线。
3. 通过 `VectorRetriever.search()` 检索语义相关记忆，通过 `WikiGraph.getNeighbors()` 扩展图谱关联上下文。
4. 组装系统提示：注入记忆摘要、用户画像（`profile.md`）、工具清单和对话历史。
5. 通过 `ModelAdapter` 请求 AI 提供商流式返回响应，统一适配 OpenAI / Anthropic 等供应商差异。
6. 在文本增量（delta text）和工具调用到达时，发出标准化的 `AiEvent` 事件流。
7. 执行工具调用：记忆读写、向量检索、图谱查询等，追加工具结果到上下文。
8. 持续迭代直到助手不再产生工具调用，或达到最大轮次限制。
9. 将最终助手消息和候选记忆（`PendingEvent`）提交到后台加工层的待审计队列。

**非职责**

Agent 循环不知道 Next.js 路由细节、React 组件、会话文件落盘位置、MCP/Skills 配置或 `memory-root/` 目录结构。这些属于入口层、持久化层和配置管理模块。

**关键实现**

| 组件 | 路径 | 角色 |
|------|------|------|
| `AgentDispatcher` | `src/features/agent/dispatcher.ts` | 意图分类与路由派发 |
| `ChatHandler` | `src/features/chat/handler.ts` | 循环主控：检索 → 构建提示 → 流式调用 → 事件流 |
| `ModelAdapter` | `src/lib/ai/*` | 供应商适配层：流式输出、工具调用、降级处理 |
| `VectorRetriever` | `src/lib/vector/retriever.ts` | 向量语义召回 |
| `WikiGraph` | `src/lib/graph/wiki-graph.ts` | `[[wikilink]]` 图谱邻接扩展 |

**事件优先设计**

每个有意义的步骤都通过 `AiEvent` 观察 —— 文本增量、工具调用请求、工具结果、错误和完成信号。前端通过 `EventSource` / `fetch` streaming 消费同一事件流来更新 UI，确保 Agent 循环核心与渲染层解耦。

**后台加工层**
- 接收归一化后的事件对象
- 清洗、分类、打分
- 生成记忆 JSON、标签索引和向量索引候选
- 将处理结果封装为 `PendingEvent` 写入待审计队列（SQLite 表 `pending_events`），而不是直接覆盖最终文件
- `PendingEvent` 必须包含 `eventId`、`memoryId`、`sourceType`、候选 `MemoryRecord`（JSON 序列化）、变更字段列表 `changedFields`、生成时间戳、`status` 和 `retryCount`（完整字段见 5.6）

**审计持久化层**
- 从待审计队列按 `memoryId` 串行消费 `PendingEvent`
- 对候选记忆与现有记忆进行差异比对，按冲突分级策略处理（详见 4.10）
- 统一负责本地文件写回、SQLite 索引更新、版本管理和失败重试
- 写回完成后从队列中删除对应 `PendingEvent`，失败时保留并重试
- 处理快轨与后台加工之间的不一致合并

### 4.6 接口与实现约束
- UI 组件：React、Next.js、Tailwind CSS、shadcn/ui
- 状态管理：React Context，用于轻量共享状态；跨页面持久状态由本地存储或服务端缓存承载
- AI 调用：`src/lib/ai/*`，统一流式输出和工具调用接口
- 输入归一化：`src/server/pipelines/*`，将多源输入整理为标准事件对象
- JSON 校验：Zod，用于请求体、记忆结构和回写结果校验
- 校验顺序：先定义 `schema`，再定义 `zodSchema`，再定义 `parse` / `safeParse`，最后才允许进入业务处理函数
- 请求响应约束：所有 API route 的请求体 schema、响应体 schema 和错误码表统一登记在 `src/config/api-route-contracts.ts`；route handler 实现侧继续在入口执行 Zod 请求校验，避免受 Next.js route module 导出限制影响
- 批处理与调度：Node.js 任务与站内调度器；Cron 仅作为可选部署形态
- 前端搜索：关键词索引、笔记检索、结果排序、点击回写
- 本地推荐：按次数推荐算法、动态热度更新、个性化重排、曝光回写
- 本地笔记存储：`src/lib/storage/*`，负责读写 `notes/*`、`index-map.md`、`profile.md` 和 `archive/*`
- 记忆索引：Markdown 索引地图、标签索引、关系索引、语义检索层
- 向量索引：`src/lib/vector/*`，负责 embedding 生成、向量更新、语义相似度检索、重排、回写
- 关系存储：`src/lib/graph/*`，负责记忆关系边和关系查询
- 更新策略：短时记忆要点更新 `notes/*/Agent.md`，长时记忆更新 `notes/*/note-*.md`，索引地图更新 `index-map.md`，推荐权重更新 `profile.md`
- 落盘与版本：记忆正文用 Node.js 文件系统 API 写入 Markdown 文件；向量、图谱、队列和冲突记录用 SQLite 事务写入
- 向量存储：`src/lib/vector/*` 使用 SQLite + `better-sqlite3` 驱动，通过 `vector_records` 表保存真源；搜索经 `VectorSearchBackend` 抽象，默认 USearch HNSW ANN，JS 精确扫描仅作显式/故障 fallback
- 图谱存储：`src/lib/graph/wiki-graph.ts`（主路径）从文件扫描 `[[wikilink]]` 构建内存索引；`src/lib/graph/manager.ts`（已废弃，保留兼容）使用 SQLite 表 `graph_edges` 存储关系边
- 队列存储：`src/features/audit/queue.ts`（内存 Map 实现，进程重启丢失）和 `src/server/services/memory-service.ts`（SQLite `pending_events` 表）提供双版本队列；推荐使用 SQLite 版本以保证持久化
- 冲突记录：`src/features/audit/*` 使用 SQLite 表 `conflict_records` 存储需人工裁决的冲突，支持按 `status` 过滤
- 文件监听：`src/server/watchers/file-watcher.ts` 使用 `chokidar` 监控 `memory-root/` 目录，在 `.md` 文件新增/修改时自动走 ingest 管线导入/更新记忆（详见 4.6.1）

### 4.6.1 文件监听子系统
文件监听器在 Next.js 服务端启动时通过 `instrumentation.ts` 注册，使用 `chokidar` 库监控 `memory-root/` 目录下的 Markdown 文件变化。

**监听范围**：
- 监控路径：`memory-root/` 下所有 `.md` 文件
- 排除：`memory.db*`、`archive/**`、`index-map.md`、`profile.md`

**触发行为**：
- `add` 事件（新文件）：读取内容，经 `InputParser -> InputNormalizer -> IngestAdapter` 管线处理后，以 Markdown frontmatter 中的稳定 `id`（无 frontmatter 时按规范化文件路径生成稳定 ID）创建 `PendingEvent`
- `change` 事件（文件更新）：解析同一稳定 `id`；记忆已存在时调用 `stageUpdateMemory()`，尚未落库时按同一 ID 执行 upsert-create，不得生成新的记忆 ID
- 系统自身通过审计持久化层写出的 Markdown 由 `write-tracker` 标记，文件监听器跳过该次事件，避免写回循环

**启动方式**：
- `next.config.js` 启用 `experimental.instrumentationHook`
- `instrumentation.ts` 在 `NEXT_RUNTIME === "nodejs"` 时调用 `startFileWatcher()`
- 服务端启动时自动运行，无需手动触发

**注意事项**：
- 文件内容少于 10 字符时跳过处理
- 使用 `awaitWriteFinish` 选项（500ms 稳定窗口）避免半写入文件触发
- 导入失败时输出日志但不阻塞后续监听

### 4.6.2 后台 API 监听子系统
后台 API 监听器是系统的核心对外接口，允许 Trae IDE、浏览器 AI 会话等外部工具将对话数据通过 HTTP POST 发送到 `/api/listen`，自动完成提炼和归档。

**API 端点**：
- `POST /api/listen` — 接收对话数据，自动提取话题、创建目录、生成记忆
- `GET  /api/listen` — 查询监听器状态和统计信息

**请求格式** (POST)：
```json
{
  "source": "trae-ide",
  "sourceType": "listen",
  "messages": [
    { "role": "user", "content": "帮我实现一个排序算法" },
    { "role": "assistant", "content": "好的，这是快速排序的实现..." }
  ],
  "tags": ["ai-coding", "algorithm"],
  "topic": "ai-coding",
  "metadata": {
    "platform": "Trae IDE",
    "model": "claude-sonnet-4-20250514",
    "url": "optional-source-url"
  }
}
```

**处理流程**：
1. Zod 校验请求体 → 消息列表、来源必填
2. `ConversationProcessor.formatConversation()` → 格式化对话内容，自动提取话题分类
3. `ConversationProcessor.generateKnowledgeCard()` → 生成摘要、标签和话题元数据
4. `MemoryService.stageCreateMemory()` → 只生成一条带稳定 `memoryId` 的 `PendingEvent`，不提前写 Markdown
5. `Orchestrator` 审计通过后沿用该 `memoryId` 写入 SQLite、向量索引和 `notes/{topic}/{memoryId}.md`；Markdown frontmatter 必须包含同一 `id`
6. 返回 `{ success, memoryId, topic, filePath, knowledgeCard }`，其中 `filePath` 是审计通过后的规范目标路径

**自动话题分类**：
`MemoryExtractor.extractTopic()` 基于关键词匹配自动分类：
| 关键词 | 话题目录 |
|--------|---------|
| 代码/编程/react/typescript/api/bug | `ai-coding` |
| 日记/今天/心情/生活 | `daily-notes` |
| 项目/需求/架构/规划 | `project-planning` |
| 学习/教程/笔记/知识 | `learning` |
| 会议/讨论/决策 | `meetings` |
| 阅读/书籍/论文 | `reading` |
| 无匹配 | `uncategorized` |

**浏览器桥接**：
`public/bridge/capture.js` — 可作为浏览器书签或 Tampermonkey 用户脚本使用，自动捕获 ChatGPT、Claude、Gemini 等 AI 平台当前页面的对话内容，弹窗确认后 POST 到 `/api/listen`。

**集成方式**：
- **Trae IDE**：在 AI 对话完成后，调用 `POST /api/listen` 发送对话数据
- **浏览器**：安装 `capture.js` 书签，点击即可捕获当前 AI 页面
- **任意工具**：只需发送符合格式的 HTTP POST 请求即可接入

### 4.7 记忆目录结构
记忆系统使用本地文件夹承载，建议结构如下：
```txt
memory-root/
├─ index-map.md              # 索引地图，记录所有记忆文件夹、标签和关系入口
├─ profile.md                # 个性标签 + 个性提示词
├─ memory.db                 # SQLite 数据库：向量索引、关系图谱、待审计队列、冲突记录
├─ notes/                    # 具体记忆内容文件夹集合
│  ├─ topic-a/
│  │  ├─ Agent.md            # 该主题的短时记忆要点
│  │  ├─ note-001.md
│  │  └─ note-002.md
│  ├─ topic-b/
│  │  ├─ Agent.md
│  │  └─ note-003.md
│  └─ topic-c/
│     ├─ Agent.md
│     └─ note-004.md
└─ archive/                   # 历史版本与归档内容
   └─ failures/              # 失败上下文归档，文件名含 memoryId、阶段标识和时间戳
```

### 4.8 记忆链路
- `MemoryRecord` 是主数据对象；一条记忆在文件层对应一份 `notes/*/note-*.md`，其 JSON 形态作为写回前后的规范中间表示。
- `index-map.md` 由审计持久化层在目录结构变化、标签变化或关系变化后更新，用于记录目录总索引、父子关系、标签入口和引用路径。
- `profile.md` 由审计持久化层在个性标签、偏好参数或检索偏置变化后更新。
- `notes/*/Agent.md` 由审计持久化层在该目录下新增、修改或删除 `note-*.md` 后同步更新，保存该目录的短时记忆要点。
- `notes/*/note-*.md` 由写回流程生成或覆盖，保存实际记忆内容、来源信息、创建时间和更新时间。
- `archive/*` 由审计持久化层在版本快照、冲突回滚或人工保留历史时写入，历史快照必须带时间戳。
- 读取顺序固定为 `index-map.md` -> `profile.md` -> `notes/*/Agent.md` -> `notes/*/note-*.md` -> `archive/*`。
- 写回顺序固定为先写 `notes/*/note-*.md`，再同步对应 `notes/*/Agent.md`，必要时更新 `index-map.md` 和 `profile.md`，最后写入 `archive/*` 快照。
- 进入审计持久化层前必须先进入待审计队列；同一 `memoryId` 的事件按顺序串行处理，避免并发覆盖。
- 待审计队列存储于 `memory-root/memory.db` 的 `pending_events` 表，每条记录包含 `eventId`、`memoryId`、`sourceType`、`candidate`（候选 `MemoryRecord` 的 JSON 序列化）、`changedFields`（变更字段列表）、`createdAt`、`status`（`pending` | `processing` | `done` | `failed`）和 `retryCount`（完整字段见 5.6）。
- 消费顺序：按 `memoryId` 分组，组内按 `createdAt` 升序串行消费；不同 `memoryId` 可并行处理。
- 写回成功后 `status` 置为 `done` 并保留记录 24 小时用于审计追溯，之后自动清理；失败时 `status` 置为 `failed` 并触发重试流程。
- 快轨层在后台加工未完成时，允许展示未经审计的候选结果作为即时反馈，但必须标注为"未审计"状态，避免与最终落盘记忆混淆。
- 快轨只负责产生候选结果和即时反馈，后台加工负责结构化补全，最终文件只在审计持久化层写入。
- 搜索回写由前端搜索命中事件触发，只更新点击次数、最近访问时间和相关标签。
- 推荐回写由推荐曝光事件触发，只更新曝光次数、热度和时间衰减权重。
- 向量回写由记忆新增或内容变更事件触发，先生成 `VectorRecord`，再同步向量索引。
- 图谱写回由记忆关系变更事件触发，关系边以 `GraphEdge` 为准，顶点属性由 `MemoryRecord` 承担。

### 4.9 记忆检索与推荐
- 检索采用混合策略：关键词召回、向量召回、标签过滤三者并行，再进行合并与重排。
- 重排优先级依次考虑相关度、热度、最近更新、访问次数和个性标签偏置。
- 检索结果注入 prompt 时，只注入摘要、来源和引用路径，不直接展开全部原文。
- 前端必须支持关键词搜索索引到笔记。
- 本地推荐算法按访问次数、最近访问时间、时间衰减和个性标签动态更新。
- 推荐结果必须可解释，并能回写到本地索引地图、个性标签和相关时间戳。

### 4.10 数据类型约束
- `MemoryRecord` 是主记录；`VectorRecord` 是按 `memoryId` 关联的向量索引；`GraphEdge` 是关系边；`MemoryVersion` 是历史快照索引。
- `MemoryRecord.version` 表示结构版本，写回时必须随 schema 变更同步递增。
- 并发写回冲突：当两个 `PendingEvent` 同时修改同一 `memoryId` 的同一字段时，优先采用”基于 `updatedAt` 的最后写入优先”策略，并保留落选版本为 `MemoryVersion` 快照；这与候选-现有冲突不同，后者按冲突分级策略生成 `ConflictRecord` 等待人工裁决。
- 并发控制采用单 `memoryId` 串行队列或文件锁；写入前必须校验当前版本号，版本不一致时拒绝覆盖并转入重读-重算-重写流程。
- 版本回滚只在写回失败、冲突不可解、或人工审计明确要求恢复历史状态时触发，回滚目标必须来自 `archive/*` 快照。
- `VectorRecord.embedding` 的维度由 `dimensions` 字段决定，必须与 `model` 对应（见 5.2）。
- `GraphEdge.from` 与 `GraphEdge.to` 均引用 `MemoryRecord.id`。
- `heatScore` = `accessScore * 0.35 + recencyScore * 0.25 + exposureScore * 0.25 + tagAffinityScore * 0.15`，各子项归一化到 0 到 1：
  - `accessScore` = `ln(1 + accessCount) / ln(1 + maxAccessCount)`，其中 `maxAccessCount` 为当前所有记忆中的最大访问次数；无记忆时取 0。
  - `recencyScore` = `exp(-λ * Δt)`，其中 `Δt` 为当前时间与 `updatedAt` 的小时差，`λ = 0.01`（半衰期约 69 小时，约 3 天）。
  - `exposureScore` = `exposureCount / maxExposureCount`，其中 `maxExposureCount` 为当前所有记忆中的最大曝光次数；无曝光时取 0。
  - `tagAffinityScore` = 候选记忆标签与 `profile.md` 个性标签的 Jaccard 相似度（交集大小 / 并集大小）；无标签时取 0。
  - 各子项的默认参数（`λ`、归一化基准）定义在 `src/config/scoring.config.ts`，允许调整但变更后需重新计算全部 `heatScore`。
- 冲突分级策略：审计持久化层比对候选记忆与现有记忆时，按以下三级处理：
  - 自动可合并：候选记忆与现有记忆的变更字段不重叠，或重叠字段值相同——直接合并写入，生成 `MemoryVersion` 快照。
  - 需人工裁决：候选记忆与现有记忆的同一字段值不同——生成 `ConflictRecord`，保留双方版本，标记为 `pending` 状态，不自动覆盖；用户可在前端审计界面选择接受候选、保留现有或手动编辑。
  - 不可合并：schema 版本不兼容、数据损坏或格式校验失败——触发人工接管，不写入任何变更。
- `snapshotPath` 只保存归档文件路径，不保存业务正文。

### 4.11 模型与检索约束
- `Mini LLM` 用于快轨抽取、分类和摘要，优先选择低延迟模型；`Pro 模型` 用于审计、冲突处理和重写，优先选择高质量模型。
- 模型选择规则：当单次处理目标为低延迟流式回复时使用 `Mini LLM`，当任务涉及审计、冲突消解、写回重写或高风险内容处理时使用 `Pro 模型`。
- 模型 API 通过中转站适配层调用，配置定义在 `src/config/api.config.ts`，包含：中转站 `baseURL`、`apiKey`（从环境变量 `MODEL_API_KEY` 读取，不硬编码）、Mini LLM 和 Pro 模型的模型名称、embedding 模型名称和维度、请求超时时间（默认 30 秒）和最大重试次数（默认 2 次）。
- API 降级策略：当 LLM API 不可用时（网络错误、超时、认证失败），快轨层切换为基于本地检索的模板回复（不调用 LLM 生成），后台加工层暂停记忆提取任务并排队等待恢复；当 embedding API 不可用时，向量召回降级为关键词召回，新记忆仍写入文件但标记为"向量待生成"，恢复后批量补建。
- 降级状态必须在前端展示明确提示，告知用户当前处于降级模式及影响范围。
- 向量模型默认使用 `text-embedding-3-small`（维度 1536）；embedding 模型配置通过 `EmbeddingModelConfig`（见 5.5）管理，更换模型时必须同步更新维度约束和重建全部向量索引。
- 向量真源持久化于 `memory-root/memory.db` 的 `vector_records` 表；HNSW 加速图保存为同目录的 `memory.db.ann-{dimensions}.usearch`，通过 SQLite sourceVersion 校验一致性，失配或损坏时自动重建；查询经 `src/lib/vector/backend.ts` 后端接口执行
- 图谱关系通过文件内 `[[wikilink]]` 维护，`WikiGraph` 从文件扫描构建索引，无需独立图数据库
- 检索重排默认采用 `MMR`；当需要更高精度时可在实现层切换为交叉编码器重排，但必须保持结果可回写。
- 检索结果写回前必须保留召回来源、重排得分和最终入选理由，方便审计和调试。

### 4.12 目录约束
- `app` 只放路由和页面级入口。
- `components` 只放可复用 UI。
- `features` 只放业务功能。
- `lib` 只放基础能力和适配层。
- `server` 只放服务编排、任务和管线。
- `types` 只放共享类型定义。
- `config` 只放环境与常量。

### 4.13 结构原则
- UI、业务、存储三层分离。
- 快轨与后台加工分离。
- 模型调用与业务逻辑分离。
- 持久化写回和前端展示分离。
- 所有链路必须可从文件树直接定位到职责模块。

### 4.14 工具系统

工具让 AI 助手通过结构化调用来读写记忆、检索向量、查询图谱和操作文件。

Auto-Memeries-Doll 将工具定义与 UI 层分离：

- `src/lib/ai/*` 定义 Vercel AI SDK 层、与提供商无关的工具类型和执行器。
- `src/features/chat/handler.ts` 通过 `registerDefaultTools()` 注册内置工具并注入到系统提示。
- 前端（ChatInterface）仅消费工具调用事件，不感知工具实现细节。
- MCP 和 Skills 作为外部工具扩展点，通过 `src/lib/mcp/*` 和 `src/lib/skills/*` 接入。

**核心模型**

工具基于 Vercel AI SDK 的 `tool()` 辅助函数定义，每个工具包含：

- `description`：自然语言描述，写入系统提示供模型选择调用时机
- `inputSchema`：Zod schema，定义参数类型和约束
- `execute`：异步执行器，接收校验后的参数，返回 `{ content, data }` 结构

工具执行结果由 Agent 循环捕获，转换为 `ToolResultMessage` 追加到对话上下文。

**内置工具**

`ChatHandler.registerDefaultTools()` 注册五类本地工具：

| 工具 | 用途 | 实现位置 |
|------|------|----------|
| `create_memory` | 创建新记忆记录（含向量生成和图谱链接） | `src/features/agent/dispatcher.ts` → `MemoryService` |
| `search_memories` | 混合检索：关键词 + 向量 + 标签过滤 | `src/lib/vector/retriever.ts` |
| `update_memory` | 增量更新已有记忆 | `src/features/agent/dispatcher.ts` |
| `delete_memory` | 删除记忆（移入 archive） | `src/features/agent/dispatcher.ts` |
| `query_graph` | 图谱邻接查询，获取关联记忆 | `src/lib/graph/wiki-graph.ts` |

**工具调用流程**

1. Agent 循环将当前工具清单注入系统提示。
2. AI 模型在需要时返回 `tool_calls`，包含工具名和 JSON 参数。
3. Agent 循环用 Zod schema 校验参数，失败时返回错误信息给模型。
4. 执行工具，将 `{ content }` 作为 `tool` 角色消息追加到上下文。
5. 模型基于工具结果继续推理或返回最终回复。
6. 最大工具调用轮次受 `maxToolCalls` 限制，超限后强制返回文本回复。

**扩展工具**

- **MCP 工具**：通过 `src/lib/mcp/` 接入外部 MCP 服务器，动态注册远端工具。
- **Skills 工具**：通过 `src/lib/skills/` 加载自定义技能脚本，在 Agent 循环中作为特殊工具调用。
- 扩展工具和内置工具统一出现在工具清单中，模型不感知工具来源。

**非职责**

工具层不知道 Next.js 路由细节、`memory-root/` 目录结构、或前端 Tab 切换逻辑。这些属于入口层和持久化层。

### 4.15 会话系统

会话管理对话上下文和消息历史，在一次或多次人机交互中维持状态连续性。

**设计**

Auto-Memeries-Doll 的会话采用“前端内存状态 + 服务端追加式 JSONL”模型：

- `sessionId` 由前端生成，通过请求体传递给 API。
- 当前消息历史保存在 React state；每次对话请求仍携带完整 `messages` 数组。
- 服务端在请求开始和 AI 回答结束时向 `memory-root/sessions/{sessionId}.jsonl` 追加快照，JSONL 是恢复与列表的唯一真源。
- 系统消息不写入快照，恢复后由当前 `ChatHandler` 配置重建。
- `ChatMode`（`chat` | `memory` | `prompt`）随会话快照保存；localStorage 只保留界面偏好与一次性迁移标记。

**职责**

- 维护当前会话的消息列表（user / assistant / system 角色）。
- 在每次请求时将完整对话历史发送给 API。
- 支持流式响应中增量追加 assistant 消息。
- 通过 `/api/chat/sessions` 提供会话列表、恢复、追加快照、删除标记和旧 localStorage 迁移。
- 管理 `ChatMode` 切换：`chat` 模式仅对话，`memory` 模式启用记忆检索和写回工具。

**非职责**

会话系统不负责：
- 实时同步多个已打开标签页中的当前 UI 状态。
- 多会话分支和树状回放（不在当前路线图中）。
- 系统提示的版本管理（每次请求从当前配置重建）。

**边界**

- 会话状态管理属于 `src/components/chat/useChatSession.ts`。
- JSONL 的追加、读取和投影属于 `src/server/services/chat-session-service.ts`。
- HTTP 查询与迁移入口属于 `src/app/api/chat/sessions/`。
- 消息序列化和 API 传输属于快轨层（`ChatHandler.streamResponse()`）。
- 会话不干预记忆持久化；记忆写回始终通过审计持久化层。

**当前限制**

| 限制 | 影响 | 计划 |
|------|------|------|
| 快照重复完整消息 | 长会话的 JSONL 文件增长较快 | 后续增加压缩/归档，不修改既有行 |
| 多标签页无实时通知 | 一个 Tab 的列表变更不会立即推送到另一个 Tab | 切回页面时刷新，后续可增加轻量通知 |
| 无分支/回放 | 无法回溯历史决策路径 | 非当前优先级 |

## 5. 数据类型
系统维护以下七类本地数据。

### 5.1 记忆 JSON
```ts
export type MemoryRecord = {
  id: string;
  version: number;
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  /** 原标题（AI 可读） */
  title: string;
  /** 中文标题（人可读），为空时前端回退到 title */
  titleZh?: string;
  content: string;
  /** 原摘要（AI 可读） */
  summary: string;
  /** 中文摘要（人可读），为空时前端回退到 summary */
  summaryZh?: string;
  /** 原标签（AI 可读） */
  tags: string[];
  /** 中文标签（人可读），为空时前端回退到 tags */
  tagsZh?: string[];
  /** 所属话题目录，如 "ai-coding"、"daily-notes" */
  topic: string;
  /** 中文话题标签，为空时前端用 getTopicLabel(topic) */
  topicZh?: string;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  accessCount: number;
  heatScore: number;
  vectorId?: string;
  graphLinks: string[];
};
```
- `id` 由写回流程生成，全局唯一。
- `version` 表示结构版本，schema 变更时必须递增。
- `source` 记录原始来源标识，必须可回溯到输入事件。
- `sourceType` 表示来源通道，必须取自固定枚举。
- `title`、`content`、`summary` 由记忆提取流程生成；`title` 为短标题，`summary` 为压缩摘要。
- `titleZh`/`summaryZh`/`tagsZh`/`topicZh` 为可选的中文翻译字段，供前端人类可读展示；为空时前端回退到原字段。AI 检索和注入 prompt 时只用原字段，不读 zh 字段。
- `tags` 由分类流程生成，写回时允许增量合并。
- `topic` 表示所属话题目录，由分类流程生成（见 4.6.2 自动话题分类）。
- `createdAt` 记录记忆首次落盘时间；`updatedAt` 记录最后一次写回时间；`accessedAt` 记录最近一次访问时间。
- `accessCount` 在每次命中后递增。
- `heatScore` 按 4.10 定义的公式和子项计算，默认参数在 `src/config/scoring.config.ts` 中配置。
- `vectorId` 在向量索引生成后写入。
- `graphLinks` 由关系写回流程生成，保存相关记忆 ID 列表。

### 5.2 向量索引
```ts
export type VectorRecord = {
  memoryId: string;
  embedding: number[];
  model: string;
  dimensions: number;
  updatedAt: string;
};
```
- `memoryId` 必须引用 `MemoryRecord.id`。
- `embedding` 由向量生成流程写入，长度必须与 `dimensions` 一致。
- `model` 记录实际使用的 embedding 模型名称，默认为 `"text-embedding-3-small"`，通过 `EmbeddingModelConfig`（见 5.5）管理可选范围。
- `dimensions` 记录向量维度，必须与 `model` 对应（如 `text-embedding-3-small` 对应 1536）。
- `updatedAt` 记录最后一次重建向量的时间。

### 5.3 图谱信息
```ts
export type GraphEdge = {
  from: string;
  to: string;
  relation: string;
  weight: number;
  updatedAt: string;
};
```
- `from` 与 `to` 必须引用 `MemoryRecord.id`。
- `relation` 记录关系类型，由关系提取流程生成。
- `weight` 记录关系强度，由关系更新流程维护。
- `updatedAt` 记录最后一次关系变更时间。

### 5.4 历史记忆版本
```ts
export type MemoryVersion = {
  versionId: string;
  memoryId: string;
  snapshotPath: string;
  createdAt: string;
  reason: string;
};
```
- `versionId` 由审计持久化层生成。
- `memoryId` 必须引用 `MemoryRecord.id`。
- `snapshotPath` 只保存归档文件路径，不保存正文。
- `createdAt` 记录快照写入时间。
- `reason` 记录生成快照的原因。

### 5.5 Embedding 模型配置
```ts
export type EmbeddingModelConfig = {
  name: string;
  dimensions: number;
  maxTokens: number;
  batchSize: number;
};
```
- `name` 记录模型标识，如 `"text-embedding-3-small"`。
- `dimensions` 记录向量维度，必须与 `VectorRecord.dimensions` 一致。
- `maxTokens` 记录单次请求的最大 token 数，超限时分段处理。
- `batchSize` 记录单次 API 请求的最大条目数，默认为 100。
- 默认配置定义在 `src/config/api.config.ts`；更换模型时必须更新此配置、`VectorRecord.dimensions` 约束，并重建全部向量索引。

### 5.6 待审计事件
```ts
export type PendingEvent = {
  eventId: string;
  memoryId: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  candidate: string; // 候选 MemoryRecord 的 JSON 序列化
  changedFields: string[];
  createdAt: string;
  status: "pending" | "processing" | "done" | "failed";
  retryCount: number;
};
```
- `eventId` 由后台加工层生成，全局唯一。
- `memoryId` 引用目标 `MemoryRecord.id`；新建记忆时由后台加工层预分配。
- `sourceType` 继承自原始输入事件的来源通道。
- `candidate` 存储候选 `MemoryRecord` 的完整 JSON 序列化，审计层反序列化后进行差异比对。
- `changedFields` 记录相对于现有记忆的变更字段列表，用于冲突检测；新建记忆时为全部字段。
- `createdAt` 记录入队时间。
- `status` 记录当前处理状态；`done` 状态保留 24 小时后自动清理，`failed` 触发重试流程。
- `retryCount` 记录重试次数，达到上限后触发人工接管。

### 5.7 冲突记录
```ts
export type ConflictRecord = {
  conflictId: string;
  memoryId: string;
  eventId: string;
  field: string;
  existingValue: string; // 现有值的 JSON 序列化
  candidateValue: string; // 候选值的 JSON 序列化
  status: "pending" | "resolved_accept" | "resolved_keep" | "resolved_manual";
  resolution?: string; // 用户手动编辑后的值（JSON 序列化）
  createdAt: string;
  resolvedAt?: string;
};
```
- `conflictId` 由审计持久化层生成，全局唯一。
- `memoryId` 和 `eventId` 引用关联的 `MemoryRecord` 和 `PendingEvent`。
- `field` 记录冲突字段名。
- `existingValue` 和 `candidateValue` 分别保存双方版本的 JSON 序列化，不直接存储对象引用。
- `status` 记录裁决状态：`pending` 为待处理，`resolved_accept` 为接受候选值，`resolved_keep` 为保留现有值，`resolved_manual` 为用户手动编辑。
- `resolution` 在 `resolved_manual` 时保存用户编辑后的值，其他状态为空。
- `createdAt` 记录冲突发现时间；`resolvedAt` 记录裁决时间。
- 存储于 SQLite 表 `conflict_records`，支持按 `status` 和 `memoryId` 查询。

## 6. 处理策略
- 新增功能前先判断属于快轨、后台加工还是审计持久化。
- 快轨只做即时回复、轻量抽取和候选生成，不写最终文件。
- 后台加工负责归一化、去重、分类、索引构建和候选记忆生成，结果先进入待审计队列。
- 审计持久化负责冲突消解、版本管理、回滚和最终落盘。
- 处理 JSON 时先做拆分、去重、格式化，再进入索引与评分。
- 涉及写回时必须明确区分”增量更新”和”覆盖写入”。
- 冲突分级处理：审计层收到候选记忆后，按 4.10 定义的冲突分级策略进行差异比对和处理。
- API 降级处理：LLM API 不可用时，快轨层切换为本地检索模板回复，后台加工层暂停提取并排队；embedding API 不可用时，向量召回降级为关键词召回，新记忆标记”向量待生成”并在恢复后批量补建；降级状态须在前端提示。
- API 开发规范：所有 API 应先在 `src/config/api-route-contracts.ts` 登记请求体 Zod schema（无请求体可省略）、响应体 schema 和错误码枚举，再写 route handler；handler 内必须继续执行请求体 Zod 校验。
- 并发写入本地文件时必须通过单写入队列或文件锁保证顺序；同一 `memory-root/` 下的写入任务不得并行覆盖同一目标文件。
- 后台任务失败时必须保留失败上下文，并允许重试；重试前必须保留原始输入和上一次处理结果。
- 任何推测性内容都应在代码中显式标注，不能伪装成确定数据。
- schema 变更时必须同步更新 `MemoryRecord.version`、迁移脚本和读取方兼容逻辑。
- 涉及敏感记忆、个人信息或外部来源原文时，默认仅写入必要摘要，不直接扩散全文。
- 功能变更完成后必须补充对应单元测试或集成测试，覆盖新增分支、写回结果或重排结果。

## 7. 失败与重试
- 任何失败都必须记录失败类型、输入快照、处理阶段、错误堆栈、重试次数和最后一次处理时间。
- 失败上下文默认写入 `memory-root/archive/failures/`，文件名必须包含 `memoryId`、阶段标识和时间戳。
- 重试策略默认采用最多 3 次重试，间隔分别为 1 分钟、5 分钟、20 分钟；退避算法采用指数退避并叠加随机抖动。
- 幂等任务允许在检测到相同输入快照时直接复用上一次成功结果，不重复写入最终文件。
- API 调用失败（LLM 或 embedding）不消耗业务重试次数，单独管理：LLM 失败时快轨层降级为模板回复，后台加工层暂停并等待恢复轮询（每 30 秒检测一次）；embedding 失败时标记记忆为"向量待生成"，不影响文件写入和关键词检索。
- API 连续失败超过 10 分钟时，在前端持久提示降级状态，直到恢复检测成功。
- 当同一任务连续失败达到重试上限，或者检测到版本冲突、schema 不兼容、数据损坏时，必须触发人工接管。
- 人工接管条件包括：自动重试耗尽、冲突无法合并、历史快照缺失、校验失败不可修复、或用户明确要求回滚。
- 人工接管入口必须保留原始输入、失败原因、候选修复结果和建议操作，不得只给出简短错误码。

## 8. 决策点
- 部署形态：纯本地单机，不考虑多用户隔离和远程访问；进程重启后从 SQLite 恢复待审计队列和冲突记录状态。
- 监听数据的接入形式：统一为标准化事件对象，底层输入可以来自 JSON、事件流或文件落盘，但进入系统前必须归一化。
- 本地存储目录：使用 `memory-root/` 作为根目录，结构以 `index-map.md`、`profile.md`、`memory.db`、`notes/*` 和 `archive/*` 为准。
- 存储方案：记忆正文用 Markdown 文件（人类可读、可直接编辑）；向量索引、关系图谱、待审计队列和冲突记录用 SQLite（结构化查询、事务保证、单文件便于备份）。
- MCP 与 skills 接入边界：兼具数据采集输入源和能力调用输出方双重角色；作为输入源时不直接绕过审计持久化层写入最终文件；作为输出方时只读取已审计记忆的摘要和引用路径，不暴露内部存储结构。
- `chat/route.ts` 请求体：最小字段由 `messages`、`mode`、`sessionId` 组成，其他字段为可选扩展。
- `memory/route.ts` 写入模式：默认采用合并写入，冲突时进入审计持久化层按冲突分级策略处理。
- `heatScore` 计算：各子项公式和默认参数定义在 4.10 和 `src/config/scoring.config.ts`，变更参数后需重新计算全部 `heatScore`。
- `Mini LLM` 与 `Pro 模型`：Mini LLM 负责快轨处理，Pro 模型负责审计、冲突处理和重写；两者均通过中转站适配层调用，API 不可用时按降级策略处理。
- 决策点应在实现前优先判断，若与已有章节冲突，则以”设计原则、处理策略、失败与重试、数据类型约束”为准。

## 9. 安全与隐私
本系统为纯本地单机部署，安全策略聚焦于本地数据保护和 API 凭证管理，不涉及多用户隔离和远程访问控制。

- API Key 管理：中转站 API Key 必须从环境变量 `MODEL_API_KEY` 读取，不得硬编码在源码或配置文件中；`.env` 文件必须加入 `.gitignore`。
- 本地数据备份：`memory-root/` 目录支持整体备份（Markdown 文件 + `memory.db`）；建议提供 `导出全部记忆` 和 `导入备份` 功能，导出格式为 `memory-root/` 的 zip 压缩包。
- 敏感信息处理：涉及外部来源原文（如邮件、聊天记录、浏览器历史）时，默认仅写入摘要和来源标识，不存储原文；如用户明确要求保留原文，必须标注为”含原文”并在 `MemoryRecord.tags` 中加入 `sensitive` 标签。
- 数据清理：用户可以单条或批量删除记忆；删除操作将记忆正文移至 `archive/deleted/`（带时间戳），同步删除向量索引和图谱关系，保留 `MemoryVersion` 快照用于恢复。
- 日志安全：失败上下文和审计日志中不得包含 API Key、完整原文或用户隐私内容；如需包含输入快照用于调试，必须脱敏处理。
- 进程隔离：SQLite 数据库使用文件锁保证单进程访问，不允许多个进程实例同时写入同一 `memory.db`。

## 10. 测试策略
测试按层定义关注点，每层必须覆盖新增分支、写回结果或重排结果。

**快轨层测试**
- 测流式输出格式和中断恢复。
- 测候选记忆生成逻辑：输入归一化 → 抽取 → 候选 `PendingEvent` 结构完整性。
- 测 LLM API 不可用时的降级路径：模板回复是否正常返回、降级提示是否触发。

**后台加工层测试**
- 测 JSON 清洗和去重：重复输入不产生重复 `PendingEvent`。
- 测分类和打分：`tags` 生成一致性、`heatScore` 子项计算公式正确性。
- 测 embedding API 不可用时：新记忆标记”向量待生成”、关键词召回降级是否生效。
- 测 `PendingEvent` 入队：字段完整性、`status` 初始值为 `pending`。

**审计持久化层测试**
- 测冲突分级：自动可合并（不同字段）、需人工裁决（同字段不同值生成 `ConflictRecord`）、不可合并（schema 不兼容阻断写入）。
- 测版本管理：写回后 `MemoryVersion` 快照生成、版本号递增、回滚后状态恢复。
- 浘并发控制：同一 `memoryId` 串行处理、不同 `memoryId` 可并行。
- 测写回顺序：`note-*.md` → `Agent.md` → `index-map.md` → `profile.md` → `archive/*`。
- 测 `ConflictRecord` 裁决：`resolved_accept` / `resolved_keep` / `resolved_manual` 三种路径的写回结果。

**持久化层测试**
- 测 SQLite 事务：向量、图谱、队列写回的原子性，失败时回滚。
- 测文件锁：多写入请求串行执行，不并行覆盖同一目标文件。
- 测备份与恢复：导出 → 删除原目录 → 导入 → 数据完整性校验。

**集成测试**
- 端到端：用户输入 → 快轨回复 → 后台加工 → 审计写回 → 前端状态同步。
- 检索端到端：关键词 + 向量 + 标签混合召回 → MMR 重排 → 结果注入 prompt → 点击回写。
- MCP/skills 双向：外部数据源采集 → 记忆生成 → 审计写回；已审计记忆 → MCP/skills 输出 → 外部工具消费。

## 11. 已知偏差与待办事项

本章记录 AGENTS.md 与当前代码实现之间的已知 gap，以及计划中的修正方向。

### 11.1 文档与代码偏差

| 偏差项 | AGENTS.md 描述 | 实际代码 | 优先级 |
|--------|---------------|---------|--------|
| 队列存储路径 | `src/lib/storage/queue.ts`（第 4.6 节旧版描述） | 已修复：删除 `src/features/audit/queue.ts`（内存 Map），Auditor 统一使用 MemoryService SQLite 队列；dequeueEvent 事务化（悲观锁） | ~~P1~~ |
| 图谱存储方式 | 第 4.6 节仅描述 `graph_edges` SQLite 表 | 已修复：删除 `manager.ts` 和 `query.ts`，唯一路径为 `wiki-graph.ts` | ~~P2~~ |
| sortBy 参数 | 无约束 | 已修复：`SORTABLE_FIELDS` Set 白名单 | ~~P1~~ |
| memory/search 性能 | 无约束 | 已修复：`listMemories()` 调用处统一加 limit 约束（handler: 500, tool-registry: 200, orchestrator: 500） | ~~P1~~ |
| 文件锁实现 | 未描述实现细节 | 已修复：`fs.open(path, O_WRONLY \| O_CREAT \| O_EXCL)` 原子操作 | ~~P2~~ |
| 日志系统 | 未提及 | 已修复：核心链路（model-adapter, memory-service, orchestrator）迁移到 `logger` | ~~P3~~ |
| 测试覆盖 | 第 10 节定义了完整测试策略 | 已修复：34 个测试文件，346 passed / 0 skipped，覆盖 builder/validator/differ/conflict-resolver/VectorIndex/Ranker/MemoryService 队列/Auditor、Agent 循环、降级路径、聊天入队到审计写回集成链路、配置 API 请求体验证、提供商目录、上下文压缩和首个 React 设置表单 SSR 测试 | ~~P2~~ |
| 工具结果分层 | 未定义 | 已修复：`ToolResult` 新增 `content` 字段（给模型读的自然语言），`data` 保持不变（给 UI/日志） | ~~P3~~ |
| 会话系统提示快照 | 持久化 system 消息 | 已修复：`ChatSessionService.appendSnapshot` 过滤 system 角色消息，恢复时由 Handler 重建 | ~~P2~~ |
| 提供商配置 | AI 配置仅前端表单 | 已修复：`src/config/providers.json` 声明式目录经 `provider-loader.ts` 做 Zod 校验和读写，`/api/config/ai` 返回 `providerCatalog`，设置页模型/供应商选项由目录驱动并有单测覆盖 | ~~P2~~ |
| docs 目录未纳入版本控制 | 第 2 节要求文档跟随实现，差异有记录 | 已修复：`.gitignore` 不再忽略 `docs-zh/`，仅继续忽略 `docs-zh/.obsidian/workspace.json` 这类个人编辑器状态；项目文档可进入版本控制 | ~~P2~~ |
| 降级状态恢复 | 第 4.11 节描述降级但未提恢复 | 已修复：`ModelAdapter.startHealthCheck()` 周期性轮询，恢复后自动退出降级；scheduler setInterval 类型修复 | ~~P1~~ |
| 记忆创建绕过审计 | 第 4.8 节要求先入队再审计 | 已修复：tool-registry 的 create_memory/update_memory 改为生成 PendingEvent 入队而非直接写库 | ~~P0~~ |
| MMR 重排 | 第 4.11 节"重排默认采用 MMR" | 已修复：`Ranker.rankWithMMR()` 实现真正的 MMR（α*score - (1-α)*max_sim），用 tags Jaccard 作为文档间相似度，α 默认 0.7；handler.ts 已切换到 rankWithMMR；保留 `rank()` 作为基础多因子加权排序供其他场景使用 | ~~P2~~ |
| reject 路径 | 第 4.10 节"不可合并：schema 版本不兼容、数据损坏或格式校验失败" | 已修复：`conflict-resolver.ts` 补全三种 reject 触发条件（candidate.version < existing.version / 必要字段为空 / tags|graphLinks 非数组），reject 优先级在字段比对前；Auditor 处理 reject 时 status=failed 并透传 reason | ~~P1~~ |
| 向量检索相似度阈值 | 无约束 | 已修复：`VectorRetriever.search` 新增 `minSimilarity` 参数（默认 0.3），过滤低相似度噪声；搜索 API 新增 `?threshold=` 查询参数 | ~~P1~~ |
| MCP 工具 execute | 未描述 | 已修复：`handler.ts collectToolDefs` 为 MCP 工具包装 execute 闭包调用 `mcpManager.callTool`，替代原先 `execute: undefined`（会导致模型调用卡住） | ~~P2~~ |
| 访问计数污染 | 第 4.8 节"搜索回写由前端搜索命中事件触发" | 已修复：`handler.ts retrieveRelevantMemories` 移除召回时的 `incrementAccess` 调用（召回 ≠ 访问），避免 heatScore 失真 | ~~P2~~ |
| MemoryRecord 国际化字段 | 第 5.1 节 `MemoryRecord` 类型未定义 | 已修复：`types/memory.ts` 补齐 `titleZh`/`summaryZh`/`tagsZh`/`topicZh` 四个可选字段；AGENTS.md 5.1 节类型定义同步更新；`validateMemoryRecord` 增加 zh 字段类型校验 | ~~P2~~ |
| validatePendingEvent sourceType 白名单 | 第 5.6 节 `sourceType` 含 `listen` | 已修复：`validator.ts` 的 `validatePendingEvent` 白名单补全 `listen`（共 6 种），与 `PendingEvent` 类型定义一致；`/api/listen` 入队事件校验恢复正常 | ~~P1~~ |
| validateVectorRecord 空数组放行 | 无约束 | 已修复：`validateVectorRecord` 改为 `!Array.isArray(record.embedding) || record.embedding.length === 0`，空数组不再放行 | ~~P3~~ |
| 访问计数回写入口 | 第 4.8 节"搜索回写由前端搜索命中事件触发" | 已修复：新增 `POST /api/memory/[id]/access` 端点，前端用户点击记忆时调用 `incrementAccess`；配合之前从 `retrieveRelevantMemories` 移除召回时递增的修复，访问计数现在有正确的回写路径 | ~~P2~~ |
| 预处理管线未接入主路径 | 第 4.6 节"输入归一化：`src/server/pipelines/*`"与《架构检查文档》4.3 "不要让原始输入直接进入索引和记忆" | 已修复：`Orchestrator.processIngest` 接入 `processJsonPipeline`，完成 formatMemoryContent 清洗 + detectDuplicates（全量内容扫描的 Jaccard 去重）+ splitText 长文拆包；重复内容抛 `MemoryValidationError` 拒绝入库，多 chunk 合并为 markdown 分段正文 | ~~P0~~ |
| 分类驱动路由未生效 | 第 4.14 节工具调用流程 + 《架构检查文档》4.4 "分类驱动路由" | 已修复：`ChatHandler.streamResponse` 调用 `ChatClassifier.classify` 对最近 user 消息做本地意图分类，结果注入 prompt 的"用户意图"块（零 LLM 开销），引导模型选择工具与回复风格 | ~~P0~~ |
| 置信度评分为硬编码常量 | 第 4.11 节"模型与检索约束"未约束置信度算法；《架构检查文档》4.4 要求区分"高可信事实"与"待确认推测" | 已修复：`ChatClassifier`/`MemoryClassifier` 改为 `score = min(0.95, 0.5 + 0.12*命中数 + 0.05*位置加分)`，区分多关键词命中（高可信）与单关键词命中（待确认） | ~~P1~~ |
| 审计可读文本缺失 | 第 4.10 节"冲突分级策略" + 《架构检查文档》4.7 "markdown 流式转码 + LLM 检查" | 已修复：`AuditReporter.generateMarkdownReport()` 生成按来源/话题分布 + 冲突清单 + 最近记忆的可读 Markdown；`Orchestrator.processQueue` 末尾自动落盘到 `archive/audits/audit-{timestamp}.md` | ~~P1~~ |
| ChatHandler 职责偏重 | Agent 循环负责检索、意图、提示词、流式输出 | 已修复：系统提示组装拆到 `src/features/chat/system-prompt.ts`，`ChatHandler` 只传入 `SystemBlocks` 并消费组装结果；新增 `chat-system-prompt.test.ts` 覆盖提示块契约 | ~~P3~~ |
| Orchestrator 审计报告 I/O 内联 | 审计持久化层应由服务拆分职责 | 已修复：审计报告落盘拆到 `src/server/services/audit-report-writer.ts`，`Orchestrator` 仅调度 `AuditReportWriter.write()`；新增独立单测覆盖路径、文件名与写入内容 | ~~P3~~ |
| 向量搜索后端固定 JS 实现 | Phase 3 规划升级原生向量索引 | 已修复：`VectorSearchBackend` 默认使用 USearch HNSW ANN；SQLite 版本触发器检测索引失配并自动重建，按 embedding 维度分图持久化；JS 精确搜索仅作 `VECTOR_BACKEND=js` 或初始化失败 fallback；测试覆盖增删改、持久化重载和自动重建 | ~~P3~~ |
| 画像回写无阈值 | 《架构检查文档》6.3 "回写震荡风险：自动更新 loop 如果太激进，会导致提示词频繁变化、标签漂移" | 已修复：`ProfileUpdater` 新增 `UPDATE_SIMILARITY_THRESHOLD=0.85`，新旧画像行级 Jaccard 相似度 ≥ 阈值时跳过回写，避免 `profile.md` 反复刷新导致 `PromptCache` 震荡 | ~~P2~~ |
| API schema 导出 | 第 4.6 节和第 6 节要求所有 route handler 导出请求体 schema、响应体 schema、错误码表 | 已修复：受 Next.js route module 导出限制，契约集中到 `src/config/api-route-contracts.ts`，为所有 API route 声明请求 schema（需 body 的路由）、响应 schema 与错误码表；`api-route-contracts.test.ts` 防止新增路由漏登记 | ~~P2~~ |
| 配置 API 请求体验证 | 当前阶段至少保证 Zod 请求体校验覆盖 | 已修复：`config/storage` POST/PATCH 与 `config/tool-sources` POST/PUT 统一使用 `validation.ts` 中的 Zod schema；工具源 PUT 字段与 `ToolWatchSource` 契约对齐，并补充错误类型、默认值、路径遍历和旧字段名测试 | ~~P1~~ |
| 存储路径硬编码 | 第 8 节"本地存储目录：使用 `memory-root/` 作为根目录"未支持运行时可配置 | 已修复：`path-resolver.ts` 改造为 `getDatabasePath()` 固定用 env（避免循环依赖），`getMemoryRoot()` 从 db storage_config 读取带缓存；新增 `StorageMigrationService`（停 watcher→复制→更新 config→invalidatePathCache→重启 watcher）；`/api/config/storage` API（GET/POST/PATCH 预览）；`StorageConfigForm` 前端组件 | ~~P1~~ |
| 本地工具对话无法采集 | 第 4.6.2 节仅描述 API 监听和书签抓取，无本地工具工作目录采集 | 已修复：新增 `ToolWatchSource` 类型 + `ConfigService` CRUD + `session-parser.ts`（Codex/Claude Code/Cursor/Markdown/Text 五种解析器，递归提取 content）+ `ToolDirWatcher`（多源 chokidar + mtime+size 去重）+ `/api/config/tool-sources` API + `ToolSourceList` 前端组件（预设快速添加） | ~~P1~~ |
| 用户画像无演化可视化 | 第 4.8 节"profile.md 由审计持久化层更新"但用户无法感知画像变化 | 已修复：`ProfileUpdater` 新增"学习中的领域"区块 + `profile-changelog.jsonl` 变更历史记录 + `getChangelog` 方法 + `/api/profile` API（GET 画像+历史 / POST 手动分析）+ `ProfilePanel` 前端组件（分区块展示 + 演化时间线）+ Navbar 加画像 tab | ~~P2~~ |
| 浏览器历史未采集 | 第 4.6 节外部能力接入未覆盖浏览器历史 | 已修复：新增 `history-collector.ts`（Chrome/Edge History SQLite copy+读取+Chrome 时间戳转换+域名分组 / Bookmarks JSON 解析+文件夹分组）+ `BrowserCollectScheduler`（历史 30min / 书签 6h，默认 `BROWSER_COLLECT_ENABLED=false` 关闭）+ instrumentation 启动 | ~~P3~~ |
| 文件监听与 `/api/listen` 重复写入 | 第 4.8 节要求候选先入待审计队列、最终文件只由审计持久化层写入 | 已修复：`/api/listen` 移除提前 Markdown 落盘，仅调用 `stageCreateMemory()`；审计新建沿用队列 `memoryId`；FileWatcher 按稳定 ID 区分 add/create 与 change/update，并增加外部文件修改集成测试 | ~~P0~~ |

### 11.2 渐进式路线图

项目按 Phase 分阶段推进，每个 Phase 在前一阶段稳定后才开始。当前阶段：**Phase 4 收口**。

```text
Phase 0 — 工程健康 [DONE]
  [x] AGENTS.md 规范文档
  [x] TypeScript strict mode + vitest 基础设施
  [x] ErrorCode 枚举 + apiResponse/apiError 包装
  [x] AI SDK 版本适配（openai-provider.ts / tool-schemas.ts 修复）
  [x] 文件锁原子操作（O_EXCL）
  [x] sortBy 白名单校验

Phase 1 — 核心稳定 [DONE]
  [x] 设计原则清单化（7 条可验证架构约束）
  [x] 工具结果分层（ToolResult.content + data）
  [x] 会话系统提示重建（不持久化 system 消息）
  [x] 核心概念速览表
  [x] 提供商声明式配置（providers.json）
  [x] pending_events 持久化统一（auditor 用 SQLite 版替代内存 Map）
  [x] listMemories 分页查询（避免全量内存加载）
  [x] 图谱废弃代码清理（manager.ts）
  [x] 降级状态恢复（ModelAdapter 健康检查 + setInterval 类型修复）
  [x] 记忆创建绕过审计队列修复（tool create/update → PendingEvent 入队）
  [x] 功能 Bug 修复（MCP execute / 访问计数污染 / 向量相似度阈值）
  [x] MMR 重排实现（Ranker.rankWithMMR，tags Jaccard 文档间相似度）
  [x] reject 路径补全（schema 不兼容 / 数据损坏 / 格式校验失败）
  [x] 核心模块单元测试（builder/validator/differ/conflict-resolver/VectorIndex/Ranker/MemoryService/Auditor，112 用例）
  [x] validator 修复（PendingEvent 白名单补 listen / VectorRecord 空数组拦截 / MemoryRecord zh 字段校验）
  [x] 访问计数回写端点（POST /api/memory/[id]/access）
  [x] 存储路径热重载（path-resolver 改造 + StorageMigrationService + StorageConfigForm + /api/config/storage）
  [x] 本地工具采集（session-parser 五种解析器 + ToolDirWatcher + ToolSourceList + /api/config/tool-sources）
  [x] 用户画像演化可视化（画像加"学习中的领域"区块 + profile-changelog.jsonl + ProfilePanel + /api/profile）
  [x] 浏览器历史/书签采集（history-collector + BrowserCollectScheduler，默认关闭）
  [x] 文件监听幂等化（`/api/listen` 单一入队、稳定 memoryId、add/create + change/update、外部修改集成测试）

Phase 2 — 会话升级
  [x] localStorage → JSONL 文件持久化（服务端列表/恢复/删除 API + 最终 assistant 回复落盘 + 一次性旧数据迁移）
  [x] 多会话列表 + 切换（JSONL 为唯一真源，switchSession / removeSession UI 已接入）
  [x] 会话恢复系统提示重建（ChatHandler 已支持，system 消息不持久化）

Phase 3 — 智能增强
  [x] 会话上下文压缩（长对话旧消息压缩为稳定摘要块，保留最近上下文）
  [ ] 会话树形分支（从任意节点分支对话）
  [x] 向量检索升级为 USearch HNSW ANN（SQLite 版本触发器 + sidecar 持久化 + 自动重建 + JS fallback）

Phase 4 — 测试与质量
  [x] 快轨层测试（ChatHandler Agent 循环、降级路径、候选记忆生成）
  [x] 后台加工层测试（清洗去重、分类打分、全量去重扫描）
  [x] 审计持久化层测试（冲突分级、版本管理）
  [x] 集成测试（端到端：用户输入 → 快轨 → 审计 → 文件写回）
```

## 12. 本轮补充记录

- 已完成 `ChatHandler` 系统提示拆分：`src/features/chat/system-prompt.ts`
- 已完成审计报告写入拆分：`src/server/services/audit-report-writer.ts`
- 已完成向量搜索后端抽象：`src/lib/vector/backend.ts`
- 已完成提供商目录化配置：`providers.json` + `provider-loader.ts` + 设置页动态选项
- 已完成 API 契约集中登记：`src/config/api-route-contracts.ts`
- 已完成长对话上下文压缩：`src/lib/chat/conversation-compressor.ts`
- 已完成分类/重排阈值常量化：`src/config/constants.ts`
- 已完成去重扫描从固定最近 200 条扩展为全量内容扫描
- 已完成 nightly 降级保护：模型降级时跳过矛盾精判、wikilink 智能补充、路由优化和旗舰画像更新
- 已完成 WikiGraph 增量更新清理：文件变更/删除时移除旧节点关系，避免脏边残留
- 新增/更新测试：`chat-system-prompt.test.ts`、`audit-report-writer.test.ts`、`vector-backend.test.ts`、`provider-loader.test.ts`、`api-route-contracts.test.ts`、`conversation-compressor.test.ts`、`ai-config-form.test.tsx`
- 当前测试总量：34 个测试文件，346 passed / 0 skipped（共 346 用例）
