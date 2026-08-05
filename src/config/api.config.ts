import { env } from "./env";
import { EmbeddingModelConfig } from "../types/memory";

export const apiConfig = {
  baseURL: env.MODEL_BASE_URL,
  apiKey: env.MODEL_API_KEY,
  timeout: 30000,
  maxRetries: 2,
  /** 旗舰模型默认值 — 分流、评估、审计，需要强推理能力 */
  flagship: {
    model: process.env.FLAGSHIP_MODEL || "gpt-4o",
    maxTokens: 8192,
    temperature: 0.3,
    timeout: 60000,
    maxRetries: 3,
  },
  /** 普通模型默认值 — 对话、代码生成，平衡质量与成本 */
  standard: {
    model: process.env.STANDARD_MODEL || "gpt-4o-mini",
    maxTokens: 4096,
    temperature: 0.7,
    timeout: 30000,
    maxRetries: 2,
  },
  /** 廉价模型默认值 — 测试生成、摘要、简单提取，低成本优先 */
  budget: {
    model: process.env.BUDGET_MODEL || "gpt-4o-mini",
    maxTokens: 2048,
    temperature: 0.6,
    timeout: 15000,
    maxRetries: 1,
  },
  /** 并发控制 — 防止 API 请求风暴和触发限流 */
  concurrency: {
    flagship: {
      maxConcurrency: 2,
      queueTimeoutMs: 60000,
    },
    standard: {
      maxConcurrency: 5,
      queueTimeoutMs: 45000,
    },
    budget: {
      maxConcurrency: 10,
      queueTimeoutMs: 30000,
    },
    embedding: {
      maxConcurrency: 8,
      queueTimeoutMs: 60000,
    },
  },
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
