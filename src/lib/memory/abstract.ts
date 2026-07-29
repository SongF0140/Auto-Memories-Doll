import {
  MemoryRecord,
  VectorRecord,
  GraphEdge,
  PendingEvent,
  ConflictRecord,
} from "../../types/memory";

export interface MemoryStore {
  create(memory: MemoryRecord): Promise<void>;
  read(id: string): Promise<MemoryRecord | null>;
  update(memory: MemoryRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<MemoryRecord[]>;
  search(query: string, options?: { tags?: string[]; limit?: number }): Promise<MemoryRecord[]>;
  incrementAccess(id: string): Promise<void>;
}

export interface VectorStore {
  create(record: VectorRecord): Promise<void>;
  read(memoryId: string): Promise<VectorRecord | null>;
  update(record: VectorRecord): Promise<void>;
  delete(memoryId: string): Promise<void>;
  search(embedding: number[], limit: number): Promise<{ memoryId: string; similarity: number }[]>;
  list(): Promise<VectorRecord[]>;
}

export interface GraphStore {
  create(edge: GraphEdge): Promise<void>;
  read(from: string, to: string): Promise<GraphEdge | null>;
  update(edge: GraphEdge): Promise<void>;
  delete(from: string, to: string): Promise<void>;
  getNeighbors(nodeId: string): Promise<GraphEdge[]>;
  list(): Promise<GraphEdge[]>;
}

export interface QueueStore {
  enqueue(event: PendingEvent): Promise<void>;
  dequeue(memoryId: string): Promise<PendingEvent | null>;
  read(eventId: string): Promise<PendingEvent | null>;
  update(event: PendingEvent): Promise<void>;
  delete(eventId: string): Promise<void>;
  list(status?: string): Promise<PendingEvent[]>;
  count(status?: string): Promise<number>;
}

export interface ConflictStore {
  create(record: ConflictRecord): Promise<void>;
  read(conflictId: string): Promise<ConflictRecord | null>;
  update(record: ConflictRecord): Promise<void>;
  delete(conflictId: string): Promise<void>;
  list(status?: string): Promise<ConflictRecord[]>;
  count(status?: string): Promise<number>;
}

export interface StorageManager {
  memory: MemoryStore;
  vector: VectorStore;
  graph: GraphStore;
  queue: QueueStore;
  conflict: ConflictStore;
}
