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
  // embedding 可走不同提供商：key/baseURL 可选，留空回落共享配置
  apiKey: z.string().optional(),
  baseURL: z
    .union([z.string().url("embedding baseURL 必须是有效的 URL"), z.literal("")])
    .optional(),
});

/** Key 保存意图：保留库存 / 替换为新值 / 清除。省略时按掩码回填兼容旧客户端 */
export const apiKeyIntentSchema = z.enum(["keep", "replace", "clear"]).optional();

export const aiConfigSchema = z.object({
  provider: z.string().trim().min(1, "provider 不能为空"),
  baseURL: z.string().url("baseURL 必须是有效的 URL"),
  // 是否为空由 route 按 apiKeyIntent 判定（clear 合法，replace/缺省拒绝空）
  apiKey: z.string(),
  apiKeyIntent: apiKeyIntentSchema,
  flagship: modelTierSchema,
  standard: modelTierSchema,
  budget: modelTierSchema,
  embedding: embeddingSchema,
  embeddingApiKeyIntent: apiKeyIntentSchema,
});

/** UI 结构化记忆操作：明确操作只允许来自显式命令或此处结构化 action，不做自然语言猜测 */
export const chatActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), text: z.string().min(1, "创建内容不能为空") }),
  z.object({ type: z.literal("query"), text: z.string().min(1, "查询内容不能为空") }),
  z.object({
    type: z.literal("update"),
    memoryId: z.string().min(1, "更新必须提供记忆 ID"),
    text: z.string().min(1, "更新指令不能为空"),
  }),
  z.object({
    type: z.literal("delete"),
    memoryId: z.string().min(1, "删除必须提供记忆 ID"),
  }),
]);

export type ChatAction = z.infer<typeof chatActionSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, "messages 至少需要一条消息"),
  mode: z.enum(["chat", "memory", "prompt"]).default("chat"),
  sessionId: chatSessionIdSchema.default("default"),
  memoryIds: z.array(z.string()).optional(),
  action: chatActionSchema.optional(),
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

const notesPathSchema = z
  .string()
  .trim()
  .min(1, "notesPath 不能为空")
  .refine(
    (notesPath) => notesPath !== "." && notesPath !== ".." && !notesPath.includes(".."),
    "路径不合法：不允许使用 .. 进行路径遍历",
  );

export const storageConfigUpdateSchema = z
  .object({
    notesPath: notesPathSchema,
    copyExisting: z.boolean().default(true),
  })
  .strict();

export const storageConfigPreviewSchema = z
  .object({
    notesPath: notesPathSchema,
  })
  .strict();

export const toolTypeSchema = z.enum([
  "codex",
  "claude-code",
  "cursor",
  "trae",
  "markdown",
  "text",
]);

const optionalTrimmedTextSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const toolSourceCreateSchema = z
  .object({
    name: z.string().trim().min(1, "name 不能为空"),
    toolType: toolTypeSchema,
    path: z.string().trim().min(1, "path 不能为空"),
    filePattern: z.string().trim().min(1, "filePattern 不能为空").default("*.jsonl"),
    enabled: z.boolean().default(true),
    topic: optionalTrimmedTextSchema,
    description: optionalTrimmedTextSchema,
  })
  .strict();

export const toolSourceUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "name 不能为空").optional(),
    toolType: toolTypeSchema.optional(),
    path: z.string().trim().min(1, "path 不能为空").optional(),
    filePattern: z.string().trim().min(1, "filePattern 不能为空").optional(),
    enabled: z.boolean().optional(),
    topic: optionalTrimmedTextSchema,
    description: optionalTrimmedTextSchema,
  })
  .strict()
  .refine((updates) => Object.keys(updates).length > 0, "至少提供一个可更新字段");
