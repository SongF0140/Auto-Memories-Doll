import { MemoryRecord } from "../../types/memory";

export type DiffResult = {
  field: string;
  type: "added" | "removed" | "changed";
  existingValue?: any;
  candidateValue?: any;
};

export function compareMemories(existing: MemoryRecord, candidate: MemoryRecord): DiffResult[] {
  const diffs: DiffResult[] = [];
  const fields: (keyof MemoryRecord)[] = [
    "title",
    "content",
    "summary",
    "tags",
    "sourceType",
    "graphLinks",
  ];

  for (const field of fields) {
    const existingValue = existing[field];
    const candidateValue = candidate[field];

    if (JSON.stringify(existingValue) !== JSON.stringify(candidateValue)) {
      diffs.push({
        field,
        type: "changed",
        existingValue,
        candidateValue,
      });
    }
  }

  return diffs;
}

export function extractChangedFields(diffs: DiffResult[]): string[] {
  return diffs.map((d) => d.field);
}
