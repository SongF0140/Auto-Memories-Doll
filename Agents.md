# Agent 开发规范（面向 AI）

## 1. 文档目标
本文件用于描述系统架构、数据流、处理阶段、技术边界与推荐技术栈，供 AI 在编写、修改和审查代码时作为统一上下文。

## 2. 设计原则
- 所有描述优先使用可验证的事实，避免口语化和主观评价。
- 所有流程按“输入 -> 处理 -> 输出”表达，并尽量给出数据结构、接口和结果约束。
- 未经确认的内容必须标记为“待确认”或“推测”，不得写成确定事实。
- 实现时优先保持本地化、可追踪、可恢复。
- 不引入不必要的云端依赖。
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
- 本地持久化主线：文件系统
- 本地笔记存储：`src/lib/storage/*`，负责文件读写、路径组织和版本落盘
- 记忆索引：Markdown 索引、JSON 元数据、标签索引
- 向量检索：`src/lib/vector/*`，负责 embedding 生成、向量更新、召回和重排
- 图谱关系：`src/lib/graph/*`，负责记忆关系边和关系查询
- 后台任务：Route Handlers、Node.js 任务、Cron
- 外部能力接入：MCP、skills、浏览器侧采集接口

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
- 关系映射层：描述记忆之间关系的本地图结构，不等于图数据库。
- 向量索引适配层：负责 embedding 生成、更新、检索和重排的本地模块。

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
- 生成记忆 JSON、标签索引和向量索引
- 将处理结果写入待审计队列，而不是直接覆盖最终文件

**审计持久化层**
- 做离线规约
- 对比新旧记忆
- 解决冲突并生成可写回结果
- 统一负责本地文件写回、版本管理和失败重试
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
- 落盘与版本：Node.js 文件系统 API

### 4.7 记忆目录结构
记忆系统使用本地文件夹承载，建议结构如下：
```txt
memory-root/
├─ index-map.md              # 索引地图，记录所有记忆文件夹、标签和关系入口
├─ profile.md                # 个性标签 + 个性提示词
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
- 版本冲突优先采用“基于 `updatedAt` 的最后写入优先 + 人工保留快照”策略；当两个写回结果都改动同一字段且无法自动合并时，生成新的 `MemoryVersion` 并进入人工审计。
- 并发控制采用单 `memoryId` 串行队列或文件锁；写入前必须校验当前版本号，版本不一致时拒绝覆盖并转入重读-重算-重写流程。
- 版本回滚只在写回失败、冲突不可解、或人工审计明确要求恢复历史状态时触发，回滚目标必须来自 `archive/*` 快照。
- `VectorRecord.embedding` 使用固定模型维度，维度由 `model` 决定并在实现层保持一致。
- `GraphEdge.from` 与 `GraphEdge.to` 均引用 `MemoryRecord.id`。
- `heatScore` = `accessCount * 0.35 + recencyScore * 0.25 + exposureScore * 0.25 + tagAffinityScore * 0.15`；其中 `recencyScore` 使用指数衰减归一化到 0 到 1，`exposureScore` 和 `tagAffinityScore` 也必须归一化到 0 到 1。
- `snapshotPath` 只保存归档文件路径，不保存业务正文。

### 4.11 模型与检索约束
- `Mini LLM` 用于快轨抽取、分类和摘要，优先选择低延迟模型；`Pro 模型` 用于审计、冲突处理和重写，优先选择高质量模型。
- 模型选择规则：当单次处理目标为低延迟流式回复时使用 `Mini LLM`，当任务涉及审计、冲突消解、写回重写或高风险内容处理时使用 `Pro 模型`。
- 向量模型默认使用 `text-embedding-3-small`；如实现层替换模型，必须同步更新 `VectorRecord.model` 和对应维度约束。
- 向量索引持久化由本地文件系统承载，索引文件、元数据文件和重建任务必须保持同一 `memory-root/` 根目录。
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
系统至少维护以下四类本地数据。

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
- `heatScore` 采用固定公式计算。
- `vectorId` 在向量索引生成后写入。
- `graphLinks` 由关系写回流程生成，保存相关记忆 ID 列表。

### 5.2 向量索引
```ts
export type VectorRecord = {
  memoryId: string;
  embedding: number[];
  model: "text-embedding-3-small";
  updatedAt: string;
};
```
- `memoryId` 必须引用 `MemoryRecord.id`。
- `embedding` 由向量生成流程写入，长度必须与 `model` 对应。
- `model` 记录实际使用的 embedding 模型名称。
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

## 6. 处理策略
- 新增功能前先判断属于快轨、后台加工还是审计持久化。
- 快轨只做即时回复、轻量抽取和候选生成，不写最终文件。
- 后台加工负责归一化、去重、分类、索引构建和候选记忆生成，结果先进入待审计队列。
- 审计持久化负责冲突消解、版本管理、回滚和最终落盘。
- 处理 JSON 时先做拆分、去重、格式化，再进入索引与评分。
- 涉及写回时必须明确区分“增量更新”和“覆盖写入”。
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
- 当同一任务连续失败达到重试上限，或者检测到版本冲突、schema 不兼容、数据损坏时，必须触发人工接管。
- 人工接管条件包括：自动重试耗尽、冲突无法合并、历史快照缺失、校验失败不可修复、或用户明确要求回滚。
- 人工接管入口必须保留原始输入、失败原因、候选修复结果和建议操作，不得只给出简短错误码。

## 8. 决策点
- 监听数据的接入形式：统一为标准化事件对象，底层输入可以来自 JSON、事件流或文件落盘，但进入系统前必须归一化。
- 本地存储目录：使用 `memory-root/` 作为根目录，结构以 `index-map.md`、`profile.md`、`notes/*` 和 `archive/*` 为准。
- MCP 与 skills 接入边界：仅作为外部输入源，不直接绕过审计持久化层写入最终文件。
- `chat/route.ts` 请求体：最小字段由 `messages`、`mode`、`sessionId` 组成，其他字段为可选扩展。
- `memory/route.ts` 写入模式：默认采用合并写入，冲突时进入审计持久化层处理。
- `heatScore` 计算：由访问次数、最近访问时间、时间衰减和推荐曝光共同决定，具体权重在实现层固定。
- `Mini LLM` 与 `Pro 模型`：Mini LLM 负责快轨处理，Pro 模型负责审计、冲突处理和重写。
- 决策点应在实现前优先判断，若与已有章节冲突，则以“设计原则、处理策略、失败与重试、数据类型约束”为准。

