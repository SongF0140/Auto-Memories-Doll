export type EventSource = "chat" | "ingest" | "manual" | "mcp" | "skill" | "unknown";

export type EventType = 
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "memory.accessed"
  | "chat.completed"
  | "ingest.received"
  | "audit.completed"
  | "vector.updated"
  | "graph.updated";

export type SystemEvent = {
  id: string;
  type: EventType;
  source: EventSource;
  timestamp: string;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
};

export type InputEvent = {
  id: string;
  source: EventSource;
  sourceType: EventSource;
  content: string;
  timestamp: string;
  sessionId?: string;
  metadata?: Record<string, any>;
};