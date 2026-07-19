import { McpServerConfig } from "../../types/config";
import { ConfigService } from "../../server/services/config-service";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
};

export class McpManager {
  private configService: ConfigService;

  constructor() {
    this.configService = new ConfigService();
  }

  listEnabledServers(): McpServerConfig[] {
    return this.configService.listMcpServers().filter(s => s.enabled);
  }

  getServer(id: string): McpServerConfig | null {
    return this.configService.getMcpServer(id);
  }

  /**
   * 获取所有已启用 MCP 服务器提供的工具列表
   */
  async listAllTools(): Promise<{ serverId: string; tools: McpTool[] }[]> {
    const servers = this.listEnabledServers();
    const results: { serverId: string; tools: McpTool[] }[] = [];

    for (const server of servers) {
      results.push({
        serverId: server.id,
        tools: this.mockToolsForServer(server),
      });
    }

    return results;
  }

  /**
   * 调用 MCP 工具
   * 当前为演示实现，真实场景需要通过 stdio/SSE 与 MCP 服务器通信
   */
  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const server = this.getServer(serverId);
    if (!server || !server.enabled) {
      throw new Error(`MCP server "${serverId}" not found or disabled`);
    }

    console.log(`[MCP] Calling ${toolName} on ${server.name} with args:`, args);

    return {
      serverId,
      toolName,
      args,
      status: "mock-executed",
      result: `Tool ${toolName} executed via ${server.name}`,
    };
  }

  close(): void {
    this.configService.close();
  }

  private mockToolsForServer(server: McpServerConfig): McpTool[] {
    const defaultTools: McpTool[] = [
      {
        name: `${server.name.toLowerCase().replace(/\s+/g, "_")}_query`,
        description: `Query data from ${server.name}`,
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
    ];
    return defaultTools;
  }
}
