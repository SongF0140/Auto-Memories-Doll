import { ModelAdapter } from "../../lib/ai/model-adapter";

export type IntentType = "chat" | "system_command";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, string>;
  matchedKeywords: string[];
}

/** budget LLM 提取的记忆结构化实体 */
export interface ExtractedMemoryEntity {
  title: string;
  content: string;
  tags: string[];
  topic: string;
}

/**
 * 用户意图分类器（第九块契约）
 *
 * 明确的记忆操作只能来自整条斜杠命令（/remember、/search、/correct、/delete）
 * 或 UI 结构化 action；自然语言中的"删除/记录/更新/查询"等字样一律视为
 * 普通对话（chat），不再做关键词截获或语义猜测。
 */
export class ChatClassifier {
  classify(text: string): IntentResult {
    const trimmed = text.trim();

    // system_command 由 / 开头判定（整条命令）
    if (trimmed.startsWith("/")) {
      return {
        type: "system_command",
        confidence: 0.95,
        entities: { command: trimmed.substring(1) },
        matchedKeywords: [],
      };
    }

    return { type: "chat", confidence: 1, entities: {}, matchedKeywords: [] };
  }

  /** 与 classify 行为一致；保留异步签名以兼容既有调用方 */
  async classifyAsync(text: string): Promise<IntentResult> {
    return this.classify(text);
  }

  // ── budget LLM 实体提取（显式创建命令时的结构化辅助） ──

  /** budget 模型提取记忆结构化字段 */
  async extractMemoryEntity(userText: string): Promise<ExtractedMemoryEntity | null> {
    const prompt = `从用户消息中提取记忆信息，返回严格的 JSON 格式（不要包含 markdown 标记）：
{
  "title": "记忆标题（20字以内）",
  "content": "记忆正文内容",
  "tags": ["标签1", "标签2"],
  "topic": "所属主题分类（如 ai、前端、后端、工具 等）"
}

如果消息中不包含可提取的记忆内容，返回：
{ "title": "", "content": "", "tags": [], "topic": "" }

用户消息：${userText}`;

    try {
      const response = await ModelAdapter.generate(prompt, "budget");
      const jsonStr = response.content.trim();

      // 清理可能的 markdown 代码块包裹
      const cleanJson = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

      const parsed = JSON.parse(cleanJson) as Partial<ExtractedMemoryEntity>;

      if (!parsed.title && !parsed.content) return null;

      return {
        title: parsed.title || "",
        content: parsed.content || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
        topic: parsed.topic || "",
      };
    } catch {
      return null;
    }
  }
}
