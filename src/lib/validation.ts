import { z } from "zod";

export const chatSessionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, "sessionId 格式无效");

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
});

export const chatSessionWriteSchema = z.object({
  mode: z.enum(["chat", "memory", "prompt"]).default("chat"),
  messages: z.array(chatMessageSchema),
});

export const chatSessionImportSchema = z.object({
  sessions: z
    .array(
      chatSessionWriteSchema.extend({
        sessionId: chatSessionIdSchema,
      }),
    )
    .max(100, "单次最多迁移 100 个会话"),
});

const modelTierSchema = z.object({
  model: z.string().min(1, "model 不能为空"),
  maxTokens: z.number().int().min(1).max(131072),
  temperature: z.number().min(0).max(2),
  timeout: z.number().int().min(1000).max(120000),
  maxRetries: z.number().int().min(0).max(10),
});

const embeddingSchema = z.object({
  model: z.string().min(1, "embedding model 不能为空"),
  dimensions: z.number().int().min(1).max(8192),
  maxConcurrency: z.number().int().min(1).max(50),
  queueTimeoutMs: z.number().int().min(1000).max(300000),
});

export const aiConfigSchema = z.object({
  provider: z.enum(["openai", "openai-compatible", "anthropic", "custom"]),
  baseURL: z.string().url("baseURL 必须是有效的 URL"),
  apiKey: z.string().min(1, "apiKey 不能为空"),
  flagship: modelTierSchema,
  standard: modelTierSchema,
  budget: modelTierSchema,
  embedding: embeddingSchema,
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, "messages 至少需要一条消息"),
  mode: z.enum(["chat", "memory", "prompt"]).default("chat"),
  sessionId: chatSessionIdSchema.default("default"),
  memoryIds: z.array(z.string()).optional(),
});

export const memoryCreateSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  content: z.string().min(1, "内容不能为空"),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  sourceType: z.enum(["chat", "ingest", "manual", "mcp", "skill"]).default("manual"),
});

export const memoryUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceType: z.enum(["chat", "ingest", "manual", "mcp", "skill"]).optional(),
});

export const ingestRequestSchema = z.object({
  content: z.string().min(1, "内容不能为空"),
  format: z.enum(["text", "markdown", "json"]).default("text"),
});

export const promptCreateSchema = z.object({
  id: z.string().min(1, "id 不能为空"),
  name: z.string().min(1, "名称不能为空"),
  content: z.string().min(1, "内容不能为空"),
  variables: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const promptUpdateSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  variables: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const mcpServerSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  enabled: z.boolean().default(true),
  command: z.string().min(1, "命令不能为空"),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  description: z.string().optional(),
});

export const skillSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  enabled: z.boolean().default(true),
  trigger: z.string().min(1, "触发关键词不能为空"),
  description: z.string().optional(),
  prompt: z.string().min(1, "提示词不能为空"),
});
