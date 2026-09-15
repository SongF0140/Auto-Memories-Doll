import { join } from "path";
import { ToolType } from "../types/config";

/**
 * 常见本地工具的预设路径，供监听源自动 seed（零配置）与前端快速添加。
 *
 * 放在独立模块而非 route.ts 中，因为 Next.js App Router 的 route 文件
 * 只允许导出 HTTP 方法函数（GET/POST 等），不能导出其他常量。
 */

export type ToolPreset = {
  name: string;
  toolType: ToolType;
  path: string;
  filePattern: string;
  topic: string;
};

function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * 各工具会话目录的真实位置（跨平台，2026-09 核实）：
 * - Codex CLI：Unix ~/.codex/sessions；Windows 用 %APPDATA%\codex（CODEX_HOME 默认值）。
 *   会话按日期嵌套 sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl，filePattern 需 ** 递归。
 * - Claude Code：~/.claude/projects/<编码路径>/<会话>.jsonl。
 * - Cursor Agent：~/.cursor/projects/<项目>/agent-transcripts/<会话>/<会话>.jsonl
 *   （IDE 侧栏聊天存在 SQLite 里，不做文件监听）。
 * - Trae 国内版：~/.trae-cn/memory；国际版：~/.trae/memory。
 */
export function getToolPresets(): Record<string, ToolPreset> {
  return {
    codex: {
      name: "Codex CLI",
      toolType: "codex",
      path: isWindows() ? "%APPDATA%/codex/sessions" : "~/.codex/sessions",
      filePattern: "**/*.jsonl",
      topic: "codex-sessions",
    },
    "claude-code": {
      name: "Claude Code",
      toolType: "claude-code",
      path: "~/.claude/projects",
      filePattern: "**/*.jsonl",
      topic: "claude-code-sessions",
    },
    cursor: {
      name: "Cursor",
      toolType: "cursor",
      path: "~/.cursor/projects",
      filePattern: "**/*.jsonl",
      topic: "cursor-sessions",
    },
    trae: {
      name: "Trae 会话记忆",
      toolType: "trae",
      path: "~/.trae-cn/memory",
      filePattern: "**/*.jsonl",
      topic: "tool-sessions",
    },
    "trae-intl": {
      name: "Trae 国际版",
      toolType: "trae",
      path: "~/.trae/memory",
      filePattern: "**/*.jsonl",
      topic: "tool-sessions",
    },
  };
}

/**
 * 展开监听源路径中的平台占位符：
 * - `~` → 用户主目录（USERPROFILE / HOME）
 * - `%APPDATA%` → Windows Roaming 配置目录
 * 无法展开时原样返回（由调用方报错）。
 */
export function expandSourcePath(path: string): string {
  if (path.startsWith("%APPDATA%")) {
    const appData = process.env.APPDATA;
    return appData ? path.replace("%APPDATA%", appData) : path;
  }
  if (path.startsWith("~")) {
    const homeDir = process.env.USERPROFILE || process.env.HOME;
    if (!homeDir) return path;
    const rest = path.slice(1).replace(/^[/\\]/, "");
    return rest ? join(homeDir, rest) : homeDir;
  }
  return path;
}

/** 工具类型 → 默认话题（用户未指定 topic 的监听源落卡时使用） */
export function defaultTopicForTool(toolType: string): string {
  for (const preset of Object.values(getToolPresets())) {
    if (preset.toolType === toolType) return preset.topic;
  }
  return "tool-sessions";
}
