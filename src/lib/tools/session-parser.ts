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

// ── 各工具类型的解析器 ──

/**
 * Codex CLI 会话文件解析。
 * ~/.codex/sessions/ 下的 jsonl 文件，每行一个 JSON 事件。
 */
async function parseCodex(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const lines = fileContent.split("\n");

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj || typeof obj !== "object") continue;

    const o = obj as Record<string, unknown>;
    // codex 事件格式: {type: "message"|"response"|"function_call", payload: {...}}
    // 也兼容 {role, content} 直接格式
    const role = extractRole(o.payload || o);
    const content = extractContent(o.payload || o);
    if (content.trim()) {
      messages.push({ role, content });
    }
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
 */
async function parseClaudeCode(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const lines = fileContent.split("\n");

  for (const line of lines) {
    const obj = tryParseJson(line);
    if (!obj || typeof obj !== "object") continue;

    const o = obj as Record<string, unknown>;
    // claude-code 格式: {type: "user"|"assistant", message: {role, content}}
    const msgObj = o.message || o;
    const role = extractRole(msgObj);
    const content = extractContent(msgObj);
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
 * 通常为 JSON 数组或包含 messages 字段的对象。
 */
async function parseCursor(fileContent: string, filePath: string): Promise<ParsedSession> {
  const messages: RawMessage[] = [];
  const obj = tryParseJson(fileContent);

  if (obj && typeof obj === "object") {
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
    case "markdown":
      return parseMarkdown(content, filePath);
    case "text":
      return parseText(content, filePath);
    default:
      return parseText(content, filePath);
  }
}
