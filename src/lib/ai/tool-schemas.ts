import { z } from "zod";

/** 工具参数校验 schema —— 每个工具独立定义，由 ToolCaller 在调用前校验 */
export const toolSchemas = {
  search_memory: z.object({
    query: z.string().min(1, "查询词不能为空"),
    limit: z.number().int().min(1).max(20).optional().default(10),
  }),

  create_memory: z.object({
    title: z.string().min(1, "标题不能为空"),
    content: z.string().min(1, "内容不能为空"),
    tags: z.array(z.string()).optional().default([]),
    summary: z.string().optional(),
  }),

  update_memory: z.object({
    id: z.string().min(1, "记忆 ID 不能为空"),
    updates: z.record(z.string(), z.unknown()).refine(
      (obj) => Object.keys(obj).length > 0,
      "至少提供一个更新字段",
    ),
  }),

  correct_memory: z
    .object({
      memoryId: z.string().optional(),
      locateQuery: z.string().optional(),
      instruction: z.string().min(1, "纠错指令不能为空"),
    })
    .refine(
      (obj) => Boolean(obj.memoryId || (obj.locateQuery && obj.locateQuery.trim().length > 0)),
      { message: "必须提供 memoryId 或 locateQuery 之一用于定位记忆" },
    ),

  delete_memory: z.object({
    id: z.string().min(1, "记忆 ID 不能为空"),
  }),

  query_graph: z.object({
    memoryId: z.string().min(1, "记忆 ID 不能为空"),
    maxDepth: z.number().int().min(1).max(3).optional().default(1),
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolParams<T extends ToolName> = z.infer<(typeof toolSchemas)[T]>;
