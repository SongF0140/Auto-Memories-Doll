import { cosineSimilarity } from "./similarity";

export type VectorSearchRow = {
  memoryId: string;
  embedding: number[];
};

export type VectorSearchResult = {
  memoryId: string;
  similarity: number;
};

export interface VectorSearchBackend {
  name: string;
  search(queryEmbedding: number[], rows: VectorSearchRow[], limit: number): VectorSearchResult[];
}

export class JsVectorSearchBackend implements VectorSearchBackend {
  name = "js";

  search(queryEmbedding: number[], rows: VectorSearchRow[], limit: number): VectorSearchResult[] {
    return rows
      .map((row) => ({
        memoryId: row.memoryId,
        similarity: cosineSimilarity(queryEmbedding, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}

export class SqliteVecFallbackBackend extends JsVectorSearchBackend {
  name = "sqlite-vec-fallback";
}

export function createVectorSearchBackend(kind = process.env.VECTOR_BACKEND): VectorSearchBackend {
  if (kind === "sqlite-vec") {
    return new SqliteVecFallbackBackend();
  }

  return new JsVectorSearchBackend();
}
