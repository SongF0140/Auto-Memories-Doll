/**
 * 记忆 schema 版本。
 * v2：新增 status / supersededBy / supersedes / confidence / retrievalCount /
 *     windowUse / sources / synthesizedBy / compileSignature 九个字段，
 *     MemoryKind 新增 synthesis。迁移在 MemoryService.init() 内幂等执行。
 */
export const MEMORY_VERSION = 2;

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

/**
 * 记忆类型权重（I-2 幻觉防护）：对基础多因子分数做乘性降权，
 * 防止 AI 推断内容与已验证事实同权进入注入上下文。
 */
export const KIND_WEIGHTS: Record<string, number> = {
  fact: 1,
  insight: 0.9,
  inference: 0.85,
  hypothesis: 0.7,
  synthesis: 1,
};

/** ranker heat 因子中 confidence 占比（剩余为 heatScore），权重总量保持不变 */
export const RANKER_CONFIDENCE_IN_HEAT = 0.4;

/** I-4 置信度：强化步长与上限 */
export const CONFIDENCE_REINFORCE_STEP = 0.05;
export const CONFIDENCE_MAX = 0.95;
/** I-4 置信度：按 kind 差异化的艾宾浩斯衰减系数 λ（单位：1/小时） */
export const CONFIDENCE_DECAY_LAMBDA: Record<string, number> = {
  fact: 0.002,
  insight: 0.004,
  synthesis: 0.004,
  inference: 0.008,
  hypothesis: 0.012,
};
/** I-9 检索弱信号的日衰减系数（防止历史高频卡永久霸榜） */
export const RETRIEVAL_COUNT_DAILY_DECAY = 0.9;

/** I-5 控制面：注入 system prompt 的 index 片段 token 预算硬上限 */
export const CONTROL_PLANE_TOKEN_BUDGET = 500;
/** I-5 控制面文件（系统元数据，不入库、不被 file-watcher 采集） */
export const CONTROL_PLANE_FILES = ["index.md", "overview.md", "log.md", "review_q.md"] as const;

/** I-6 编译：可编译簇的最小卡片数与活跃窗口天数 */
export const SYNTHESIS_MIN_CLUSTER_SIZE = 5;
export const SYNTHESIS_ACTIVE_WINDOW_DAYS = 14;
/** I-7 编译验证：最大重编译轮次（防夜间预算失控） */
export const COMPILE_MAX_REFINEMENT_ROUNDS = 2;

/** I-8 检索路由：RRF 融合常数 k */
export const RRF_K = 60;

/** 压缩与遗忘机制阈值 */
export const MAX_TOTAL_MEMORIES = 2000;
export const COMPRESSION_BATCH_SIZE = 10;
export const COMPRESSION_AGE_DAYS = 30;
export const COLD_HEAT_THRESHOLD = 0.05;
export const RETENTION_RUN_INTERVAL_MS = 3600000; // 1 小时

export const DEGRADATION_ALERT_THRESHOLD = 600000;

/** 检索增强：query 改写最多生成的变体数（不含原句） */
export const QUERY_REWRITE_MAX_VARIANTS = 2;
/** 检索增强：单个改写变体的最大字符数，超长视为异常输出丢弃 */
export const QUERY_REWRITE_MAX_CHARS = 80;
/** 检索增强：进入重排前的候选召回条数（略大于最终注入条数，给 MMR 留选择空间） */
export const RETRIEVAL_CANDIDATE_LIMIT = 12;
/** 注入提示词的最大记忆条数（含图谱邻居扩展后的总量） */
export const RETRIEVAL_MAX_INJECTED_MEMORIES = 12;
/**
 * 注入正文预算（修复"检索回来的记忆只有一句话摘要、写长文时细节全丢"）：
 * 记忆卡片正文按排名顺序分配进上下文，靠前的（含用户手动选中的）拿满单卡上限，
 * 预算耗尽后靠后的退化为仅摘要。
 */
export const RETRIEVAL_CONTENT_BUDGET_CHARS = 8000;
export const RETRIEVAL_PER_CARD_CONTENT_MAX_CHARS = 2000;
