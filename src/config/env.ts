export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  MODEL_API_KEY: process.env.MODEL_API_KEY || "",
  MODEL_BASE_URL: process.env.MODEL_BASE_URL || "http://localhost:8080",
  MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
  PORT: process.env.PORT ? parseInt(process.env.PORT) : 3000,
};
