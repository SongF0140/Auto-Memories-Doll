import { MemoryService } from "./memory-service";
import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";
import { writeMemoryMarkdown, updateAgentMarkdown } from "../../lib/storage/memory-writer";
import { updateIndexMap } from "../../lib/storage/index-writer";
import { getNotePath, getDeletedPath } from "../../lib/storage/path-resolver";
import { moveFile, ensureDirectory } from "../../lib/storage/file-manager";
import {
  MAX_TOTAL_MEMORIES,
  COMPRESSION_BATCH_SIZE,
  COMPRESSION_AGE_DAYS,
  COLD_HEAT_THRESHOLD,
} from "../../config/constants";

/**
 * 记忆压缩与遗忘服务。
 *
 * 职责：
 * 1. 当记忆总量超过阈值时，按“低热度 + 最旧”策略归档（遗忘）。
 * 2. 对同一话题下大量陈旧低热记忆进行摘要压缩，生成一条话题摘要记忆。
 *
 * 注意：压缩/遗忘属于系统内部维护任务，不经过待审计队列，避免自我递归。
 */
export class MemoryRetentionService {
  private memoryService: MemoryService;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
  }

  async runRetention(): Promise<void> {
    await this.enforceRetention();
    await this.compressOldMemories();
  }

  /**
   * 遗忘：总量超过 MAX_TOTAL_MEMORIES 时，归档多余记忆。
   */
  private async enforceRetention(): Promise<void> {
    const all = this.memoryService.listMemories({ limit: -1 });
    if (all.length <= MAX_TOTAL_MEMORIES) return;

    const overflow = all.length - MAX_TOTAL_MEMORIES;
    const candidates = this.sortByRetentionPriority(all).slice(0, overflow);

    logger.retention.info(`开始归档 ${candidates.length} 条 overflow 记忆`);

    for (const memory of candidates) {
      await this.archiveMemory(memory);
    }

    logger.retention.info(`overflow 归档完成`);
  }

  /**
   * 压缩：对陈旧低热记忆按话题生成摘要，合并为一条新记忆后删除原文。
   */
  private async compressOldMemories(): Promise<void> {
    const all = this.memoryService.listMemories({ limit: -1 });
    const coldOld = all.filter((m) => this.isColdAndOld(m));

    const byTopic = this.groupByTopic(coldOld);

    for (const [topic, memories] of byTopic.entries()) {
      if (memories.length < COMPRESSION_BATCH_SIZE) continue;

      // 每次只处理一批，避免一次生成过大摘要
      const batch = memories.slice(0, COMPRESSION_BATCH_SIZE);
      await this.compressBatch(topic, batch);
    }
  }

  private async compressBatch(topic: string, memories: MemoryRecord[]): Promise<void> {
    const summary = await this.generateBatchSummary(topic, memories);
    const tags = [...new Set(memories.flatMap((m) => m.tags))];

    const compressedId = await this.memoryService.createMemory(
      "system-retention",
      "manual",
      `${topic} 历史摘要`,
      summary,
      `由 ${memories.length} 条 ${topic} 话题历史记忆压缩生成的摘要`,
      tags,
      topic,
    );

    const compressed = this.memoryService.getMemory(compressedId)!;
    const all = this.memoryService.listMemories({ limit: -1 });

    await Promise.all([
      writeMemoryMarkdown(compressed),
      updateAgentMarkdown(topic, all),
      updateIndexMap(all),
    ]);

    for (const memory of memories) {
      await this.archiveMemory(memory);
    }

    logger.retention.info(`已压缩 ${topic} 话题 ${memories.length} 条记忆为 ${compressedId}`);
  }

  private async generateBatchSummary(topic: string, memories: MemoryRecord[]): Promise<string> {
    const input = memories
      .map((m, i) => `${i + 1}. ${m.title}\n${m.summary || m.content}`)
      .join("\n\n");

    if (ModelAdapter.isDegradedMode) {
      return `# ${topic} 历史摘要\n\n${input}`;
    }

    const prompt = `请将以下 ${topic} 话题的 ${memories.length} 条历史记忆压缩成一段简洁的中文摘要，保留关键事实、决策和背景，去除重复和琐碎细节。\n\n${input}\n\n摘要：`;

    try {
      const response = await ModelAdapter.generate(prompt, "pro");
      return response.content.trim() || `# ${topic} 历史摘要\n\n${input}`;
    } catch (error) {
      logger.retention.warn("LLM 摘要失败，使用拼接回退", { error: (error as Error).message });
      return `# ${topic} 历史摘要\n\n${input}`;
    }
  }

  private async archiveMemory(memory: MemoryRecord): Promise<void> {
    const notePath = getNotePath(memory.topic, memory.id);
    const deletedDir = getDeletedPath();
    await ensureDirectory(deletedDir);
    const archivePath = `${deletedDir}/${memory.id}-${Date.now()}.md`;

    try {
      await moveFile(notePath, archivePath);
    } catch {
      // 文件可能不存在，忽略
    }

    this.memoryService.deleteMemory(memory.id);
  }

  private isColdAndOld(memory: MemoryRecord): boolean {
    const ageDays = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return memory.heatScore <= COLD_HEAT_THRESHOLD && ageDays >= COMPRESSION_AGE_DAYS;
  }

  private sortByRetentionPriority(memories: MemoryRecord[]): MemoryRecord[] {
    return [...memories].sort((a, b) => {
      if (a.heatScore !== b.heatScore) return a.heatScore - b.heatScore;
      return a.updatedAt.localeCompare(b.updatedAt);
    });
  }

  private groupByTopic(memories: MemoryRecord[]): Map<string, MemoryRecord[]> {
    const map = new Map<string, MemoryRecord[]>();
    for (const memory of memories) {
      const topic = memory.topic || "uncategorized";
      if (!map.has(topic)) map.set(topic, []);
      map.get(topic)!.push(memory);
    }
    return map;
  }
}
