import { ToolType } from "../types/config";

/**
 * 常见本地工具的预设路径，供前端快速添加监听源。
 *
 * 放在独立模块而非 route.ts 中，因为 Next.js App Router 的 route 文件
 * 只允许导出 HTTP 方法函数（GET/POST 等），不能导出其他常量。
 */
export const TOOL_PRESETS: Record<
  string,
  { name: string; toolType: ToolType; path: string; filePattern: string }
> = {
  codex: {
    name: "Codex CLI",
    toolType: "codex",
    path: "~/.codex/sessions",
    filePattern: "*.jsonl",
  },
  "claude-code": {
    name: "Claude Code",
    toolType: "claude-code",
    path: "~/.claude/projects",
    filePattern: "**/*.jsonl",
  },
  cursor: {
    name: "Cursor",
    toolType: "cursor",
    path: "~/.cursor/conversations",
    filePattern: "*.json",
  },
};
