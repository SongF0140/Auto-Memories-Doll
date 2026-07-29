# 项目依赖说明

## 运行时依赖 (dependencies)

| 包名 | 版本 | 用途 |
|------|------|------|
| `next` | ^14.0.0 | React 全栈框架，提供路由、SSR、API 路由 |
| `react` | ^18.2.0 | 前端 UI 组件库 |
| `react-dom` | ^18.2.0 | React DOM 渲染器 |
| `ai` | ^7.0.34 | Vercel AI SDK，提供流式 AI 对话和多模型适配 |
| `@ai-sdk/openai` | ^4.0.17 | OpenAI / OpenAI-compatible API 适配器 |
| `@ai-sdk/anthropic` | ^4.0.18 | Anthropic Claude API 适配器 |
| `better-sqlite3` | ^12.11.1 | 本地 SQLite 数据库（向量存储、事件队列） |
| `chokidar` | ^5.0.0 | 文件系统监听（实时检测文件变更） |
| `clsx` | ^2.1.1 | className 条件拼接工具 |
| `tailwind-merge` | ^3.6.0 | Tailwind CSS 类名合并去重 |
| `framer-motion` | ^12.42.2 | React 动画库（UI 动效） |
| `typescript` | ^5.3.2 | TypeScript 语言 |
| `zod` | ^4.4.3 | Schema 声明与数据校验 |
| `@types/node` | ^20.10.0 | Node.js 类型声明 |
| `@types/react` | ^18.2.40 | React 类型声明 |
| `@types/react-dom` | ^18.2.17 | ReactDOM 类型声明 |

## 开发依赖 (devDependencies)

| 包名 | 版本 | 用途 |
|------|------|------|
| `eslint` | ^10.8.0 | 代码静态分析与规范检查 |
| `eslint-config-next` | ^16.2.12 | Next.js 项目的 ESLint 推荐规则 |
| `eslint-config-prettier` | ^10.1.8 | 关闭 ESLint 中与 Prettier 冲突的规则 |
| `@eslint/js` | ^10.0.1 | ESLint 内置推荐规则 |
| `typescript-eslint` | ^8.65.0 | TypeScript ESLint 插件 |
| `@next/eslint-plugin-next` | ^16.2.12 | Next.js ESLint 插件 |
| `prettier` | ^3.9.6 | 代码格式化工具 |
| `tailwindcss` | ^3.3.6 | 原子化 CSS 框架 |
| `autoprefixer` | ^10.4.16 | CSS 自动添加浏览器前缀 |
| `postcss` | ^8.4.32 | CSS 处理工具（Tailwind CSS 依赖） |
| `@types/better-sqlite3` | ^7.6.13 | better-sqlite3 类型声明 |

## 安装与更新

```bash
# 安装所有依赖
npm install

# 添加新的生产依赖
npm install <package-name>

# 添加新的开发依赖
npm install --save-dev <package-name>
```
