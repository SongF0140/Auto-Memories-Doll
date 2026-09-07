/**
 * Locomo 风格评测数据集（I-12）
 *
 * memU 敢报 Locomo 92.09%，我们没有尺子就无法证明任何改进有效。
 * 本数据集仿照 Locomo 的构造方式：多轮会话 → 事后提问，
 * 覆盖单跳（single-hop）/ 多跳（multi-hop）/ 时序（temporal）三类推理。
 *
 * 与 `retrieval-eval` 的差异：那里测"给定一批离散记忆能否召回"，
 * 这里测"跨会话积累的知识能否在正确的时间被正确地取回"，
 * 且固定三组对照（裸模型 / 现行 RAG / 改进后），作为批次三各项改进的验收尺子。
 */

export type LocomoSession = {
  sessionId: string;
  date: string;
  messages: Array<{ speaker: "user" | "assistant"; text: string }>;
};

export type LocomoMemory = {
  id: string;
  title: string;
  content: string;
  summary: string;
  /** I-11 window-use：这条记忆在什么场景下有用（与 summary 共同构成 embedding 键） */
  windowUse: string;
  tags: string[];
  topic: string;
  createdAt: string;
};

export type LocomoQuestion = {
  question: string;
  /** 标准答案 memoryId */
  expected: string;
  category: "single-hop" | "multi-hop" | "temporal";
};

export const LOCOMO_SESSIONS: LocomoSession[] = [
  {
    sessionId: "s1",
    date: "2026-03-02",
    messages: [
      { speaker: "user", text: "新项目脚手架我不想用 create-react-app 了，太慢。" },
      {
        speaker: "assistant",
        text: "建议改用 Vite：冷启动毫秒级，HMR 即时生效。2026-03-02 决定采用 Vite 作为构建工具。",
      },
      { speaker: "user", text: "包管理器用 pnpm，磁盘占用小而且 monorepo 支持好。" },
      {
        speaker: "assistant",
        text: "好，包管理器锁定 pnpm，提交 package.json 的 packageManager 字段。",
      },
      { speaker: "user", text: "TypeScript 开 strict 模式，别留 any。" },
    ],
  },
  {
    sessionId: "s2",
    date: "2026-03-10",
    messages: [
      { speaker: "user", text: "数据库我想从 MySQL 换成 PostgreSQL。" },
      {
        speaker: "assistant",
        text: "2026-03-10 决定：迁移到 PostgreSQL。原因是需要 JSONB 字段和数组类型，MySQL 的 JSON 支持太弱。",
      },
      { speaker: "user", text: "ORM 用 Drizzle 吧，类型推导好。" },
    ],
  },
  {
    sessionId: "s3",
    date: "2026-03-18",
    messages: [
      { speaker: "user", text: "我不打算自己维护服务器了。" },
      {
        speaker: "assistant",
        text: "2026-03-18 决定：部署平台从自建服务器切换到 Vercel，免去运维，预览环境自动生成。",
      },
      { speaker: "user", text: "域名先用 vercel.app 的默认域名。" },
    ],
  },
  {
    sessionId: "s4",
    date: "2026-03-25",
    messages: [
      { speaker: "user", text: "Jest 配置太折腾了，我想换掉。" },
      {
        speaker: "assistant",
        text: "2026-03-25 决定：测试框架从 Jest 迁移到 Vitest，API 兼容且与 Vite 共享配置；端到端测试用 Playwright。",
      },
      { speaker: "user", text: "覆盖率报告用 v8 provider。" },
    ],
  },
  {
    sessionId: "s5",
    date: "2026-04-02",
    messages: [
      { speaker: "user", text: "Redux 的样板代码实在太多了。" },
      {
        speaker: "assistant",
        text: "2026-04-02 决定：状态管理从 Redux 迁移到 Zustand，去掉 action/reducer 样板，直接 useStore。",
      },
      { speaker: "user", text: "服务端数据请求继续用 TanStack Query。" },
    ],
  },
  {
    sessionId: "s6",
    date: "2026-04-09",
    messages: [
      { speaker: "user", text: "CI 用什么？" },
      {
        speaker: "assistant",
        text: "2026-04-09 决定：CI 使用 GitHub Actions，缓存 pnpm store 目录，流水线跑 typecheck、lint、test 三步。",
      },
    ],
  },
];

/** 从会话派生的记忆卡片（每会话 1-2 张，共 9 张） */
export const LOCOMO_MEMORIES: LocomoMemory[] = [
  {
    id: "loc-build",
    title: "构建工具选型 Vite",
    content:
      "2026-03-02 用户决定放弃 create-react-app，改用 Vite 作为构建工具。理由是 CRA 启动慢、依赖陈旧；Vite 冷启动毫秒级，HMR 即时生效。",
    summary: "2026-03-02 决定用 Vite 替代 create-react-app 作为构建工具，因为 CRA 启动慢。",
    windowUse: "当用户问起构建工具、脚手架、create-react-app、Vite 或项目初始化时有用。",
    tags: ["构建", "vite"],
    topic: "project-setup",
    createdAt: "2026-03-02",
  },
  {
    id: "loc-pnpm",
    title: "包管理器锁定 pnpm",
    content:
      "2026-03-02 用户决定包管理器使用 pnpm，理由是磁盘占用小（硬链接共享 store）且对 monorepo workspace 支持好。TypeScript 开启 strict 模式。",
    summary: "包管理器用 pnpm；TypeScript 开 strict 模式。",
    windowUse: "当用户问起包管理器、npm、pnpm、依赖安装或 TypeScript 配置时有用。",
    tags: ["工具链", "pnpm"],
    topic: "project-setup",
    createdAt: "2026-03-02",
  },
  {
    id: "loc-db",
    title: "数据库迁移到 PostgreSQL",
    content:
      "2026-03-10 用户决定把数据库从 MySQL 迁移到 PostgreSQL，原因是业务需要 JSONB 字段和数组类型，MySQL 的 JSON 能力不足。ORM 选型 Drizzle。",
    summary:
      "2026-03-10 决定数据库从 MySQL 迁到 PostgreSQL，因为需要 JSONB 与数组类型；ORM 用 Drizzle。",
    windowUse: "当用户问起数据库选型、MySQL、PostgreSQL、JSONB 或 ORM 时有用。",
    tags: ["数据库", "postgres"],
    topic: "database",
    createdAt: "2026-03-10",
  },
  {
    id: "loc-deploy",
    title: "部署平台切换 Vercel",
    content:
      "2026-03-18 用户决定不再自建服务器，部署平台切换到 Vercel，免去运维负担，每个分支自动生成预览环境；域名暂用 vercel.app 默认域名。",
    summary: "2026-03-18 决定部署用 Vercel 替代自建服务器，域名用 vercel.app。",
    windowUse: "当用户问起部署平台、服务器运维、Vercel 或域名时有用。",
    tags: ["部署", "vercel"],
    topic: "deployment",
    createdAt: "2026-03-18",
  },
  {
    id: "loc-test",
    title: "测试框架迁移 Vitest 与 Playwright",
    content:
      "2026-03-25 用户决定测试框架从 Jest 迁移到 Vitest，API 兼容且与 Vite 共享同一份配置；端到端测试使用 Playwright；覆盖率报告用 v8 provider。",
    summary: "2026-03-25 决定单测用 Vitest 替代 Jest，端到端测试用 Playwright。",
    windowUse: "当用户问起测试框架、Jest、Vitest、端到端测试、Playwright 或覆盖率时有用。",
    tags: ["测试", "vitest"],
    topic: "testing",
    createdAt: "2026-03-25",
  },
  {
    id: "loc-state",
    title: "状态管理迁移 Zustand",
    content:
      "2026-04-02 用户决定状态管理从 Redux 迁移到 Zustand，去掉 action/reducer 样板代码，直接 useStore 读写；服务端数据请求继续使用 TanStack Query。",
    summary: "2026-04-02 决定状态管理从 Redux 迁到 Zustand，因为 Redux 样板代码太多。",
    windowUse: "当用户问起状态管理、Redux、Zustand 或样板代码时有用。",
    tags: ["状态管理", "zustand"],
    topic: "frontend",
    createdAt: "2026-04-02",
  },
  {
    id: "loc-ci",
    title: "CI 使用 GitHub Actions",
    content:
      "2026-04-09 用户决定 CI 使用 GitHub Actions，缓存 pnpm store 目录，流水线依次执行 typecheck、lint、test 三步。",
    summary: "2026-04-09 决定 CI 用 GitHub Actions，缓存 pnpm store。",
    windowUse: "当用户问起 CI、持续集成、GitHub Actions 或流水线时有用。",
    tags: ["ci", "github-actions"],
    topic: "devops",
    createdAt: "2026-04-09",
  },
  {
    id: "loc-ts",
    title: "TypeScript strict 约束",
    content:
      "2026-03-02 项目约定 TypeScript 开启 strict 模式，禁止隐式 any，公共 API 必须显式标注返回类型。",
    summary: "TypeScript 开 strict 模式，禁止隐式 any。",
    windowUse: "当用户问起 TypeScript 类型约束、strict 模式或 any 的使用时有用。",
    tags: ["typescript"],
    topic: "project-setup",
    createdAt: "2026-03-02",
  },
  {
    id: "loc-query",
    title: "服务端数据请求用 TanStack Query",
    content:
      "2026-04-02 用户确认服务端数据请求继续使用 TanStack Query（原 React Query），负责缓存、重试与失效；客户端状态交给 Zustand。",
    summary: "服务端数据请求用 TanStack Query，客户端状态用 Zustand。",
    windowUse: "当用户问起数据请求、缓存、TanStack Query 或 React Query 时有用。",
    tags: ["数据请求"],
    topic: "frontend",
    createdAt: "2026-04-02",
  },
];

/** 事后提问：单跳 4 / 多跳 3 / 时序 3，共 10 题 */
export const LOCOMO_QUESTIONS: LocomoQuestion[] = [
  // ── 单跳 ──
  { question: "用户的项目用什么包管理器？", expected: "loc-pnpm", category: "single-hop" },
  { question: "项目部署在哪个平台？", expected: "loc-deploy", category: "single-hop" },
  { question: "端到端测试用的是哪个工具？", expected: "loc-test", category: "single-hop" },
  { question: "CI 用的是什么工具？", expected: "loc-ci", category: "single-hop" },
  // ── 多跳（需要关联"放弃 X 的原因"） ──
  {
    question: "用户为什么放弃 create-react-app？",
    expected: "loc-build",
    category: "multi-hop",
  },
  {
    question: "状态管理为什么从 Redux 换掉？",
    expected: "loc-state",
    category: "multi-hop",
  },
  {
    question: "数据库为什么从 MySQL 换成 PostgreSQL？",
    expected: "loc-db",
    category: "multi-hop",
  },
  // ── 时序（需要定位决策发生的时间与先后关系） ──
  {
    question: "用户是哪一天决定从 Jest 换成 Vitest 的？",
    expected: "loc-test",
    category: "temporal",
  },
  {
    question: "在决定用 Zustand 之前，用户最后一次调整部署平台是什么时候？",
    expected: "loc-deploy",
    category: "temporal",
  },
  {
    question: "最近一次关于工程化的决定里，CI 流水线跑了哪几步？",
    expected: "loc-ci",
    category: "temporal",
  },
];
