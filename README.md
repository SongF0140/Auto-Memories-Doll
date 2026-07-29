# Auto-Memeries-Doll

基于 Next.js 14 的本地记忆管理系统。融合 AI 对话、向量检索、文件级图谱与审计写回，将用户输入、外部接入和后台任务统一到可追踪、可回放的本地工作流中。

## 快速开始

```bash
# 安装依赖
npm install

# 配置 AI（复制 .env.example 为 .env.local 并填入 API Key）
cp .env.example .env.local

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Next.js 开发服务器（默认端口 3000） |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务器 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码规范检查 |
| `npm run format` | Prettier 格式化所有源码 |
| `npm run format:check` | 检查格式是否合规（CI 用） |

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5 |
| UI | React 18, Tailwind CSS 3, Framer Motion, Aceternity UI |
| AI | Vercel AI SDK (`@ai-sdk/openai` + `@ai-sdk/anthropic`) |
| 向量存储 | better-sqlite3（本地 SQLite，cosine 相似度） |
| 文件图谱 | Markdown wikilink (`[[id]]`) + YAML frontmatter |
| 代码质量 | ESLint (flat config), Prettier |

## 项目结构

```
src/
├── app/                        # Next.js App Router 页面与 API 路由
│   ├── layout.tsx              # 根布局
│   ├── page.tsx                # 首页
│   └── api/
│       ├── audit/              # 审计接口（冲突查看 / 处理）
│       ├── chat/               # AI 对话（流式 + 非流式）
│       ├── config/
│       │   ├── ai/             # AI 配置接口
│       │   ├── mcp/            # MCP 服务器配置接口
│       │   └── skills/         # Skill 配置接口
│       ├── ingest/             # 数据接入接口（文本导入）
│       ├── listen/             # 对话监听接口
│       ├── memory/             # 记忆 CRUD + 搜索接口
│       └── prompt/             # 提示词模板接口
│
├── components/                 # React UI 组件
│   ├── audit/                  # 审计面板
│   ├── chat/                   # 对话界面（输入框、消息列表、模式切换）
│   ├── common/                 # 通用组件（Avatar, Badge, ErrorBoundary, Navbar）
│   ├── memory/                 # 记忆组件（卡片、列表、搜索、查看器）
│   ├── prompt/                 # 提示词编辑器
│   ├── settings/               # 设置面板（AI配置、MCP、Skills）
│   └── ui/                     # UI 特效组件（Aurora背景、磁性按钮、聚光灯卡片等）
│
├── config/                     # 配置与常量
│   ├── env.ts                  # 环境变量解析
│   ├── api.config.ts           # API 配置
│   ├── constants.ts            # 全局常量
│   ├── scoring.config.ts       # 记忆评分规则
│   ├── topics.config.ts        # 话题分类规则
│   └── topics.example.json     # 话题配置示例
│
├── features/                   # 业务功能模块
│   ├── audit/                  # 审计流程（审阅、比对、冲突解决、版本管理、回放）
│   ├── chat/                   # 对话处理（分类、记忆提取、WikiGraph 扩展）
│   ├── ingest/                 # 数据接入（适配器、对话处理、归一化、解析）
│   ├── memory/                 # 记忆处理（分类、提取、评分）
│   └── prompt/                 # 提示词管理（增删改查、渲染）
│
├── lib/                        # 核心基础库
│   ├── ai/                     # AI 适配层（模型创建、翻译、工具调用）
│   ├── graph/                  # 图谱模块（WikiGraph 文件级 wikilink、图谱构建/查询）
│   ├── mcp/                    # MCP 协议（客户端、管理器、协议定义）
│   ├── memory/                 # 记忆抽象（构建器、翻译器、校验器）
│   ├── prompt/                 # 提示词引擎（模板管理、缓存、构建器）
│   ├── skills/                 # Skill 注册与执行
│   ├── storage/                # 存储层（文件管理、数据库、索引写入、路径解析、文件锁、Markdown 解析/格式化）
│   ├── utils/                  # 工具函数（日期、ID 生成、归一化）
│   ├── vector/                 # 向量模块（生成、索引、排序、检索）
│   ├── errors.ts               # 统一错误类型（AppError 及子类）
│   ├── utils.ts                # 工具函数（cn classname 合并等）
│   └── validation.ts           # 通用校验
│
├── server/                     # 服务端基础设施
│   ├── listener/               # 对话监听服务
│   ├── pipelines/              # 数据处理管线（去重、格式化、分割、JSON 管线）
│   ├── schedulers/             # 后台调度器（审计、清理、向量重建）
│   ├── services/               # 核心服务（审计、配置、记忆、编排器、用户画像）
│   ├── watchers/               # 文件监听器
│   └── workers/                # 后台工作线程（审计、清理、向量）
│
├── styles/                     # 全局样式
│   ├── globals.css             # 全局 CSS + Tailwind
│   └── components.css          # 组件样式
│
└── types/                      # TypeScript 类型定义
    ├── api.ts                  # API 请求/响应类型
    ├── config.ts               # 配置类型
    ├── event.ts                # 事件类型
    └── memory.ts               # 记忆核心类型
```

## 总体架构

系统按职责分为四层：

| 层 | 位置 | 职责 |
|----|------|------|
| **入口层** | `src/app/` | 页面路由、API 接口、模式切换 |
| **快轨层** | `src/features/chat/` | 低延迟对话流式输出 |
| **后台加工层** | `src/features/` + `src/lib/` | 清洗、分类、打分、索引构建、记忆提取 |
| **审计持久化层** | `src/features/audit/` + `src/server/` | 比对、冲突处理、版本管理、写回落盘 |

## 数据流

### 对话链路

用户输入 → `chat/route.ts` → `handler.ts`（分类 + 向量检索 + WikiGraph 图谱扩展）→ AI 流式响应

### 记忆链路

用户输入 → `ingest/route.ts` → `orchestrator.ts`（校验 → 入队 → 审计 → 写回）→ 文件持久化 + 向量索引

### 后台任务

`instrumentation.ts` 启动时注册三个调度器：`AuditScheduler`（定时审计）、`CleanupScheduler`（定时清理）、`VectorScheduler`（定时重建向量索引）

## 本地存储

记忆以 **LLMWiki 格式**存储在本地文件系统：

```txt
memory-root/
├── memory.db              # SQLite 数据库（向量记录、事件队列）
├── index-map.md           # 全局索引
├── profile.md             # 用户画像
├── notes/                 # 记忆文件（按主题分目录）
│   ├── topic-a/
│   │   ├── Agent.md       # 主题摘要（YAML frontmatter + wikilink）
│   │   └── note-*.md      # 具体记忆（YAML frontmatter + [[wikilink]] + 正文）
│   └── ...
└── archive/               # 归档与快照
```

### 记忆关系

- 文件内使用 `[[memory-id]]` wikilink 表示关联关系
- YAML frontmatter 中 `related` 字段表示显式关联
- `wiki-graph.ts` 扫描所有文件构建图谱索引，无需独立存储边表

## API 路由一览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | AI 对话（支持流式 `text/event-stream`） |
| `/api/chat/stream` | POST | 流式对话专用 |
| `/api/memory` | GET / POST | 记忆列表 / 创建记忆 |
| `/api/memory/[id]` | GET / PUT / DELETE | 记忆详情 / 更新 / 删除 |
| `/api/memory/search` | POST | 向量 + 关键词混合搜索 |
| `/api/ingest` | POST | 文本导入自动生成记忆 |
| `/api/listen` | POST | 对话监听（实时采集） |
| `/api/audit` | GET / POST | 审计队列 / 提交审计 |
| `/api/audit/conflicts` | GET | 冲突列表 |
| `/api/config/ai` | GET / PUT | AI 配置读写 |
| `/api/config/mcp` | GET / POST | MCP 服务器配置 |
| `/api/config/skills` | GET / POST | Skill 配置 |
| `/api/prompt` | GET / POST | 提示词模板列表 / 创建 |
| `/api/prompt/[id]` | GET / PUT / DELETE | 模板详情 / 更新 / 删除 |

## 核心数据模型

| 类型 | 文件 | 说明 |
|------|------|------|
| `MemoryRecord` | `types/memory.ts` | 记忆主记录（id、标题、摘要、内容、标签、图谱链接等） |
| `VectorRecord` | `lib/vector/index.ts` | 向量索引记录（memoryId、embedding、模型、维度） |
| `PendingEvent` | `types/event.ts` | 待审计事件（eventId、状态、重试次数、候选数据） |
| `AiConfig` | `types/config.ts` | AI 配置（provider、baseURL、apiKey、模型、参数） |

## 错误处理

统一使用 `src/lib/errors.ts` 中的自定义错误类：

| 类 | 错误码 | 场景 |
|-----|--------|------|
| `MemoryNotFoundError` | `MEMORY_NOT_FOUND` | 记忆 ID 不存在 |
| `MemoryValidationError` | `MEMORY_INVALID` | 记忆数据校验失败 |
| `TemplateNotFoundError` | `TEMPLATE_NOT_FOUND` | 提示词模板不存在 |
| `TemplateConflictError` | `TEMPLATE_CONFLICT` | 模板 ID 冲突 |
| `AiServiceError` | `AI_SERVICE_UNAVAILABLE` | AI 服务不可用 |
| `LockError` | `LOCK_TIMEOUT` | 文件锁超时 |
| `McpNotFoundError` | `MCP_NOT_FOUND` | MCP 服务器未找到 |
| `McpNotConfiguredError` | `MCP_NOT_CONFIGURED` | MCP 服务器未配置 |
| `SkillNotFoundError` | `SKILL_NOT_FOUND` | Skill 未找到 |

## 开发工具

- **TypeScript** — 类型检查：`npm run typecheck`
- **ESLint** — 代码规范：`npm run lint`（基于 `eslint.config.mjs` flat config）
- **Prettier** — 代码格式化：`npm run format`（基于 `.prettierrc`）

详细依赖说明见 [DEPENDENCIES.md](./DEPENDENCIES.md)。

## 配置

1. 复制 `.env.example` 为 `.env.local`
2. 填入 AI 配置：
   - `AI_PROVIDER=openai` 或 `anthropic`
   - `AI_BASE_URL=https://api.openai.com/v1`
   - `AI_API_KEY=sk-xxx`
   - `AI_CHAT_MODEL=gpt-4o`
   - `AI_EMBEDDING_MODEL=text-embedding-3-small`

配置也可在运行后通过前端 Settings 面板在线修改，数据存储在 `memory-root/` 下。

## 文档分工

| 文档 | 读者 | 内容 |
|------|------|------|
| `README.md` | 开发者 | 项目架构、快速开始、API 一览 |
| `DEPENDENCIES.md` | 开发者 | 依赖包清单与说明 |
| `AGENTS.md` | AI Agent | 项目约定、架构细节、开发规范 |
| `notes.md` | 开发者 | 开发笔记与设计说明 |
