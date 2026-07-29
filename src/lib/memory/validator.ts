import {
  MemoryRecord,
  VectorRecord,
  GraphEdge,
  PendingEvent,
  ConflictRecord,
} from "../../types/memory";

export const validateMemoryRecord = (record: Partial<MemoryRecord>): record is MemoryRecord => {
  if (!record.id || typeof record.id !== "string") return false;
  if (!record.version || typeof record.version !== "number") return false;
  if (!record.source || typeof record.source !== "string") return false;
  if (
    !record.sourceType ||
    !["chat", "ingest", "manual", "mcp", "skill", "listen"].includes(record.sourceType)
  )
    return false;
  if (!record.title || typeof record.title !== "string") return false;
  if (!record.content || typeof record.content !== "string") return false;
  if (!record.summary || typeof record.summary !== "string") return false;
  if (!record.tags || !Array.isArray(record.tags)) return false;
  if (!record.topic || typeof record.topic !== "string") return false;
  if (!record.createdAt || typeof record.createdAt !== "string") return false;
  if (!record.updatedAt || typeof record.updatedAt !== "string") return false;
  if (!record.accessedAt || typeof record.accessedAt !== "string") return false;
  if (record.accessCount === undefined || typeof record.accessCount !== "number") return false;
  if (record.heatScore === undefined || typeof record.heatScore !== "number") return false;
  if (!record.graphLinks || !Array.isArray(record.graphLinks)) return false;
  return true;
};

export const validateVectorRecord = (record: Partial<VectorRecord>): record is VectorRecord => {
  if (!record.memoryId || typeof record.memoryId !== "string") return false;
  if (!record.embedding || !Array.isArray(record.embedding)) return false;
  if (!record.model || typeof record.model !== "string") return false;
  if (!record.dimensions || typeof record.dimensions !== "number") return false;
  if (!record.updatedAt || typeof record.updatedAt !== "string") return false;
  return true;
};

export const validateGraphEdge = (edge: Partial<GraphEdge>): edge is GraphEdge => {
  if (!edge.from || typeof edge.from !== "string") return false;
  if (!edge.to || typeof edge.to !== "string") return false;
  if (!edge.relation || typeof edge.relation !== "string") return false;
  if (edge.weight === undefined || typeof edge.weight !== "number") return false;
  if (!edge.updatedAt || typeof edge.updatedAt !== "string") return false;
  return true;
};

export const validatePendingEvent = (event: Partial<PendingEvent>): event is PendingEvent => {
  if (!event.eventId || typeof event.eventId !== "string") return false;
  if (!event.memoryId || typeof event.memoryId !== "string") return false;
  if (!event.sourceType || !["chat", "ingest", "manual", "mcp", "skill"].includes(event.sourceType))
    return false;
  if (!event.candidate || typeof event.candidate !== "string") return false;
  if (!event.changedFields || !Array.isArray(event.changedFields)) return false;
  if (!event.createdAt || typeof event.createdAt !== "string") return false;
  if (!event.status || !["pending", "processing", "done", "failed"].includes(event.status))
    return false;
  if (event.retryCount === undefined || typeof event.retryCount !== "number") return false;
  return true;
};

export const validateConflictRecord = (
  record: Partial<ConflictRecord>,
): record is ConflictRecord => {
  if (!record.conflictId || typeof record.conflictId !== "string") return false;
  if (!record.memoryId || typeof record.memoryId !== "string") return false;
  if (!record.eventId || typeof record.eventId !== "string") return false;
  if (!record.field || typeof record.field !== "string") return false;
  if (!record.existingValue || typeof record.existingValue !== "string") return false;
  if (!record.candidateValue || typeof record.candidateValue !== "string") return false;
  if (
    !record.status ||
    !["pending", "resolved_accept", "resolved_keep", "resolved_manual"].includes(record.status)
  )
    return false;
  if (!record.createdAt || typeof record.createdAt !== "string") return false;
  return true;
};
