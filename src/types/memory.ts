export type MemoryRecord = {
  id: string;
  version: number;
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  /** 原标题（AI 可读） */
  title: string;
  /** 中文标题（人可读），为空时前端回退到 title */
  titleZh?: string;
  content: string;
  /** 原摘要（AI 可读） */
  summary: string;
  /** 中文摘要（人可读），为空时前端回退到 summary */
  summaryZh?: string;
  /** 原标签（AI 可读） */
  tags: string[];
  /** 中文标签（人可读），为空时前端回退到 tags */
  tagsZh?: string[];
  /** 所属话题目录，如 "ai-coding"、"daily-notes" */
  topic: string;
  /** 中文话题标签，为空时前端用 getTopicLabel(topic) */
  topicZh?: string;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  accessCount: number;
  heatScore: number;
  vectorId?: string;
  graphLinks: string[];
};

/** 外部工具通过 /api/listen POST 的对话数据结构 */
export type ConversationData = {
  /** 来源标识，如 "trae-ide"、"chatgpt-web"、"claude-web" */
  source: string;
  /** 来源类型 */
  sourceType: "listen" | "chat" | "ingest" | "manual" | "mcp" | "skill";
  /** 对话标题（可选，自动提取） */
  title?: string;
  /** 消息列表 */
  messages: ConversationMessage[];
  /** 用户自定义标签 */
  tags?: string[];
  /** 话题目录名（可选，自动提取） */
  topic?: string;
  /** 元数据 */
  metadata?: {
    url?: string;
    platform?: string;
    model?: string;
    [key: string]: any;
  };
};

export type ConversationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
};

export type VectorRecord = {
  memoryId: string;
  embedding: number[];
  model: string;
  dimensions: number;
  updatedAt: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  relation: string;
  weight: number;
  updatedAt: string;
};

export type MemoryVersion = {
  versionId: string;
  memoryId: string;
  snapshotPath: string;
  createdAt: string;
  reason: string;
};

export type EmbeddingModelConfig = {
  name: string;
  dimensions: number;
  maxTokens: number;
  batchSize: number;
};

export type PendingEvent = {
  eventId: string;
  memoryId: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  candidate: string;
  changedFields: string[];
  createdAt: string;
  status: "pending" | "processing" | "done" | "failed";
  retryCount: number;
};

export type ConflictRecord = {
  conflictId: string;
  memoryId: string;
  eventId: string;
  field: string;
  existingValue: string;
  candidateValue: string;
  status: "pending" | "resolved_accept" | "resolved_keep" | "resolved_manual";
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
};
