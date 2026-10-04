/**
 * 运行参数默认值（并发/降级/向量元数据）。
 *
 * AI 凭证与模型名的唯一来源是 ConfigService 的持久配置（默认值由
 * getDefaultAiConfig() 从 env seed）；此处不再保留 baseURL/apiKey/模型名，
 * 避免 env 凭证出现第二个互不一致的消费点。
 */
import type { EmbeddingModelConfig } from "../types/memory";

export const apiConfig = {
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
