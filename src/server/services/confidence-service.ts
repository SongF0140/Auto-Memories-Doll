import { MemoryRecord, MemoryKind } from "../../types/memory";
import {
  CONFIDENCE_DECAY_LAMBDA,
  CONFIDENCE_MAX,
  CONFIDENCE_REINFORCE_STEP,
} from "../../config/constants";

/**
 * 置信度服务（I-4，LLM Wiki v2 Confidence Scoring + Ebbinghaus Decay）。
 *
 * - 初值 = 质量闸门评分（0-1）× 证据系数，证据越硬起步越高
 * - 衰减 = 按记忆类型差异化半衰（事实慢、假设快），以"周-月"尺度而非"天"
 * - 强化 = 用户主动访问时 +0.05，封顶 0.95
 *
 * 置信度是 ranker 的输入之一，也是 front matter 的硬约束字段，
 * 用于在检索层面把"已验证事实"和"AI 推断"区分开。
 */

/** 证据系数：决定同类记忆的置信度天花板差异 */
export const EVIDENCE_FACTOR = {
  /** 事实且有原文哈希锚定，可回溯 */
  factWithHash: 0.9,
  /** 事实但无原文哈希 */
  fact: 0.7,
  /** 有依据的洞察 */
  insight: 0.6,
  /** AI 推断，未经证实 */
  inference: 0.5,
  /** 夜间编译产物，来源是多条已入库卡片 */
  synthesis: 0.8,
  /** 假设，待验证 */
  hypothesis: 0.3,
} as const;

export class ConfidenceService {
  /**
   * 计算入库初始置信度。
   * @param qualityScore 质量闸门评分，0-1（由 0-10 分归一化而来）
   */
  static initial(params: {
    qualityScore: number;
    kind?: MemoryKind;
    hasSourceHash?: boolean;
  }): number {
    const { qualityScore, kind = "fact", hasSourceHash = false } = params;
    const safeScore = Number.isFinite(qualityScore) ? Math.max(0, Math.min(1, qualityScore)) : 0;

    let factor: number;
    switch (kind) {
      case "inference":
        factor = EVIDENCE_FACTOR.inference;
        break;
      case "hypothesis":
        factor = EVIDENCE_FACTOR.hypothesis;
        break;
      case "insight":
        factor = EVIDENCE_FACTOR.insight;
        break;
      case "synthesis":
        factor = EVIDENCE_FACTOR.synthesis;
        break;
      default:
        factor = hasSourceHash ? EVIDENCE_FACTOR.factWithHash : EVIDENCE_FACTOR.fact;
    }

    return round3(Math.min(CONFIDENCE_MAX, safeScore * factor));
  }

  /**
   * 按记忆类型差异化衰减。λ 越大衰减越快（假设比事实遗忘得更快）。
   * @param hoursElapsed 距上次衰减的小时数
   */
  static decay(confidence: number, kind: MemoryKind | undefined, hoursElapsed: number): number {
    const base = Number.isFinite(confidence) ? Math.max(0, confidence) : 0;
    if (base <= 0 || hoursElapsed <= 0) return round3(base);
    const lambda = CONFIDENCE_DECAY_LAMBDA[kind ?? "fact"] ?? CONFIDENCE_DECAY_LAMBDA.fact;
    return round3(base * Math.exp(-lambda * hoursElapsed));
  }

  /** 用户主动访问强化，封顶 0.95 */
  static reinforce(confidence: number): number {
    const base = Number.isFinite(confidence) ? Math.max(0, confidence) : 0;
    return round3(Math.min(CONFIDENCE_MAX, base + CONFIDENCE_REINFORCE_STEP));
  }

  /** 批量衰减，返回需要回写的 memoryId → confidence */
  static decayAll(memories: MemoryRecord[], hoursElapsed: number): Map<string, number> {
    const result = new Map<string, number>();
    for (const memory of memories) {
      if (memory.status === "superseded") continue;
      const current = memory.confidence ?? 0;
      if (current <= 0) continue;
      const next = ConfidenceService.decay(current, memory.kind, hoursElapsed);
      if (next !== current) result.set(memory.id, next);
    }
    return result;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
