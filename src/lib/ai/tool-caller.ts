import { ZodTypeAny } from "zod";
import { ToolName, toolSchemas } from "./tool-schemas";

export type ToolCall = {
  toolName: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolName: string;
  success: boolean;
  /** 给模型读的自然语言摘要，始终有值 */
  content: string;
  /** 给 UI / 日志消费的结构化元数据 */
  data?: unknown;
  error?: string;
};

type ToolHandler = {
  schema: ZodTypeAny;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  description: string;
};

export class ToolCaller {
  private static tools = new Map<string, ToolHandler>();

  /** 注册工具：绑定名称、Zod schema、执行器和描述 */
  static registerTool(
    name: ToolName,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
    description: string,
  ): void {
    this.tools.set(name, {
      schema: toolSchemas[name],
      handler,
      description,
    });
  }

  /** 获取所有已注册工具的描述（用于系统提示） */
  static getToolDescriptions(): Array<{ name: string; description: string; schema: object }> {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      schema: (tool.schema._def ?? {}) as unknown as Record<string, unknown>,
    }));
  }

  /** 执行工具调用：先 Zod 校验参数，再执行 handler */
  static async callTool(toolCall: ToolCall): Promise<ToolResult> {
    const entry = this.tools.get(toolCall.toolName);

    if (!entry) {
      return {
        toolName: toolCall.toolName,
        success: false,
        content: `工具 "${toolCall.toolName}" 未找到`,
        error: `Tool "${toolCall.toolName}" not found`,
      };
    }

    // Zod 校验
    const parseResult = entry.schema.safeParse(toolCall.arguments);
    if (!parseResult.success) {
      const errMsg = `参数校验失败: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      return {
        toolName: toolCall.toolName,
        success: false,
        content: errMsg,
        error: errMsg,
      };
    }

    try {
      const result = await entry.handler(parseResult.data as Record<string, unknown>);
      // 工具结果分层：content 给模型读（自然语言），data 给 UI/日志（结构化）
      const resultObj = result as Record<string, unknown> | undefined;
      const content =
        resultObj?.content != null
          ? String(resultObj.content)
          : JSON.stringify(result);
      return {
        toolName: toolCall.toolName,
        success: true,
        content,
        data: result,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        toolName: toolCall.toolName,
        success: false,
        content: `工具执行失败: ${errMsg}`,
        error: errMsg,
      };
    }
  }

  static getAvailableTools(): string[] {
    return Array.from(this.tools.keys());
  }

  static reset(): void {
    this.tools.clear();
  }
}
