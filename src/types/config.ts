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
  createdAt: string;
  updatedAt: string;
};

export type AppConfig = {
  ai: AiConfig;
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
};

export type ConfigSection = "ai" | "mcp" | "skills";
