/** 记忆类型：事实 / 推断 / 假设 / 待验证洞察（非 fact 必须人工裁决后才可入库） */
export type MemoryKind = "fact" | "inference" | "hypothesis" | "insight";

/** 来源证据：原文片段 + 可选位置（文件路径 / URL），事实类入库的证据约束 */
export type MemoryEvidence = {
  /** 原文片段（截取自来源文件/消息的原始文本） */
  text: string;
  /** 证据位置：来源文件路径或 URL */
  location?: string;
  /**
   * 来源原文的 sha256（抽取型记忆专用）：入库内容是中文重写卡，
   * 与原文不再字面可比，靠此哈希判断来源文件是否变更 / 是否重复入库
   */
  sourceHash?: string;
};

export type MemoryRecord = {
  id: string;
  version: number;
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  /** 记忆类型（缺省视为 fact）；闸门判定非 fact 时强制转人工 */
  kind?: MemoryKind;
  /** 来源证据；fact 类缺少证据时闸门转人工而非直接入库 */
  evidence?: MemoryEvidence;
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
  /** 事件类型：缺省时由消费端按记忆是否存在区分 create/update；delete 必须显式声明 */
  eventType?: "create" | "update" | "delete";
  candidate: string;
  changedFields: string[];
  createdAt: string;
  /**
   * 事件状态机：
   * - pending/processing：待消费/消费中
   * - done：已落盘；failed：系统类失败，可被重试
   * - rejected：质量闸门或向量去重终拒，不参与重试
   * - review：闸门不可用或评分存疑，待人工裁决，不被自动消费
   */
  status: "pending" | "processing" | "done" | "failed" | "rejected" | "review";
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
