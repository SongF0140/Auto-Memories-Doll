import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "../../types/config";
import { ConfigService } from "../../server/services/config-service";
import { McpNotFoundError, McpNotConfiguredError } from "../errors";
import { logger } from "../logger";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type ClientEntry = {
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
};

export class McpManager {
  private configService: ConfigService;
  /** 惰性连接缓存：serverId → { client, transport, tools } */
  private clients = new Map<string, ClientEntry>();

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
      try {
        const tools = await this.discoverTools(server);
        if (tools.length > 0) {
          results.push({ serverId: server.id, tools });
        }
      } catch (error) {
        logger.mcp.warn(`MCP 服务器 ${server.id} 工具发现失败`, {
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const server = this.getServer(serverId);
    if (!server || !server.enabled) {
      throw new McpNotFoundError(serverId);
    }

    try {
      const entry = await this.getOrConnect(server);
      const result = await entry.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (error) {
      if (error instanceof McpNotFoundError || error instanceof McpNotConfiguredError) {
        throw error;
      }
      // 包装网络/协议错误
      throw new McpNotConfiguredError(server.name, (error as Error).message);
    }
  }

  /**
   * 公开的工具发现接口，供 IngestBridge 判断服务器是否提供 collect_memory 工具。
   */
  async discoverToolsPublic(serverId: string): Promise<McpTool[]> {
    const server = this.getServer(serverId);
    if (!server) return [];
    try {
      return await this.discoverTools(server);
    } catch {
      return [];
    }
  }

  /** 关闭所有客户端连接 */
  close(): void {
    for (const [serverId, entry] of this.clients) {
      try {
        entry.client.close();
      } catch (error) {
        logger.mcp.warn(`MCP 客户端 ${serverId} 关闭失败`, {
          error: (error as Error).message,
        });
      }
    }
    this.clients.clear();
    this.configService.close();
  }

  // ── 私有方法 ──

  /**
   * 惰性连接：已缓存则直接返回，否则创建 stdio 传输并初始化。
   */
  private async getOrConnect(server: McpServerConfig): Promise<ClientEntry> {
    const existing = this.clients.get(server.id);
    if (existing) return existing;

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: server.env as Record<string, string>,
    });

    const client = new Client(
      { name: "auto-memories-doll", version: "1.0.0" },
      { capabilities: {} },
    );

    transport.onerror = (error) => {
      logger.mcp.error(`MCP ${server.id} 传输错误`, { error: error.message });
      this.clients.delete(server.id);
    };

    await client.connect(transport);

    const tools = await this.discoverToolsFromClient(client);
    const entry: ClientEntry = { client, transport, tools };
    this.clients.set(server.id, entry);

    logger.mcp.info(`MCP 已连接: ${server.id} (${tools.length} 工具)`);
    return entry;
  }

  private async discoverTools(server: McpServerConfig): Promise<McpTool[]> {
    const entry = await this.getOrConnect(server);
    return entry.tools;
  }

  private async discoverToolsFromClient(client: Client): Promise<McpTool[]> {
    const result = await client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));
  }
}
