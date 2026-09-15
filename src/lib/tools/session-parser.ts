import { promises as fs } from "fs";
import { basename, extname } from "path";
import { ToolType } from "../../types/config";

/**
 * 解析后的工具会话。
 * 统一格式，不管原始文件是 jsonl / json / md / txt。
 */
export type ParsedSession = {
  /** 自动生成的会话标题（基于文件名或会话首条消息） */
  title: string;
  /** markdown 格式的会话内容（user/assistant 交替） */
  content: string;
  /** 来源工具类型 */
  source: ToolType;
  /** 来源文件路径 */
  sourceFile: string;
  /** 会话时间（从文件内容或文件 mtime 推断） */
  timestamp: string;
  /** 消息条数 */
  messageCount: number;
};

type RawMessage = { role: string; content: string };

/**
 * 把对话消息数组渲染成 markdown。
 */
function renderMessages(messages: RawMessage[], _source: ToolType): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "AI" : msg.role === "user" ? "我" : msg.role;
    lines.push(`### ${role}\n\n${msg.content.trim()}\n`);
  }
  return lines.join("\n");
}

/**
 * 从消息列表提取标题：取第一条 user 消息的前 40 字符。
 */
function extractTitle(messages: RawMessage[], fallback: string): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser && firstUser.content.trim()) {
    const text = firstUser.content.trim().replace(/\n/g, " ");
    return text.length > 40 ? `${text.slice(0, 40)}...` : text;
  }
  return fallback;
}

/**
 * 解析单行 JSON，失败返回 null。
 */
function tryParseJson(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * 从任意对象中递归提取 content 字符串（应对不同工具的字段嵌套）。
 */
function extractContent(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (obj == null || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;

  // 常见字段名优先
  for (const key of ["content", "text", "message", "output", "response"]) {
    if (typeof o[key] === "string") return o[key] as string;
    if (Array.isArray(o[key])) {
      // content 可能是 [{type: "text", text: "..."}] 形式
      const parts = (o[key] as unknown[])
        .map((p) => (typeof p === "object" && p !== null ? extractContent(p) : String(p)))
        .filter(Boolean);
      if (parts.length) return parts.join("\n");
    }
    if (o[key] && typeof o[key] === "object") {
      const sub = extractContent(o[key]);
      if (sub) return sub;
    }
  }
  return "";
}

function extractRole(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) return "user";
  const o = obj as Record<string, unknown>;
  for (const key of ["role", "type", "sender"]) {
    if (typeof o[key] === "string") return o[key] as string;
  }
  return "user";
}

/**
 * 提取"人可读"的对话内容：与 extractContent 的区别是识别 content 数组里的
 * tool_result / tool_use 块（工具调用与输出回灌），这类块不是对话文本，返回空串。
 */
function extractUserVisibleContent(obj: unknown): string {
  if (Array.isArray(obj)) {
    return (obj as unknown[])
      .filter((part) => !isToolBlock(part))
      .map((part) => extractUserVisibleContent(part))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof obj !== "object" || obj === null) {
    return typeof obj === "string" ? obj : "";
  }
  const o = obj as Record<string, unknown>;
  if (isToolBlock(o)) return "";
  // content 数组走过滤路径，否则会退回 extractContent 把 tool_result 一起拼进来
  if (Array.isArray(o.content)) return extractUserVisibleContent(o.content);
  return extractContent(o);
}

function isToolBlock(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ((obj as Record<string, unknown>).type === "tool_result" ||
      (obj as Record<string, unknown>).type === "tool_use")
  );
}

// ── 各工具类型的解析器 ──

/**
 * Codex CLI 会话文件解析。
 * ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl（Windows 为 %APPDATA%/codex/sessions），
 * 每行 {timestamp, type, payload}。
 *
 * 过滤规则（2026-09 核实 rollout 格式）：
 * - session_meta 内嵌完整系统提示（20KB+），turn_context 是每轮快照——都不是对话
 * - function_call / function_call_output / reasoning 等是工具调用与思考块，与人可读对话分离
 * - 同一条消息可能同时记在 response_item 与 event_msg 里，按 角色+内容 去重
 */
const CODEX_SKIP_LINE_TYPES = new Set(["session_meta", "turn_context"]);
const CODEX_SKIP_PAYLOAD_TYPES = new Set([
  "function_call",
  "function_call_output",
  "local_shell_call",
  "local_shell_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "web_search_call",
  "reasoning",
  "token_count",
  "turn_completed",
  "turn_failed",
  "task_started",
  "task_complete",
]);
const CODEX_ROLE_ALIASES: Record<string, string> = {
  user_message: "user",
  agent_message: "assistant",
  compacted: "assistant",
};

async function parseCodex(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const seen = new Set<string>();
  const lines = fileContent.split("\n");

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj || typeof obj !== "object") continue;

    const o = obj as Record<string, unknown>;
    if (CODEX_SKIP_LINE_TYPES.has(String(o.type))) continue;

    const payload = (o.payload && typeof o.payload === "object" ? o.payload : o) as Record<
      string,
      unknown
    >;
    if (CODEX_SKIP_PAYLOAD_TYPES.has(String(payload.type))) continue;

    const roleRaw = extractRole(payload);
    const role = CODEX_ROLE_ALIASES[roleRaw] ?? roleRaw;
    const content = extractContent(payload).trim();
    if (!content) continue;

    const dedupKey = `${role}:${content}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    messages.push({ role, content });
  }

  const title = extractTitle(messages, basename(filePath, extname(filePath)));
  return {
    title,
    content: renderMessages(messages, "codex"),
    source: "codex",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: messages.length,
  };
}

/**
 * Claude Code 会话文件解析。
 * ~/.claude/projects/ 下的 jsonl 文件，每行一个消息。
 *
 * 过滤规则（减少抽卡噪声）：
 * - isMeta: true 的 user 行是 Claude Code 自动注入的系统提示（如 slash 命令展开），非真实用户输入
 * - type 为 summary / file-history-snapshot / system 的是会话元数据行，不是对话内容
 * - user 消息 content 数组中 type: "tool_result" 的是工具输出回灌，混进用户发言会污染卡片
 */
async function parseClaudeCode(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const lines = fileContent.split("\n");

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj || typeof obj !== "object") continue;

    const o = obj as Record<string, unknown>;
    if (o.isMeta === true) continue;
    if (
      o.type === "summary" ||
      o.type === "file-history-snapshot" ||
      o.type === "system" ||
      o.type === "progress"
    ) {
      continue;
    }

    // claude-code 格式: {type: "user"|"assistant", message: {role, content}}
    const msgObj = o.message || o;
    const role = extractRole(msgObj);
    const content = extractUserVisibleContent(msgObj);
    if (content.trim()) {
      messages.push({ role, content });
    }
  }

  const title = extractTitle(messages, basename(filePath, extname(filePath)));
  return {
    title,
    content: renderMessages(messages, "claude-code"),
    source: "claude-code",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: messages.length,
  };
}

/**
 * Cursor 对话文件解析。
 * 两种格式：
 * - JSON 数组或含 messages 字段的对象（手动导出等场景）
 * - Cursor Agent transcript（~/.cursor/projects/<项目>/agent-transcripts/ 下
 *   的 .jsonl，每行一个事件）——整体 JSON.parse 失败时逐行解析兜底
 */
async function parseCursor(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const obj = tryParseJson(fileContent);

  if (obj) {
    let msgList: unknown[] = [];
    if (Array.isArray(obj)) {
      msgList = obj;
    } else if (Array.isArray((obj as Record<string, unknown>).messages)) {
      msgList = (obj as Record<string, unknown>).messages as unknown[];
    }

    for (const m of msgList) {
      const role = extractRole(m);
      const content = extractContent(m);
      if (content.trim()) {
        messages.push({ role, content });
      }
    }
  } else {
    // jsonl 兜底：逐行解析事件，过滤工具块（tool_use / tool_result）
    for (const line of fileContent.split("\n")) {
      const row = tryParseJson(line);
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const msgObj = o.message && typeof o.message === "object" ? o.message : o;
      const role = extractRole(msgObj);
      const content = extractUserVisibleContent(msgObj);
      if (content.trim()) {
        messages.push({ role, content });
      }
    }
  }

  const title = extractTitle(messages, basename(filePath, extname(filePath)));
  return {
    title,
    content: renderMessages(messages, "cursor"),
    source: "cursor",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: messages.length,
  };
}

/**
 * Trae 会话记忆解析。
 * ~/.trae-cn/memory/projects/ 下的 jsonl 文件，每行一条结构化摘要：
 * {intent, actions[], outcome, learned[], message_summary_time, message_id}
 * 渲染为 LLM 友好的中文 Markdown。
 */
async function parseTrae(fileContent: string, filePath: string): Promise<ParsedSession> {
  const lines = fileContent.split("\n");
  const sections: string[] = [];
  let title = "";

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    const intent = typeof o.intent === "string" ? o.intent.trim() : "";
    if (!intent) continue;

    if (!title) {
      title = intent.length > 40 ? `${intent.slice(0, 40)}...` : intent;
    }

    const parts: string[] = [`### 意图\n\n${intent}`];
    const actions = Array.isArray(o.actions)
      ? (o.actions as unknown[]).filter(
          (a): a is string => typeof a === "string" && a.trim().length > 0,
        )
      : [];
    if (actions.length) parts.push(`**动作**：${actions.join("；")}`);
    if (typeof o.outcome === "string" && o.outcome.trim())
      parts.push(`**结果**：${o.outcome.trim()}`);
    const learned = Array.isArray(o.learned)
      ? (o.learned as unknown[]).filter(
          (l): l is string => typeof l === "string" && l.trim().length > 0,
        )
      : [];
    if (learned.length) parts.push(`**经验**：${learned.join("；")}`);
    if (typeof o.message_summary_time === "string" && o.message_summary_time.trim()) {
      parts.push(`**时间**：${o.message_summary_time.trim()}`);
    }
    sections.push(parts.join("\n\n"));
  }

  return {
    title: title || basename(filePath, extname(filePath)),
    content: sections.join("\n\n"),
    source: "trae",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: sections.length,
  };
}

/**
 * Markdown 文件直接作为笔记内容。
 */
async function parseMarkdown(fileContent: string, filePath: string): Promise<ParsedSession> {
  const fileName = basename(filePath, extname(filePath));
  // 取第一行 # 标题作为 title，否则用文件名
  const firstHeading = fileContent.match(/^#\s+(.+)$/m);
  const title = firstHeading ? firstHeading[1].trim() : fileName;
  return {
    title,
    content: fileContent,
    source: "markdown",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: 1,
  };
}

/**
 * 纯文本文件直接作为笔记内容。
 */
async function parseText(fileContent: string, filePath: string): Promise<ParsedSession> {
  const fileName = basename(filePath, extname(filePath));
  return {
    title: fileName,
    content: fileContent,
    source: "text",
    sourceFile: filePath,
    timestamp: new Date().toISOString(),
    messageCount: 1,
  };
}

/**
 * 主入口：根据工具类型分发解析器。
 */
export async function parseSession(
  filePath: string,
  toolType: ToolType,
): Promise<ParsedSession | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  // 空文件跳过
  if (!content.trim()) return null;

  switch (toolType) {
    case "codex":
      return parseCodex(content, filePath);
    case "claude-code":
      return parseClaudeCode(content, filePath);
    case "cursor":
      return parseCursor(content, filePath);
    case "trae":
      return parseTrae(content, filePath);
    case "markdown":
      return parseMarkdown(content, filePath);
    case "text":
      return parseText(content, filePath);
    default:
      return parseText(content, filePath);
  }
}
