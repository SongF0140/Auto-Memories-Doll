# Agent 开发规范（面向 AI）

## 1. 文档目标
本文件用于描述系统架构、数据流、处理阶段、技术边界与推荐技术栈，供 AI 在编写、修改和审查代码时作为统一上下文。

## 2. 设计原则
- 所有描述优先使用可验证的事实，避免口语化和主观评价。
- 所有流程按“输入 -> 处理 -> 输出”表达，并尽量给出数据结构、接口和结果约束。
- 未经确认的内容必须标记为“待确认”或“推测”，不得写成确定事实。
- 持久化层优先保持本地化、可追踪、可恢复，不依赖云端存储或远程数据库。
- 模型能力（LLM、embedding）通过 API 接入，但 API 不可用时必须支持降级运行，不影响本地数据完整性。
- 系统定位为纯本地单机部署，不考虑多用户隔离和远程访问。
- 技术选型优先采用 TypeScript 作为主线。
- 文档中出现的术语必须先定义，再使用。
- 任何进入实现的 API、事件和写回结构都必须先定义 schema，再定义校验器，再定义处理逻辑。
- 任何后台任务都必须明确失败记录、重试策略和人工接管条件。

## 3. 总体技术栈
- 语言：TypeScript
- 前端框架：React / Next.js
- AI 编排：Vercel AI SDK
- 样式：Tailwind CSS
- 状态管理：React Context
- 本地持久化主线：文件系统（记忆正文、索引地图、归档）+ SQLite（向量索引、关系图谱、待审计队列、冲突记录）
- 本地笔记存储：`src/lib/storage/*`，负责文件读写、路径组织和版本落盘
- 向量存储：SQLite + `sqlite-vec` 扩展，承载 `vector_records` 表，支持余弦相似度查询；预期规模几千到上万条
- 图谱存储：SQLite 表 `graph_edges`，承载 `GraphEdge` 关系边，支持邻接查询和关系遍历
- 队列存储：SQLite 表 `pending_events`，承载 `PendingEvent` 待审计队列，支持按 `memoryId` 串行消费
- 记忆索引：Markdown 索引地图、JSON 元数据、标签索引
- 向量检索：`src/lib/vector/*`，负责 embedding 生成、向量更新、召回和重排
- 图谱关系：`src/lib/graph/*`，负责记忆关系边和关系查询
- 模型适配：`src/lib/ai/*`，通过中转站适配层调用 LLM 和 embedding API，统一请求格式、响应格式和错误处理
- API 配置管理：`src/config/api.config.ts`，管理中转站 URL、API Key（从环境变量读取，不硬编码）、模型名称和降级开关
- SQLite 驱动：`better-sqlite3`（同步 API，适合本地单机场景）
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
│     ├─ memory/route.ts        # 记忆读写入口
│     ├─ prompt/route.ts        # 提示词更新入口
│     ├─ ingest/route.ts        # 后台数据接入入口
│     └─ audit/route.ts         # 审计入口
├─ components/
│  ├─ chat/                     # 人机交互组件
│  ├─ prompt/                   # 提示词编辑组件
│  ├─ memory/                   # 记忆模式相关组件
│  └─ common/                   # 公共组件
├─ features/
│  ├─ chat/                     # 快轨逻辑
│  ├─ prompt/                   # 提示词读写与回写
│  ├─ memory/                   # 记忆处理、分类、评分
│  ├─ ingest/                   # 后台输入接入与解析
│  └─ audit/                    # 审计、diff、冲突处理
├─ lib/
│  ├─ ai/                       # Vercel AI SDK 与模型适配
│  ├─ mcp/                      # MCP 接入
│  ├─ skills/                   # skills 接入
│  ├─ memory/                   # 记忆抽象
│  ├─ vector/                   # 向量索引与检索
│  ├─ graph/                    # 图索引与关系图
│  ├─ storage/                  # 本地存储与文件写回
│  ├─ prompt/                   # 提示词模板与处理
│  └─ utils/                    # 通用工具
├─ server/
│  ├─ services/                 # 服务编排
│  ├─ workers/                  # 异步任务
│  ├─ pipelines/                # JSON 处理流水线
│  └─ schedulers/               # 定时任务
├─ types/
├─ config/
├─ styles/
public/
docs/
```

入口层 -> `src/app/page.tsx` -> `src/components/chat/*` / `src/components/prompt/*` -> `src/features/chat/*` / `src/features/prompt/*`

快轨层 -> `src/features/chat/*` -> `src/lib/ai/*` -> `src/app/api/chat/route.ts` -> 流式输出

后台加工层 -> `src/app/api/ingest/route.ts` -> `src/features/ingest/*` -> `src/server/pipelines/*` -> `src/features/memory/*` -> `src/lib/vector/*` / `src/lib/graph/*`

审计持久化层 -> `src/app/api/audit/route.ts` -> `src/features/audit/*` -> `src/server/schedulers/*` -> `src/server/workers/*` -> `src/lib/storage/*`

持久化层属于审计持久化层的落盘子链路：`src/lib/storage/*` -> 本地文件 / 索引 / 标签 -> `src/features/prompt/*` -> `src/components/prompt/*` -> 前端状态同步

### 4.3 术语定义
- 中转站适配层：用于封装模型供应商差异的本地适配模块，统一请求格式、响应格式和错误处理。
- 监听窗口：系统可接收外部输入的来源窗口，包含前端会话、MCP 工具调用、skills 调用和浏览器侧采集接口。
- 短时记忆：当前主题下的高频摘要与要点，存放在 `notes/*/Agent.md`。
- 长时记忆：可追溯的具体事实与事件，存放在 `notes/*/note-*.md`。
- 索引地图：记录目录、标签、关系入口和引用路径的 `index-map.md`。
- 关系映射层：描述记忆之间关系的本地图结构，使用 SQLite 表实现邻接存储，不等于图数据库。
- 向量索引适配层：负责 embedding 生成、更新、检索和重排的本地模块，底层使用 SQLite + `sqlite-vec`。
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
- 请求响应约束：所有 route handler 都必须导出请求体 schema、响应体 schema、错误码表和处理函数，不允许只写业务逻辑
- 批处理与调度：Node.js 任务与站内调度器；Cron 仅作为可选部署形态
- 前端搜索：关键词索引、笔记检索、结果排序、点击回写
- 本地推荐：按次数推荐算法、动态热度更新、个性化重排、曝光回写
- 本地笔记存储：`src/lib/storage/*`，负责读写 `notes/*`、`index-map.md`、`profile.md` 和 `archive/*`
- 记忆索引：Markdown 索引地图、标签索引、关系索引、语义检索层
- 向量索引：`src/lib/vector/*`，负责 embedding 生成、向量更新、语义相似度检索、重排、回写
- 关系存储：`src/lib/graph/*`，负责记忆关系边和关系查询
- 更新策略：短时记忆要点更新 `notes/*/Agent.md`，长时记忆更新 `notes/*/note-*.md`，索引地图更新 `index-map.md`，推荐权重更新 `profile.md`
- 落盘与版本：记忆正文用 Node.js 文件系统 API 写入 Markdown 文件；向量、图谱、队列和冲突记录用 SQLite 事务写入
- 向量存储：`src/lib/vector/*` 使用 SQLite + `sqlite-vec` 扩展（`better-sqlite3` 驱动），通过 `vector_records` 表存储；召回时先做向量近邻查询再做内存重排
- 图谱存储：`src/lib/graph/*` 使用 SQLite 表 `graph_edges` 存储关系边，支持按 `from` 或 `to` 的邻接查询
- 队列存储：`src/lib/storage/queue.ts` 使用 SQLite 表 `pending_events` 存储待审计事件，支持按 `memoryId` 分组串行消费
- 冲突记录：`src/features/audit/*` 使用 SQLite 表 `conflict_records` 存储需人工裁决的冲突，支持按 `status` 过滤

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
- 向量索引持久化使用 SQLite + `sqlite-vec` 扩展，存储于 `memory-root/memory.db` 的 `vector_records` 表；重建任务必须保持同一 `memory-root/` 根目录。
- 图谱存储使用 SQLite 表 `graph_edges`，支持按 `from` 或 `to` 的邻接查询和关系遍历。
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

## 5. 数据类型
系统维护以下七类本地数据。

### 5.1 记忆 JSON
```ts
export type MemoryRecord = {
  id: string;
  version: number;
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill";
  title: string;
  content: string;
  summary: string;
  tags: string[];
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
- `tags` 由分类流程生成，写回时允许增量合并。
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
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill";
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
- 所有 API 都必须先定义请求体、响应体和错误码，再写实现。
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

