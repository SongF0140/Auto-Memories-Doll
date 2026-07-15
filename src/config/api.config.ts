import { env } from "./env";
import { EmbeddingModelConfig } from "../types/memory";

export const apiConfig = {
  baseURL: env.MODEL_BASE_URL,
  apiKey: env.MODEL_API_KEY,
  timeout: 30000,
  maxRetries: 2,
  miniLlmModel: "mini-llm",
  proLlmModel: "pro-llm",
  embedding: {
    name: "text-embedding-3-small",
    dimensions: 1536,
    maxTokens: 8191,
    batchSize: 100,
  } as EmbeddingModelConfig,
  degradation: {
    enabled: true,
    checkInterval: 30000,
    alertThreshold: 600000,
  },
};