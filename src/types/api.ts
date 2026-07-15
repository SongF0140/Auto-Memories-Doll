import { MemoryRecord } from "./memory";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
  timestamp?: string;
};

export type ChatMode = "chat" | "memory" | "prompt";

export type ChatRequest = {
  messages: ChatMessage[];
  mode: ChatMode;
  sessionId: string;
  memoryIds?: string[];
};

export type ChatResponse = {
  id: string;
  content: string;
  role: "assistant";
  memoryReferences?: MemoryReference[];
  status: "streaming" | "completed" | "error";
};

export type MemoryReference = {
  memoryId: string;
  title: string;
  summary: string;
  relevance: number;
};

export type MemoryQueryRequest = {
  query: string;
  limit?: number;
  tags?: string[];
  sourceTypes?: string[];
};

export type MemoryQueryResponse = {
  results: MemoryRecord[];
  total: number;
  queryTime: number;
};

export type MemoryWriteRequest = {
  memory: Partial<MemoryRecord>;
  mode: "merge" | "replace";
};

export type MemoryWriteResponse = {
  success: boolean;
  memoryId: string;
  status: "written" | "queued" | "conflict";
};

export type PromptRequest = {
  templateId: string;
  variables?: Record<string, string>;
};

export type PromptResponse = {
  content: string;
  templateId: string;
  variables: Record<string, string>;
};

export type PromptUpdateRequest = {
  templateId: string;
  content: string;
  variables?: string[];
  description?: string;
};

export type IngestRequest = {
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill";
  content: string;
  metadata?: Record<string, string>;
};

export type IngestResponse = {
  success: boolean;
  eventId: string;
  status: "queued" | "processing";
};

export type AuditRequest = {
  action: "process" | "resolve" | "list";
  eventId?: string;
  conflictId?: string;
  resolution?: "accept" | "keep" | "manual";
  manualValue?: string;
};

export type AuditResponse = {
  success: boolean;
  results?: any[];
  message?: string;
};

export type ApiError = {
  code: number;
  message: string;
  details?: string;
};