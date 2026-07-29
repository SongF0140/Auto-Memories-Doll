import { env } from "./env";
import { EmbeddingModelConfig } from "../types/memory";

export const apiConfig = {
  baseURL: env.MODEL_BASE_URL,
  apiKey: env.MODEL_API_KEY,
  timeout: 30000,
  maxRetries: 2,
  /** 默认使用 gpt-4o-mini 用于快轨，可通过 ConfigService 覆盖 */
  miniLlmModel: process.env.MINI_LLM_MODEL || "gpt-4o-mini",
  /** 默认使用 gpt-4o 用于重任务，可通过 ConfigService 覆盖 */
  proLlmModel: process.env.PRO_LLM_MODEL || "gpt-4o",
  embedding: {
    name: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
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
