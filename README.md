# Auto-Memories-Doll

本地优先的 AI 记忆协作系统。在和 AI 对话学习新领域时，自动从对话噪声中提炼体系化笔记，让 AI 在第 N 轮对话时仍记得第 1 轮发生过什么。

融合双路径响应、多层混合索引、三级冲突审计与自更新闭环，把分散在 IDE、浏览器、聊天框、文件系统中的信息统一沉淀为可检索、可审计、可演化的长期记忆。

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

启动后访问 `http://localhost:3000`，在设置面板配置 AI 提供商即可开始使用。

## 核心功能

### 七大功能面板

| 面板 | 功能 |
|------|------|
| 对话 | chat / memory / prompt 三模式切换，流式输出，会话管理 |
| 记忆 | 记忆列表、查看、编辑、删除 |
| 搜索 | 语义检索（向量 + 关键词混合） |
| 画像 | 用户画像自动维护与演化历史可视化 |
| 提示词 | 模板 CRUD + 变量预览 |
| 审计 | 冲突裁决 UI + 重放待处理事件 |
| 设置 | AI 配置、存储路径、工具采集、MCP 服务器、Skills |

### 双路径响应

- **快处路径**：mini LLM + 流式 SSE，低延迟即时回复
- **主链路**：归一化 → 去重 → 拆包 → 分类 → 索引 → 审计 → 回写

### 多源数据采集

| 采集源 | 方式 | 说明 |
|--------|------|------|
| 网页 AI 对话 | 浏览器书签抓取 | 支持 ChatGPT/Claude/Gemini/DeepSeek/Kimi 自动识别 |
| Trae IDE / 外部工具 | `/api/listen` JSON 接口 | 实时推送对话内容 |
| 本地工具工作目录 | 目录监听 | 支持 Cursor / Codex CLI / Claude Code 会话文件 |
| 浏览器历史/书签 | 定时采集 | Chrome / Edge 历史记录与书签自动总结 |
| 文件系统 | chokidar 监听 | `memory-root/` 下 .md 文件变化自动入队 |
| 通用导入 | `/api/ingest` | JSON / 文本手动导入 |

### 三层混合索引

- **向量索引**：better-sqlite3 + cosine similarity + MMR 多样性重排
- **图索引**：基于 `[[wikilink]]` 的文件级图谱，支持 BFS 路径查找
- **分类索引**：memory_classifications 表 + index-map.md 标签/目录索引

### 审计与版本治理

- 三级冲突解决：reject（数据损坏）→ auto_merge（tags/graphLinks 并集）→ manual_decision（标量字段冲突）
- 版本快照 + 新旧差异对比 + 重放机制
- Markdown 审计报告落盘 `archive/audits/`

### 存储路径可热重载

- **数据库路径固定**：始终在 `env.MEMORY_ROOT`（启动时确定，避免 SQLITE_BUSY）
- **笔记路径可变**：在设置面板修改，支持自动迁移到大容量分区，无需重启

### 自更新闭环

用户对话 → ProfileUpdater 分析画像（30s 防抖，相似度 ≥ 0.85 跳过防震荡）→ 更新 `profile.md` + 变更日志 → PromptCache 失效 → 下一轮 prompt 自动注入新画像

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
| `npm test` | 运行测试套件 |

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
│   ├── page.tsx                # 首页（七大面板切换）
│   └── api/
│       ├── audit/              # 审计接口（冲突查看 / 处理）
│       ├── chat/               # AI 对话（流式 + 非流式）
│       ├── config/
│       │   ├── ai/             # AI 配置接口
│       │   ├── mcp/            # MCP 服务器配置接口
│       │   ├── skills/         # Skill 配置接口
│       │   ├── storage/        # 存储路径配置接口（热重载）
│       │   └── tool-sources/   # 本地工具采集源配置接口
│       ├── ingest/             # 数据接入接口（文本导入）
│       ├── listen/             # 对话监听接口
│       ├── memory/             # 记忆 CRUD + 搜索接口
│       ├── profile/            # 用户画像接口（查看 + 手动分析）
│       └── prompt/             # 提示词模板接口
│
├── components/                 # React UI 组件
│   ├── audit/                  # 审计面板
│   ├── chat/                   # 对话界面（输入框、消息列表、模式切换）
│   ├── common/                 # 通用组件（Avatar, Badge, ErrorBoundary, Navbar）
│   ├── memory/                 # 记忆组件（卡片、列表、搜索、查看器）
│   ├── profile/                # 用户画像面板（画像展示 + 演化时间线）
│   ├── prompt/                 # 提示词编辑器
│   ├── settings/               # 设置面板（AI配置、存储路径、工具采集、MCP、Skills）
│   └── ui/                     # UI 特效组件（Aurora背景、磁性按钮、聚光灯卡片等）
│
├── config/                     # 配置与常量
│   ├── env.ts                  # 环境变量解析
│   ├── api.config.ts           # API 配置
│   ├── constants.ts            # 全局常量
│   ├── scoring.config.ts       # 记忆评分规则
│   └── topics.config.ts        # 话题分类规则
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
│   ├── browser/                # 浏览器采集（Chrome/Edge 历史与书签）
│   ├── graph/                  # 图谱模块（WikiGraph 文件级 wikilink）
│   ├── mcp/                    # MCP 协议（客户端、管理器、ingest-bridge）
│   ├── memory/                 # 记忆抽象（构建器、翻译器、校验器）
│   ├── prompt/                 # 提示词引擎（模板管理、缓存、构建器）
│   ├── skills/                 # Skill 注册与执行
│   ├── storage/                # 存储层（数据库、索引写入、路径解析、文件锁、迁移服务）
│   ├── tools/                  # 工具会话解析器（Codex/Claude Code/Cursor/Markdown/Text）
│   ├── vector/                 # 向量模块（生成、索引、排序、检索）
│   └── validation.ts           # 通用校验
│
├── server/                     # 服务端基础设施
│   ├── listener/               # 对话监听服务
│   ├── pipelines/              # 数据处理管线（去重、格式化、分割、JSON 管线）
│   ├── schedulers/             # 后台调度器（审计、清理、向量、保留、MCP采集、浏览器采集）
│   ├── services/               # 核心服务（审计、配置、记忆、编排器、画像更新、存储迁移）
│   └── watchers/               # 文件监听器（memory-root + 工具目录）
│
└── types/                      # TypeScript 类型定义
    ├── api.ts                  # API 请求/响应类型
    ├── config.ts               # 配置类型（AI/MCP/Skills/Storage/ToolSource）
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

### 采集链路

工具目录监听 / 浏览器采集 → `session-parser.ts` / `history-collector.ts` → `MemoryService.stageCreateMemory` → 进入记忆链路

### 后台任务

`instrumentation.ts` 启动时注册六个调度器：

| 调度器 | 职责 |
|--------|------|
| `AuditScheduler` | 定时审计待处理事件 |
| `CleanupScheduler` | 定时清理过期数据 |
| `VectorScheduler` | 定时重建向量索引 |
| `RetentionScheduler` | 记忆压缩与遗忘 |
| `McpCollectScheduler` | MCP 服务器数据采集 |
| `BrowserCollectScheduler` | 浏览器历史/书签采集（默认关闭） |

同时启动 `ToolDirWatcher`（本地工具目录监听）和 `FileWatcher`（笔记文件监听）。

## 本地存储

记忆以 Markdown 文件 + SQLite 数据库存储在本地：

```
memory-root/                      # 笔记根目录（可在设置面板修改位置）
├── memory.db                     # SQLite 数据库（路径固定，不随笔记迁移）
├── index-map.md                  # 全局索引
├── profile.md                    # 用户画像
├── profile-changelog.jsonl       # 画像变更历史
├── notes/                        # 记忆文件（按主题分目录）
│   ├── topic-a/
│   │   ├── Agent.md              # 主题摘要（YAML frontmatter + wikilink）
│   │   └── note-*.md             # 具体记忆
│   └── ...
└── archive/                      # 归档与快照
    ├── audits/                   # 审计报告
    ├── failures/                 # 失败记录
    └── deleted/                  # 已删除记忆
```

### 存储路径说明

- **数据库路径**：始终在 `env.MEMORY_ROOT/memory.db`，启动时确定，永不改变
- **笔记路径**：在设置面板「存储路径」中可随时修改，支持自动迁移到大容量分区
- **数据库与笔记分离**：数据库留在 SSD（性能优先），笔记可放 D 盘大容量分区

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
| `/api/profile` | GET / POST | 用户画像查看 / 手动触发分析 |
| `/api/config/ai` | GET / PUT | AI 配置读写 |
| `/api/config/storage` | GET / POST / PATCH | 存储路径配置（热重载 + 预览迁移） |
| `/api/config/tool-sources` | GET / POST | 工具采集源列表 / 创建 |
| `/api/config/tool-sources/[id]` | PUT / DELETE | 更新 / 删除采集源 |
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
| `StorageConfig` | `types/config.ts` | 存储路径配置（notesPath、updatedAt） |
| `ToolWatchSource` | `types/config.ts` | 工具采集源（toolType、path、filePattern、enabled） |

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

## 配置

1. 复制 `.env.example` 为 `.env.local`
2. 填入 AI 配置：
   - `AI_PROVIDER=openai` 或 `anthropic`
   - `AI_BASE_URL=https://api.openai.com/v1`
   - `AI_API_KEY=sk-xxx`
   - `AI_CHAT_MODEL=gpt-4o`
   - `AI_EMBEDDING_MODEL=text-embedding-3-small`
3. 可选配置：
   - `MEMORY_ROOT=./memory-root` — 数据库与默认笔记路径
   - `BROWSER_COLLECT_ENABLED=false` — 浏览器采集开关（涉及隐私，默认关闭）

配置也可在运行后通过前端设置面板在线修改，数据存储在 `memory-root/memory.db` 中。

## 文档分工

| 文档 | 读者 | 内容 |
|------|------|------|
| `README.md` | 开发者 | 项目架构、快速开始、API 一览 |
| `AGENTS.md` | AI Agent | 项目约定、架构细节、开发规范 |
| `架构检查文档.md` | 验收 | 架构验收要点与完成度判定标准 |

## Native Module Troubleshooting

This project uses `better-sqlite3`, which ships native Node.js bindings. Use Node.js `>=20 <23` with npm `>=10`.

If tests or startup fail with a `NODE_MODULE_VERSION` mismatch, rebuild native modules for the active Node.js version:

```bash
npm rebuild better-sqlite3
```

If the mismatch remains, remove `node_modules` and reinstall with the same Node.js version you use to run the app.
