import { McpManager } from "./manager";
import { SkillManager } from "../skills/manager";
import { MemoryService } from "../../server/services/memory-service";
import { logger } from "../logger";

export type IngestPayload = {
  source: string;
  sourceType: "chat" | "ingest" | "manual" | "mcp" | "skill" | "listen";
  title: string;
  content: string;
  summary: string;
  tags: string[];
  topic: string;
};

/**
 * MCP / Skills → ingest 管线桥接器。
 *
 * 职责：
 * 1. 遍历所有已启用的 MCP 服务器，调用其约定的 `collect_memory` 工具（如存在），
 *    将返回的结构化数据转为 IngestPayload，通过 MemoryService.stageCreateMemory 入队。
 * 2. 遍历已启用的 skills，对标记为 `autoIngest: true` 的 skill 执行采集。
 *
 * 当 MCP 服务器连接失败或未实现 `collect_memory` 工具时，自动跳过不报错。
 */
export class McpIngestBridge {
  private mcpManager: McpManager;
  private skillManager: SkillManager;

  constructor() {
    this.mcpManager = new McpManager();
    this.skillManager = new SkillManager();
  }

  /**
   * 从所有已启用的 MCP 服务器采集数据，送入待审计队列。
   * 返回成功采集的条目数。
   */
  async collectFromMcpServers(): Promise<number> {
    const servers = this.mcpManager.listEnabledServers();
    let collected = 0;

    for (const server of servers) {
      try {
        const tools = await this.mcpManager.discoverToolsPublic(server.id);
        const hasCollector = tools.some((t) => t.name === "collect_memory");
        if (!hasCollector) continue;

        const result = await this.mcpManager.callTool(server.id, "collect_memory", {});
        const payloads = this.normalizeMcpResult(result, server.id);

        for (const payload of payloads) {
          const memoryService = new MemoryService();
          try {
            memoryService.stageCreateMemory(
              payload.source,
              payload.sourceType,
              payload.title,
              payload.content,
              payload.summary,
              payload.tags,
              payload.topic,
            );
            collected++;
          } finally {
            memoryService.close();
          }
        }
      } catch (error) {
        logger.ingest.warn(`MCP 服务器 ${server.id} 采集失败`, { error: (error as Error).message });
      }
    }

    if (collected > 0) {
      logger.ingest.info(`MCP 采集完成，共 ${collected} 条`);
    }
    return collected;
  }

  /**
   * 执行所有标记为 autoIngest 的 skill，将输出送入待审计队列。
   */
  async collectFromSkills(): Promise<number> {
    const skills = this.skillManager.listEnabledSkills().filter((s) => (s as any).autoIngest);
    let collected = 0;

    for (const skill of skills) {
      try {
        const output = this.skillManager.applySkill("", skill);
        if (!output || output.trim().length < 10) continue;

        const memoryService = new MemoryService();
        try {
          memoryService.stageCreateMemory(
            `skill:${skill.id}`,
            "skill",
            skill.name || skill.id,
            output,
            output.slice(0, 200),
            skill.tags || [],
            skill.topic || "uncategorized",
          );
          collected++;
        } finally {
          memoryService.close();
        }
      } catch (error) {
        logger.ingest.warn(`Skill ${skill.id} 采集失败`, { error: (error as Error).message });
      }
    }

    return collected;
  }

  /**
   * 一次性从 MCP 和 Skills 采集全部数据。
   */
  async collectAll(): Promise<{ mcp: number; skills: number }> {
    const mcp = await this.collectFromMcpServers();
    const skills = await this.collectFromSkills();
    return { mcp, skills };
  }

  close(): void {
    this.mcpManager.close();
    this.skillManager.close();
  }

  private normalizeMcpResult(result: unknown, serverId: string): IngestPayload[] {
    if (!result) return [];

    // 约定 MCP collect_memory 返回 { items: [...] } 或直接返回数组
    const items = Array.isArray(result)
      ? result
      : (result as any)?.items || (result as any)?.data || [result as any];

    return items
      .filter((item: any) => item && (item.content || item.text || item.body))
      .map((item: any) => ({
        source: `mcp:${serverId}`,
        sourceType: "mcp" as const,
        title: item.title || item.name || `MCP 采集 ${serverId}`,
        content: item.content || item.text || item.body,
        summary: item.summary || (item.content || item.text || item.body || "").slice(0, 200),
        tags: item.tags || [],
        topic: item.topic || "mcp-collected",
      }));
  }
}
