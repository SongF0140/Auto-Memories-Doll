export type AiProvider = "openai" | "openai-compatible" | "anthropic" | "custom";

export type AiConfig = {
  provider: AiProvider;
  baseURL: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxRetries: number;
};

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type SkillConfig = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  description?: string;
  prompt: string;
  /** 标记为 true 时，McpIngestBridge 会自动执行该 skill 并将输出送入 ingest 管线 */
  autoIngest?: boolean;
  /** autoIngest 模式下使用的标签 */
  tags?: string[];
  /** autoIngest 模式下归入的话题目录 */
  topic?: string;
  createdAt: string;
  updatedAt: string;
};

export type StorageConfig = {
  /** 笔记与 markdown 主存储根目录（运行时可热重载） */
  notesPath: string;
  /** 上次更新时间，用于缓存失效判断 */
  updatedAt: string;
};

/**
 * 本地工具监听源类型。
 *
 * 每种 toolType 对应一种解析策略：
 * - codex:        ~/.codex/sessions/ 下的 jsonl 文件，每行一个事件 {type, payload}
 * - claude-code:  ~/.claude/projects/ 下的 jsonl 文件，每行一个消息 {role, message}
 * - cursor:       ~/.cursor/conversations/ 下的 json 文件，单个对话数组
 * - markdown:     任意 .md 文件，直接当作笔记内容
 * - text:         任意 .txt 文件，纯文本处理
 */
export type ToolType = "codex" | "claude-code" | "cursor" | "markdown" | "text";

export type ToolWatchSource = {
  id: string;
  name: string;
  /** 工具类型，决定解析策略 */
  toolType: ToolType;
  /** 监听目录的绝对路径，如 ~/.codex/sessions */
  path: string;
  /** 文件 glob 模式，如 'jsonl' 或 'md' 通配符 */
  filePattern: string;
  /** 是否启用 */
  enabled: boolean;
  /** 自动归类的话题名（可选，不填则按工具类型归类） */
  topic?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppConfig = {
  ai: AiConfig;
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
  storage: StorageConfig;
  toolSources: ToolWatchSource[];
};

export type ConfigSection = "ai" | "mcp" | "skills" | "storage" | "tool-sources";
