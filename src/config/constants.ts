export const MEMORY_VERSION = 1;

export const MAX_RETRY_COUNT = 3;

export const RETRY_DELAYS = [60000, 300000, 1200000];

export const DEFAULT_VECTOR_DIMENSIONS = 1536;

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export const DEFAULT_MINI_LLM_MODEL = "mini-llm";

export const DEFAULT_PRO_LLM_MODEL = "pro-llm";

export const MAX_EMBEDDING_TOKENS = 8191;

export const DEFAULT_EMBEDDING_BATCH_SIZE = 100;

export const API_TIMEOUT = 30000;

export const API_MAX_RETRIES = 2;

export const RETENTION_PERIOD_HOURS = 24;

export const DEGRADATION_CHECK_INTERVAL = 30000;

export const CHAT_CONTEXT_COMPRESSION_MAX_MESSAGES = 24;
export const CHAT_CONTEXT_SUMMARY_MAX_CHARS = 80;
export const CHAT_CONTEXT_KEEP_SYSTEM_MESSAGES = true;

export const INTENT_CLASSIFY_KEYWORD_THRESHOLD = 0.6;
export const INTENT_EMBEDDING_THRESHOLD = 0.3;
export const INTENT_DEFAULT_CONFIDENCE = 0.3;
export const INTENT_KEYWORD_BASE_CONFIDENCE = 0.5;
export const INTENT_KEYWORD_MATCH_BONUS = 0.12;
export const INTENT_KEYWORD_POSITION_BONUS = 0.05;
export const INTENT_MAX_CONFIDENCE = 0.95;

export const RANKER_WEIGHTS = {
  relevance: 0.4,
  heat: 0.25,
  recency: 0.2,
  access: 0.1,
  tagAffinity: 0.05,
} as const;

export const RANKER_DEFAULT_MMR_ALPHA = 0.7;

/** 压缩与遗忘机制阈值 */
export const MAX_TOTAL_MEMORIES = 2000;
export const COMPRESSION_BATCH_SIZE = 10;
export const COMPRESSION_AGE_DAYS = 30;
export const COLD_HEAT_THRESHOLD = 0.05;
export const RETENTION_RUN_INTERVAL_MS = 3600000; // 1 小时

export const DEGRADATION_ALERT_THRESHOLD = 600000;
