/**
 * IVectorIndex — 向量索引抽象接口
 * agent 层只依赖此接口，不感知底层是 better-sqlite3 / sqlite-vec / 内存
 */
export interface IVectorIndex {
  /** 创建向量记录 */
  create(record: {
    memoryId: string;
    embedding: number[];
    model: string;
    dimensions: number;
  }): void;

  /** 按余弦相似度搜索，返回 memoryId 和相似度分数 */
  search(queryEmbedding: number[], topK: number): Array<{
    memoryId: string;
    similarity: number;
  }>;

  /** 按 memoryId 删除 */
  delete(memoryId: string): boolean;

  close(): void;
}
