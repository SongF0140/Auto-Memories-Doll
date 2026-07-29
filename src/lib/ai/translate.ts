/**
 * AI 模型翻译层 —— 第二层翻译，接入配置模型做流式深层翻译。
 *
 * 第一层（translator.ts）：关键词映射，毫秒级，覆盖结构性术语。
 * 第二层（本文件）：调用配置的 LLM 模型，处理复杂长句的流式翻译。
 */
import { generateText, streamText, StreamTextResult } from "ai";
import { createLanguageModel } from "./provider";
import { ModelAdapter } from "./model-adapter";

export interface AiTranslateOptions {
  maxTokens?: number;
  temperature?: number;
}

const TRANSLATION_PROMPT = `You are a precise Chinese translator. Translate the following content into natural, fluent Chinese. 
Rules:
1. Keep technical terms in their original form (React, SQLite, API, etc.)
2. Preserve all formatting, code blocks, and markdown
3. Output ONLY the translation, no explanations
4. Match the original's tone and style

Content to translate:`;

/**
 * 非流式 AI 翻译（用于摘要、标题等短文本）
 */
export async function translateWithAI(
  text: string,
  options: AiTranslateOptions = {},
): Promise<string> {
  // 如果已经是中文为主，跳过
  const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseCharCount > text.length * 0.5) return text;

  if (ModelAdapter.isDegradedMode) return text;

  try {
    const model = createLanguageModel();
    const result = await generateText({
      model,
      messages: [{ role: "user", content: `${TRANSLATION_PROMPT}\n\n${text}` }],
      maxOutputTokens: options.maxTokens || 500,
      temperature: options.temperature || 0.3,
    });

    return result.text.trim() || text;
  } catch {
    return text;
  }
}

/**
 * 流式 AI 翻译（用于长文本、对话内容）
 * 返回 StreamTextResult，调用方可以 pipe 到 SSE 输出
 */
export async function streamTranslate(
  text: string,
  options: AiTranslateOptions = {},
): Promise<StreamTextResult<any, any, any> | null> {
  if (ModelAdapter.isDegradedMode) return null;

  try {
    const model = createLanguageModel();
    return streamText({
      model,
      messages: [{ role: "user", content: `${TRANSLATION_PROMPT}\n\n${text}` }],
      maxOutputTokens: options.maxTokens || 2000,
      temperature: options.temperature || 0.3,
    });
  } catch {
    return null;
  }
}

/**
 * 为 MemoryRecord 生成中文版本字段（AI 深层翻译）
 * 先跑第一层关键词映射，再用 AI 翻译 title 和 summary
 */
export async function translateMemoryFields(
  title: string,
  summary: string,
): Promise<{ titleZh: string; summaryZh: string }> {
  const [titleZh, summaryZh] = await Promise.all([
    translateWithAI(title, { maxTokens: 100 }),
    translateWithAI(summary, { maxTokens: 300 }),
  ]);

  return { titleZh, summaryZh };
}
