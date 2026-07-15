# Auto-Memories-Doll API 文档

## 概述

Auto-Memories-Doll 是一个基于 Next.js + TypeScript 的 AI 记忆管理系统，提供聊天、记忆存储与检索、提示词管理、数据导入和审计等功能。

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS 3
- **数据库**: SQLite (better-sqlite3)
- **AI**: Vercel AI SDK

## API 路由

### 聊天接口

#### POST /api/chat

发送聊天消息，获取 AI 响应。

**请求体**:
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" }
  ],
  "mode": "chat",
  "sessionId": "default"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| messages | ChatMessage[] | 是 | 消息列表 |
| mode | "chat" \| "memory" | 否 | 模式，默认 chat |
| sessionId | string | 否 | 会话 ID |

**响应**:
```json
{
  "content": "AI response content",
  "memoryReferences": []
}
```

#### POST /api/chat/stream

流式发送聊天消息，获取实时响应。

**请求体**: 同 `/api/chat`

**响应**: Server-Sent Events (SSE)
```
data: {"content": "Hello"}

data: {"content": " world"}

data: {"done": true}
```

### 记忆管理接口

#### GET /api/memory

获取记忆列表。

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 20 | 每页数量 |
| tag | string | - | 按标签筛选 |
| sortBy | string | updatedAt | 排序字段 |
| sortOrder | string | desc | 排序方向 |

**响应**:
```json
[
  {
    "id": "mem_abc123",
    "version": 1,
    "title": "My Memory",
    "summary": "A brief summary...",
    "tags": ["tag1", "tag2"],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "heatScore": 0.85
  }
]
```

#### POST /api/memory

创建新记忆。

**请求体**:
```json
{
  "source": "manual",
  "sourceType": "manual",
  "title": "My Memory",
  "content": "Full content here...",
  "tags": ["tag1", "tag2"]
}
```

**响应**: 返回创建的记忆对象。

#### GET /api/memory/[id]

获取单个记忆详情。

**响应**: 返回记忆对象。

#### PUT /api/memory/[id]

更新记忆。

**请求体**:
```json
{
  "title": "Updated Title",
  "content": "Updated content",
  "tags": ["new-tag"]
}
```

**响应**: 返回更新后的记忆对象。

#### DELETE /api/memory/[id]

删除记忆。

**响应**:
```json
{ "success": true }
```

#### GET /api/memory/search

搜索记忆（向量检索）。

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| limit | number | 否 | 返回数量，默认 10 |

**响应**:
```json
{
  "results": [
    {
      "id": "mem_abc123",
      "title": "Memory Title",
      "summary": "...",
      "similarity": 0.95
    }
  ]
}
```

### 提示词管理接口

#### GET /api/prompt

获取所有提示词模板。

**响应**:
```json
[
  {
    "id": "template-1",
    "name": "My Template",
    "content": "Hello {{name}}",
    "variables": ["name"],
    "description": "A simple greeting template"
  }
]
```

#### POST /api/prompt

创建提示词模板。

**请求体**:
```json
{
  "id": "template-1",
  "name": "My Template",
  "content": "Hello {{name}}",
  "variables": ["name"],
  "description": "A simple greeting template"
}
```

#### GET /api/prompt/[id]

获取单个提示词模板。

#### PUT /api/prompt/[id]

更新提示词模板。

**请求体**:
```json
{
  "name": "Updated Name",
  "content": "Updated content",
  "variables": ["name", "newVar"],
  "description": "Updated description"
}
```

#### DELETE /api/prompt/[id]

删除提示词模板。

### 数据导入接口

#### POST /api/ingest

导入外部数据。

**请求体**:
```json
{
  "content": "{\"title\": \"Test\", \"content\": \"Hello\"}",
  "format": "json"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 导入内容 |
| format | "text" \| "json" | 否 | 格式，默认 text |

**响应**:
```json
{
  "success": true,
  "memories": [...]
}
```

### 审计接口

#### GET /api/audit

获取审计报告。

**响应**:
```json
{
  "totalMemories": 100,
  "pendingEvents": 5,
  "conflicts": 2,
  "lastAuditTime": "2024-01-01T00:00:00Z",
  "stats": {
    "bySourceType": { "chat": 50, "manual": 50 },
    "byCategory": { "knowledge": 60, "experience": 40 }
  }
}
```

#### POST /api/audit

执行审计操作。

**请求体**:
```json
{
  "action": "replay"
}
```

#### GET /api/audit/conflicts

获取冲突列表。

**响应**: 返回冲突记录数组。

#### POST /api/audit/conflicts

解决冲突。

**请求体**:
```json
{
  "conflictId": "conflict-123",
  "resolution": "accept_new",
  "mergedContent": "Merged content here"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conflictId | string | 是 | 冲突 ID |
| resolution | "accept_new" \| "keep_old" \| "merge" | 是 | 解决方式 |
| mergedContent | string | 否 | 合并后的内容（仅 merge 需要） |

## 核心类型定义

### ChatMessage

```typescript
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
```

### MemoryRecord

```typescript
interface MemoryRecord {
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
}
```

### PromptTemplate

```typescript
interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  description?: string;
}
```

## 数据流架构

```
用户输入 -> Entry Layer (API Routes) -> Fast Track Layer (Features)
    -> Background Processing Layer (Workers/Pipelines)
    -> Audit & Persistence Layer (Services)
```

### 四层处理架构

1. **Entry Layer**: API 路由入口，处理 HTTP 请求
2. **Fast Track Layer**: 功能模块，包含分类器、提取器、处理器
3. **Background Processing Layer**: 后台任务处理，包括向量索引、审计、清理
4. **Audit & Persistence Layer**: 数据持久化和审计服务

## 记忆管理流程

1. **输入**: 用户通过聊天或手动输入内容
2. **分类**: ChatClassifier 识别意图类型
3. **提取**: ChatExtractor 从消息中提取记忆信息
4. **存储**: MemoryService 保存到 SQLite 数据库
5. **向量索引**: VectorWorker 异步生成嵌入向量并建立索引
6. **检索**: VectorRetriever 通过相似度搜索找到相关记忆
7. **排序**: Ranker 根据热度和相关性排序结果

## 启动项目

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 生产模式
npm start
```

## 环境变量

```env
MODEL_BASE_URL=https://api.example.com
MODEL_API_KEY=your-api-key
DATABASE_PATH=./data/memory.db
VECTOR_INDEX_PATH=./data/vector
```

## 文件结构

```
src/
├── types/              # 类型定义
├── config/             # 配置文件
├── lib/                # 核心库
│   ├── memory/         # 记忆操作
│   ├── vector/         # 向量检索
│   ├── graph/          # 图关系
│   ├── storage/        # 文件存储
│   ├── ai/             # AI 模型适配
│   ├── prompt/         # 提示词管理
│   └── utils/          # 工具函数
├── server/             # 服务层
│   ├── services/       # 业务服务
│   ├── workers/        # 后台工作器
│   ├── pipelines/      # 数据处理管道
│   └── schedulers/     # 定时任务调度
├── features/           # 功能模块
│   ├── chat/           # 聊天功能
│   ├── memory/         # 记忆管理
│   ├── prompt/         # 提示词管理
│   ├── ingest/         # 数据导入
│   └── audit/          # 审计功能
├── app/                # Next.js App Router
│   ├── api/            # API 路由
│   └── components/     # 前端组件
```

## 关键功能说明

### 意图识别

系统通过 `ChatClassifier` 自动识别用户输入的意图：
- `chat`: 普通聊天
- `memory_create`: 创建记忆（包含"记住"、"保存"等关键词）
- `memory_query`: 查询记忆（包含"查询"、"搜索"等关键词）
- `memory_update`: 更新记忆
- `memory_delete`: 删除记忆
- `prompt_edit`: 编辑提示词
- `system_command`: 系统命令（以 `/` 开头）

### 记忆热度评分

记忆的热度评分基于以下因素：
1. **访问频率**: 被访问次数越多，评分越高
2. **时效性**: 最近更新的记忆评分更高
3. **标签匹配度**: 与用户画像标签匹配度越高，评分越高

### 向量检索

使用 `sqlite-vec` 扩展实现向量相似度搜索，支持：
- 嵌入向量生成
- 向量索引建立
- KNN 相似度搜索
- 混合排序（热度 + 相似度）

### 审计与冲突解决

系统自动处理数据冲突：
- 版本管理：每次更新生成新版本
- 冲突检测：检测并发修改冲突
- 自动重试：失败操作自动重试
- 冲突解决：支持接受新版本、保留旧版本或手动合并