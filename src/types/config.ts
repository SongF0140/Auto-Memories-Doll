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

export type AppConfig = {
  ai: AiConfig;
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
};

export type ConfigSection = "ai" | "mcp" | "skills";
