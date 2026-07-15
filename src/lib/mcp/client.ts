export type McpRequest = {
  method: string;
  params: Record<string, any>;
};

export type McpResponse = {
  success: boolean;
  data?: any;
  error?: string;
};

export class McpClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:8081") {
    this.baseUrl = baseUrl;
  }

  async request(request: McpRequest): Promise<McpResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `MCP request failed: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getAvailableTools(): Promise<string[]> {
    const response = await this.request({ method: "list_tools", params: {} });
    return response.success ? (response.data as string[]) : [];
  }

  async invokeTool(toolName: string, params: Record<string, any>): Promise<McpResponse> {
    return this.request({ method: "invoke", params: { toolName, ...params } });
  }
}