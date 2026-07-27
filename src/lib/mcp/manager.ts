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

  async listAllTools(): Promise<{ serverId: string; tools: McpTool[] }[]> {
    const servers = this.listEnabledServers();
    const results: { serverId: string; tools: McpTool[] }[] = [];

    for (const server of servers) {
      const tools = this.discoverTools(server);
      if (tools.length > 0) {
        results.push({ serverId: server.id, tools });
      }
    }

    return results;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const server = this.getServer(serverId);
    if (!server || !server.enabled) {
      throw new Error(`MCP 服务器 "${serverId}" 未找到或未启用`);
    }

    throw new Error(
      `MCP 服务器 "${server.name}" 尚未配置通信协议。请在设置中为该 MCP 服务器提供有效的 stdio 命令或 SSE 端点。`
    );
  }

  close(): void {
    this.configService.close();
  }

  private discoverTools(_server: McpServerConfig): McpTool[] {
    return [];
  }
}
