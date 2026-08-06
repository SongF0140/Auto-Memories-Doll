import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { WikiGraph } from "../../lib/graph/wiki-graph";
import { logger } from "../../lib/logger";

export interface LinkSuggestion {
  from: { id: string; title: string };
  to: { id: string; title: string };
  reason: string;
}

export interface LinkSupplementReport {
  suggestions: LinkSuggestion[];
  addedCount: number;
  failedCount: number;
}

/**
 * wikilink 关联补充器（旗舰模型 + WikiGraph 协同）。
 *
 * 发现内容相关但尚未建立 [[wikilink]] 的记忆对，自动补充。
 *
 * 流程：
 * 1. 获取当日记忆及其现有邻居
 * 2. 旗舰模型分析，找出应链接但未链接的记忆对
 * 3. 调用 WikiGraph.addWikilinkToFile 落盘
 */
export class LinkSupplementer {
  private wikiGraph: WikiGraph;

  constructor() {
    this.wikiGraph = new WikiGraph();
  }

  async supplement(
    todaysMemories: MemoryRecord[],
    allMemories: MemoryRecord[],
  ): Promise<LinkSupplementReport> {
    if (todaysMemories.length === 0 || allMemories.length <= 1) {
      return { suggestions: [], addedCount: 0, failedCount: 0 };
    }

    // 获取当日记忆的现有邻居
    const existingLinksMap = new Map<string, Set<string>>();
    for (const mem of todaysMemories) {
      const neighbors = await this.wikiGraph.getNeighbors(mem.id);
      existingLinksMap.set(mem.id, new Set(neighbors));
    }

    // 旗舰模型分析：找应链接但未链接的对
    const suggestions = await this.findMissingLinks(todaysMemories, allMemories, existingLinksMap);

    // 自动补充 wikilink
    let addedCount = 0;
    let failedCount = 0;

    for (const s of suggestions) {
      try {
        // 找到 from 记忆对应的笔记文件
        const fromFilePath = await this.findMemoryFile(s.from.id);
        if (fromFilePath) {
          await this.wikiGraph.addWikilinkToFile(fromFilePath, s.to.id);
          addedCount++;
        }
      } catch (e) {
        logger.nightly.warn("wikilink 补充写入失败", {
          from: s.from.id,
          to: s.to.id,
          error: (e as Error).message,
        });
        failedCount++;
      }
    }

    return { suggestions, addedCount, failedCount };
  }

  private async findMissingLinks(
    todaysMemories: MemoryRecord[],
    allMemories: MemoryRecord[],
    existingLinksMap: Map<string, Set<string>>,
  ): Promise<LinkSuggestion[]> {
    // 构建上下文：当日记忆 + 候选链接目标（同 topic 或同 tag 的旧记忆）
    const todayText = todaysMemories
      .map(
        (m) =>
          `[${m.id}] "${m.title}" (topic: ${m.topic}, tags: ${m.tags.join(", ")})
  摘要: ${m.summary}
  已有链接: ${[...(existingLinksMap.get(m.id) || [])].join(", ") || "无"}`,
      )
      .join("\n\n");

    // 候选链接目标（排除今日记忆和非同 topic 的记忆）
    const todayTopics = new Set(todaysMemories.map((m) => m.topic));
    const todayIds = new Set(todaysMemories.map((m) => m.id));
    const candidates = allMemories.filter(
      (m) => !todayIds.has(m.id) && (todayTopics.has(m.topic) || todaysMemories.some((t) => t.tags.some((tag) => m.tags.includes(tag)))),
    ).slice(0, 30);

    const candidatesText = candidates
      .map((m) => `[${m.id}] "${m.title}" (topic: ${m.topic}, tags: ${m.tags.join(", ")}) | ${m.summary}`)
      .join("\n");

    const prompt = `分析以下今日记忆和候选记忆，找出应该建立 [[wikilink]] 关联但尚未链接的记忆对。

## 今日记忆
${todayText}

## 候选链接目标
${candidatesText}

返回 JSON 数组，每项格式：
{
  "fromId": "今日记忆的 ID",
  "toId": "候选目标的 ID",
  "reason": "为什么应该链接（一句话中文说明）"
}

规则：
- 只返回有明确语义关联的对（不要随意建议）
- 理由要具体，说明两段内容之间的关联
- 已有链接的不要再建议

只返回 JSON 数组，不要其他文字。`;

    try {
      const response = await ModelAdapter.generate(prompt, "flagship");
      const jsonStr = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

      const analyzed = JSON.parse(jsonStr);
      if (!Array.isArray(analyzed)) return [];

      const memoryMap = new Map(allMemories.map((m) => [m.id, m]));
      return analyzed
        .filter((item: any) => item.fromId && item.toId && memoryMap.has(item.fromId) && memoryMap.has(item.toId))
        .map((item: any) => ({
          from: { id: item.fromId, title: memoryMap.get(item.fromId)!.title },
          to: { id: item.toId, title: memoryMap.get(item.toId)!.title },
          reason: item.reason || "语义关联",
        }));
    } catch {
      return [];
    }
  }

  /** 根据 memoryId 查找对应的笔记文件路径 */
  private async findMemoryFile(memoryId: string): Promise<string | null> {
    const files = await this.wikiGraph.scanAllFiles();
    // 简单启发式：文件名可能包含 memoryId 或标题的一部分
    for (const file of files) {
      if (file.includes(memoryId)) return file;
    }
    return null;
  }

  close(): void {
    this.wikiGraph.invalidateCache();
  }
}
