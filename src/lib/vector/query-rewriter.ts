import { ModelAdapter } from "../ai/model-adapter";
import { QUERY_REWRITE_MAX_CHARS, QUERY_REWRITE_MAX_VARIANTS } from "../../config/constants";
import { logger } from "../logger";

/** query 过短时改写收益低，直接跳过 */
const MIN_QUERY_LENGTH_FOR_REWRITE = 4;

/**
 * 用 budget 模型把用户原始查询改写成若干语义等价的检索变体，
 * 用于多路召回（见 query-expansion）。
 *
 * 设计要点：
 * - 完全可降级：模型不可用 / 输出异常时返回空数组，调用方退回单路召回；
 * - 严格解析：只接受 {"variants": [...]} JSON，解析失败视为无效输出；
 * - 不改写原句：原句始终作为第一路召回，变体只做补充。
 */
export async function rewriteQueryVariants(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH_FOR_REWRITE) return [];

  const prompt = buildRewritePrompt(trimmed);
  try {
    const response = await ModelAdapter.generate(prompt, "budget");
    if (response.finishReason === "degraded") return [];
    return parseVariants(response.content, trimmed);
  } catch (err) {
    logger.vector.warn("query 改写失败，退回单路召回", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function buildRewritePrompt(query: string): string {
  return [
    "你是检索查询改写器。把用户查询改写成语义相同但措辞不同的检索短语，帮助召回相关记忆。",
    `要求：最多生成 ${QUERY_REWRITE_MAX_VARIANTS} 个变体；每个变体不超过 ${QUERY_REWRITE_MAX_CHARS} 个字符；保留关键实体与数字；不要回答查询本身。`,
    "只输出 JSON，格式：{\"variants\": [\"变体1\", \"变体2\"]}",
    "",
    `用户查询：${query}`,
  ].join("\n");
}

/** 从模型输出中提取合法变体；任何异常结构都返回空数组 */
export function parseVariants(raw: string, originalQuery: string): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  const variants = (parsed as { variants?: unknown })?.variants;
  if (!Array.isArray(variants)) return [];

  const seen = new Set<string>([originalQuery.trim()]);
  const result: string[] = [];
  for (const item of variants) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim();
    if (cleaned.length < 2 || cleaned.length > QUERY_REWRITE_MAX_CHARS) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= QUERY_REWRITE_MAX_VARIANTS) break;
  }
  return result;
}
