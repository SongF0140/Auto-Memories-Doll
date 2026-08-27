import { MemoryRecord } from "../../types/memory";

export type ConflictResolution =
  | { action: "auto_merge"; merged: Partial<MemoryRecord> }
  | {
      action: "manual_decision";
      conflicts: { field: string; existingValue: any; candidateValue: any }[];
    }
  | { action: "reject"; reason: string };

/**
 * 冲突分级解析：按 AGENTS.md 4.10 三级策略处理
 *
 * 检查顺序（短路返回）：
 * 1. reject — schema 版本不兼容 / 数据损坏 / 格式校验失败 → 不写入任何变更
 * 2. auto_merge — 变更字段不重叠，或重叠字段值相同，或为 tags/graphLinks（自动并集合并）
 * 3. manual_decision — 同一标量字段值不同 → 生成 ConflictRecord 等待人工裁决
 *
 * 注意：reject 必须在字段比对前执行，避免损坏数据污染合并结果。
 */
export function resolveConflicts(
  existing: MemoryRecord,
  candidate: MemoryRecord,
  changedFields: string[],
): ConflictResolution {
  // ── reject 路径 1：schema 版本不兼容 ──
  // 候选版本比现有旧，意味着基于过时数据生成，不应覆盖
  if (candidate.version < existing.version) {
    return {
      action: "reject",
      reason: `schema 版本不兼容：候选 version=${candidate.version} 低于现有 version=${existing.version}，候选可能基于过时数据生成`,
    };
  }

  // ── reject 路径 2：数据损坏（必要字段为空） ──
  if (!candidate.id || !candidate.title || !candidate.content || !candidate.summary) {
    return {
      action: "reject",
      reason: `数据损坏：候选缺少必要字段 (id/title/content/summary 不能为空)`,
    };
  }

  // ── reject 路径 3：格式校验失败（tags/graphLinks 必须是数组） ──
  if (!Array.isArray(candidate.tags) || !Array.isArray(candidate.graphLinks)) {
    return {
      action: "reject",
      reason: `格式校验失败：candidate.tags / candidate.graphLinks 必须是数组`,
    };
  }

  // ── 字段比对：auto_merge vs manual_decision ──
  const conflicts: { field: string; existingValue: any; candidateValue: any }[] = [];
  const merged: Partial<MemoryRecord> = {};

  for (const field of changedFields) {
    if (field === "version" || field === "id" || field === "createdAt" || field === "updatedAt")
      continue;

    const existingValue = existing[field as keyof MemoryRecord];
    const candidateValue = candidate[field as keyof MemoryRecord];

    if (JSON.stringify(existingValue) === JSON.stringify(candidateValue)) continue;

    if (field === "tags") {
      const mergedTags = [...new Set([...existing.tags, ...candidate.tags])];
      merged.tags = mergedTags;
      continue;
    }

    if (field === "graphLinks") {
      const mergedLinks = [...new Set([...existing.graphLinks, ...candidate.graphLinks])];
      merged.graphLinks = mergedLinks;
      continue;
    }

    conflicts.push({ field, existingValue, candidateValue });
  }

  if (conflicts.length > 0) {
    return { action: "manual_decision", conflicts };
  }

  return { action: "auto_merge", merged };
}
