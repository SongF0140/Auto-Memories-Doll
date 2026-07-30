import { MemoryRecord } from "../../types/memory";

/**
 * IMemoryStore — 记忆存储抽象接口
 * agent 层只依赖此接口，不感知底层是 SQLite / 文件 / 内存
 */
export interface IMemoryStore {
  createMemory(record: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord;
  getMemory(id: string): MemoryRecord | undefined;
  updateMemory(id: string, updates: Partial<MemoryRecord>): boolean;
  deleteMemory(id: string): boolean;
  listMemories(options?: { tag?: string; sortBy?: string; sortOrder?: "asc" | "desc" }): MemoryRecord[];
  incrementAccess(id: string): void;
  close(): void;
}
