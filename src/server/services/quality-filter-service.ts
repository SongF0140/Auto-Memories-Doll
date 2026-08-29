import { MemoryRecord, MemoryKind } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

/** 相似记忆提示：给闸门提供"库里已有什么"的参考上下文，用于判断新颖性 */
export type SimilarMemoryHint = {
  title: string;
  summary: string;
  similarity: number;
};

/**
 * 三态判定结果（fail-closed：闸门不可用时转人工，而不是放行）：
 * - accept: 评分达标，直接入库
 * - reject: 明确低质，终态拒绝（不重试）
 * - review: 评分存疑、闸门不可用、非事实类或缺少证据，转人工裁决
 * kind 为闸门判定的记忆类型（无法判定时缺省视为 fact）
 */
export type QualityFilterResult =
  | { verdict: "accept"; score: number; kind: MemoryKind; reason?: string }
  | { verdict: "reject"; score: number; kind: MemoryKind; reason: string }
  | { verdict: "review"; score?: number; kind?: MemoryKind; reason: string };

/** 评分 ≥ 此值直接入库 */
const ACCEPT_SCORE = 7;
/** 评分 < 此值终态拒绝；两者之间转人工 */
const REJECT_SCORE = 4;
/** 非标准输出时的最大重试次数 */
const MAX_PARSE_ATTEMPTS = 2;

const VALID_KINDS: MemoryKind[] = ["fact", "inference", "hypothesis", "insight"];

/**
 * 强制证据链的入口：内容来自文件/对话原文采集，必须能回溯到原文片段。
 * chat/manual 等入口内容本身即可回溯，暂不强制（避免 review 队列积压）。
 */
const EVIDENCE_REQUIRED_SOURCE_TYPES: MemoryRecord["sourceType"][] = ["ingest", "listen"];

export class QualityFilterService {
  async filter(
    candidate: MemoryRecord,
    similar: SimilarMemoryHint[] = [],
  ): Promise<QualityFilterResult> {
    // 闸门不可用 → 转人工裁决，不放行（fail-closed）
    if (ModelAdapter.isDegradedMode) {
      return { verdict: "review", reason: "质量闸门不可用（模型降级模式），转人工裁决" };
    }

    const prompt = this.buildPrompt(candidate, similar);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        const response = await ModelAdapter.generate(prompt, "flagship");
        const parsed = this.parseVerdict(response.content);
        if (parsed) return this.applyKindAndEvidenceRules(parsed, candidate);
        logger.quality.warn("质量闸门输出非标准 JSON，重试", {
          attempt,
          output: response.content.slice(0, 200),
        });
      } catch (error) {
        logger.quality.warn("质量过滤调用失败，转人工裁决", {
          error: (error as Error).message,
        });
        break;
      }
    }

    return { verdict: "review", reason: "质量闸门输出异常，转人工裁决" };
  }

  /**
   * 内容性质与证据约束（在评分之后叠加）：
   * - 推断/假设/洞察不属于已确证事实 → 只能先进待验证区（review）
   * - 判定为 fact 且评分达标，但没有任何来源证据 → 不得自动入库（review）
   */
  private applyKindAndEvidenceRules(
    result: NonNullable<ReturnType<QualityFilterService["parseVerdict"]>>,
    candidate: MemoryRecord,
  ): QualityFilterResult {
    const kind = result.kind ?? "fact";

    if (result.verdict === "accept") {
      if (kind !== "fact") {
        return {
          verdict: "review",
          score: result.score,
          kind,
          reason: `内容判定为 ${kind}（非事实），进入待验证区等待人工确认`,
        };
      }
      if (
        EVIDENCE_REQUIRED_SOURCE_TYPES.includes(candidate.sourceType) &&
        !candidate.evidence?.text?.trim()
      ) {
        return {
          verdict: "review",
          score: result.score,
          kind,
          reason: "采集类内容判定为事实但缺少来源证据（evidence），需人工确认后入库",
        };
      }
    }

    return { ...result, kind } as QualityFilterResult;
  }

  /**
   * 从 LLM 输出中解析 {"score": <0-10>, "kind": "<fact|inference|hypothesis|insight>", "reason": "<...>"}。
   * 返回 null 表示无法解析（由调用方决定重试或转人工）。
   */
  private parseVerdict(text: string): QualityFilterResult | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]) as { score?: unknown; kind?: unknown; reason?: unknown };
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) return null;

      const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
      const rawKind = typeof parsed.kind === "string" ? parsed.kind.trim() : "";
      const kind = VALID_KINDS.includes(rawKind as MemoryKind)
        ? (rawKind as MemoryKind)
        : undefined;
      const clamped = Math.max(0, Math.min(10, Math.round(score)));

      if (clamped >= ACCEPT_SCORE) {
        return { verdict: "accept", score: clamped, kind: kind ?? "fact" };
      }
      if (clamped >= REJECT_SCORE) {
        return {
          verdict: "review",
          score: clamped,
          kind,
          reason: reason || `质量评分 ${clamped}/10 处于灰区，需人工复核`,
        };
      }
      return {
        verdict: "reject",
        score: clamped,
        kind: kind ?? "fact",
        reason: reason || `质量评分过低（${clamped}/10）`,
      };
    } catch {
      return null;
    }
  }

  private buildPrompt(candidate: MemoryRecord, similar: SimilarMemoryHint[]): string {
    const similarBlock = similar.length
      ? `\n知识库中与它最相似的已有条目：
${similar.map((s, i) => `${i + 1}. 《${s.title}》（相似度 ${(s.similarity * 100).toFixed(0)}%）：${s.summary}`).join("\n")}
`
      : "";

    const evidenceBlock = candidate.evidence?.text
      ? `\n来源证据：${candidate.evidence.text.slice(0, 300)}${candidate.evidence.location ? `（位置：${candidate.evidence.location}）` : ""}
`
      : "\n来源证据：（无）";

    return `你是一道记忆入库质量闸门。请判断以下候选记忆是否值得作为长期知识保存。

标题：${candidate.title}
摘要：${candidate.summary}
内容：${candidate.content.slice(0, 2000)}
${evidenceBlock}${similarBlock}
按以下三个维度综合打 0-10 分：
- 新颖性：知识库是否已有等价信息（与上面相似条目高度重合则新颖性低）
- 信息密度：包含具体的事实、决策、经验教训，而非空泛表述
- 时效价值：值得长期保留的知识，而非闲聊、寒暄、广告或碎片

同时判定内容性质 kind：
- fact：来源中有明确依据的事实/决策/经验
- inference：由内容推导出的结论（原文未直接陈述）
- hypothesis：猜测性、待验证的说法
- insight：新观点、个人洞察

只回复 JSON，不要多余解释：{"score": <0-10 整数>, "kind": "<fact|inference|hypothesis|insight>", "reason": "<一句话理由>"}`;
  }
}
