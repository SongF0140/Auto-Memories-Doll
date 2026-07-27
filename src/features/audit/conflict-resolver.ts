import { MemoryRecord } from "../../types/memory";

export type ConflictResolution =
  | { action: "auto_merge"; merged: Partial<MemoryRecord> }
  | { action: "manual_decision"; conflicts: { field: string; existingValue: any; candidateValue: any }[] }
  | { action: "reject"; reason: string };

export function resolveConflicts(
  existing: MemoryRecord,
  candidate: MemoryRecord,
  changedFields: string[]
): ConflictResolution {
  const conflicts: { field: string; existingValue: any; candidateValue: any }[] = [];
  const merged: Partial<MemoryRecord> = {};

  for (const field of changedFields) {
    if (field === "version" || field === "id" || field === "createdAt") continue;

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
