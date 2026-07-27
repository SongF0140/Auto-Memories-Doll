import { MemoryRecord, PendingEvent } from "../../types/memory";
import { generateId } from "../utils/id";
import { getCurrentTime } from "../utils/date";
import { MEMORY_VERSION } from "../../config/constants";

export const buildMemoryRecord = (
  source: string,
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
  title: string,
  content: string,
  summary: string,
  tags: string[] = [],
  topic: string = "uncategorized",
  id?: string,
  /** 中文版本字段（可选） */
  zhFields?: { titleZh?: string; summaryZh?: string; tagsZh?: string[]; topicZh?: string }
): MemoryRecord => {
  const now = getCurrentTime();
  return {
    id: id || generateId(),
    version: MEMORY_VERSION,
    source,
    sourceType,
    title,
    content,
    summary,
    tags,
    topic,
    titleZh: zhFields?.titleZh,
    summaryZh: zhFields?.summaryZh,
    tagsZh: zhFields?.tagsZh,
    topicZh: zhFields?.topicZh,
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    accessCount: 0,
    heatScore: 0,
    graphLinks: [],
  };
};

export const buildPendingEvent = (
  memoryId: string,
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen",
  candidate: MemoryRecord,
  changedFields: string[]
): PendingEvent => {
  return {
    eventId: generateId(),
    memoryId,
    sourceType,
    candidate: JSON.stringify(candidate),
    changedFields,
    createdAt: getCurrentTime(),
    status: "pending",
    retryCount: 0,
  };
};

export const updateMemoryRecord = (
  existing: MemoryRecord,
  updates: Partial<MemoryRecord>
): MemoryRecord => {
  return {
    ...existing,
    ...updates,
    updatedAt: getCurrentTime(),
    version: existing.version + 1,
  };
};