import { ModelAdapter } from "../ai/model-adapter";
import { apiConfig } from "../../config/api.config";
import { VectorRecord } from "../../types/memory";
import { getCurrentTime } from "../utils/date";

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const response = await ModelAdapter.generateEmbedding(text);
  return response.embedding;
};

export const buildVectorRecord = async (memoryId: string, text: string): Promise<VectorRecord> => {
  const embedding = await generateEmbedding(text);

  return {
    memoryId,
    embedding,
    model: apiConfig.embedding.name,
    dimensions: embedding.length,
    updatedAt: getCurrentTime(),
  };
};

export const isEmbeddingEmpty = (embedding: number[]): boolean => {
  return embedding.length === 0 || embedding.every((v) => v === 0);
};

export type EmbeddingKeyInput = {
  summary?: string | null;
  windowUse?: string | null;
  content?: string | null;
};

/**
 * I-11 window-use 检索键分离（Rainy）：
 * 用户查询和"这条记忆什么时候有用"天然语义对齐，把 embedding 键放在
 * `summary + windowUse` 而不是全文，从源头提升召回率；
 * 规则式 query-rewriter 是下游补偿，这是上游根治。
 *
 * 键缺省时回退全文，保证 windowUse 尚未生成的存量记忆仍可被嵌入。
 * 注意：这会改变所有向量的输入分布，需要全量重嵌——由 VectorWorker 的
 * 分批续跑重建（vector-scheduler 每小时推进）承担迁移。
 */
export function buildEmbeddingKey(input: EmbeddingKeyInput): string {
  const parts = [input.summary?.trim(), input.windowUse?.trim()].filter((part): part is string =>
    Boolean(part && part.length > 0),
  );
  if (parts.length > 0) return parts.join("\n");
  return (input.content ?? "").trim();
}
