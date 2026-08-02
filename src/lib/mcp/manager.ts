import { McpServerConfig } from "../../types/config";
import { ConfigService } from "../../server/services/config-service";
import { McpNotFoundError, McpNotConfiguredError } from "../errors";

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
    return this.configService.listMcpServers().filter((s) => s.enabled);
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
      throw new McpNotFoundError(serverId);
    }

    throw new McpNotConfiguredError(server.name);
  }

  /**
   * 公开的工具发现接口，供 IngestBridge 判断服务器是否提供 collect_memory 工具。
   * 当前为占位实现，接入真实 MCP SDK 后替换为协议调用。
   */
  async discoverToolsPublic(serverId: string): Promise<McpTool[]> {
    const server = this.getServer(serverId);
    if (!server) return [];
    return this.discoverTools(server);
  }

  close(): void {
    this.configService.close();
  }

  private discoverTools(_server: McpServerConfig): McpTool[] {
    return [];
  }
}
