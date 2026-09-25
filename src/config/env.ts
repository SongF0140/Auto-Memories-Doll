export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  MODEL_API_KEY: process.env.MODEL_API_KEY || "",
  MODEL_BASE_URL: process.env.MODEL_BASE_URL || "http://localhost:8080",
  MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
  PORT: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  // Cross-Encoder 精排（可选依赖 @huggingface/transformers 缺失时自动停用）
  RERANK_MODEL: process.env.RERANK_MODEL || "Xenova/bge-reranker-base",
  // 默认走镜像站：huggingface.co 在国内网络不可达（hf-mirror.com 为其只读镜像）
  RERANK_HF_ENDPOINT: process.env.RERANK_HF_ENDPOINT || "https://hf-mirror.com",
  RERANK_DISABLED: process.env.RERANK_DISABLED === "1",
};
