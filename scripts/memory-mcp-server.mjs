/**
 * auto-memeries-doll MCP 暴露端启动器（stdio）。
 *
 * 注册到外部 agent（Claude Code / Codex 等）的 MCP 配置：
 *   command: node
 *   args:    ["<项目绝对路径>/scripts/memory-mcp-server.mjs"]
 *
 * 为什么需要启动器而不能直接跑 TS 入口：
 * 1. console 日志必须与 stdout 隔离 —— stdio 传输下 stdout 是 JSON-RPC 协议
 *    通道，共享 logger 的 console 输出会污染协议流，全部改道 stderr。
 * 2. MEMORY_ROOT 默认按 cwd 解析（./memory-root），而 MCP 子进程的 cwd 由
 *    宿主 agent 决定、不可控 —— 未显式设置时固定为项目内绝对路径，保证与
 *    主应用打开同一个 memory.db。
 * 3. 项目源码是 TypeScript，用 tsx 的进程内 API 注册 loader 后再加载入口。
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// stdout 是 MCP 协议通道：console.log/info（stdout 系）改道 stderr；
// console.warn/error 本就写 stderr，一并显式改道以防运行环境差异。
console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

if (!process.env.MEMORY_ROOT) {
  process.env.MEMORY_ROOT = join(projectRoot, "memory-root");
}

// 注册 tsx 双钩子：ESM loader 负责 import 入口；CJS 钩子负责入口内部
// 无扩展名的相对导入（.ts 源码按 package.json 的 commonjs 语义编译为 CJS）
await import("tsx/cjs");
const { register } = await import("tsx/esm/api");
register();

const { main } = await import(
  pathToFileURL(join(projectRoot, "src/server/mcp/expose-server.ts")).href
);

await main();
