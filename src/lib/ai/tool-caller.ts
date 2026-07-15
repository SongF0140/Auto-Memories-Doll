export type ToolCall = {
  toolName: string;
  arguments: Record<string, any>;
};

export type ToolResult = {
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
};

export class ToolCaller {
  private static tools: Record<string, (args: Record<string, any>) => Promise<any>> = {};

  static registerTool(name: string, handler: (args: Record<string, any>) => Promise<any>): void {
    this.tools[name] = handler;
  }

  static async callTool(toolCall: ToolCall): Promise<ToolResult> {
    const handler = this.tools[toolCall.toolName];
    
    if (!handler) {
      return {
        toolName: toolCall.toolName,
        success: false,
        error: `Tool "${toolCall.toolName}" not found`,
      };
    }

    try {
      const result = await handler(toolCall.arguments);
      return {
        toolName: toolCall.toolName,
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        toolName: toolCall.toolName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  static getAvailableTools(): string[] {
    return Object.keys(this.tools);
  }
}