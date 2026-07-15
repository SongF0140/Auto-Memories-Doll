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
    dimensions: apiConfig.embedding.dimensions,
    updatedAt: getCurrentTime(),
  };
};

export const isEmbeddingEmpty = (embedding: number[]): boolean => {
  return embedding.length === 0 || embedding.every(v => v === 0);
};