import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { buildEmbeddingKey } from "../../lib/vector/generator";
import { MemoryService } from "./memory-service";
import { VectorWorker } from "../workers/vector-worker";
import { writeMemoryMarkdown } from "../../lib/storage/memory-writer";
import { logger } from "../../lib/logger";

/** 每批回填的卡片数：分批限流，避免单次 tick 打满 LLM 配额 */
const BACKFILL_BATCH_SIZE = 10;

/** windowUse 最大长度：与抽卡服务的 120 字约定一致，留少量余量 */
const WINDOW_USE_MAX_CHARS = 160;

export type BackfillResult = {
  /** 本批成功回填（DB + Markdown + 向量三者均已更新）的卡片数 */
  processed: number;
  /** 是否仍有缺 windowUse 的卡片（true 时下个 tick 继续） */
  remaining: boolean;
};

/**
 * windowUse 存量回填服务（I-11 迁移第一步）。
 *
 * 背景：I-11 把 embedding 键从 content 改为 summary + windowUse，但生产库的
 * 存量卡片没有 windowUse 字段——若直接重嵌，buildEmbeddingKey 会回退到 content，
 * 白烧 embedding 配额且键分布不变。因此迁移必须分两步：
 *   1. 本服务用 LLM 为存量卡生成 windowUse（"当用户问 X / 需要做 Y 时有用"）
 *   2. 卡片回填完成后立即用新键重建该卡向量（回填与重嵌绑定，天然断点续跑）
 *
 * 断点语义：无需游标表——"还有没有缺 windowUse 的行"本身就是断点，
 * 失败的卡片留在原地，下个 tick 重试；全量补齐后本服务空转（一次 COUNT 即返回）。
 *
 * 一致性：DB 更新后同步重写 Markdown front matter（memory-writer 全量重写，
 * windowUse 字段由 markdown-formatter 输出），保持文件与 DB 一致（项目红线）。
 */
export class WindowUseBackfillService {
  private memoryService: MemoryService;
  private vectorWorker: VectorWorker;

  constructor(memoryService: MemoryService = new MemoryService()) {
    this.memoryService = memoryService;
    this.vectorWorker = new VectorWorker();
  }

  /** 还有多少卡片缺 windowUse（供 UI/诊断展示迁移进度） */
  countPending(): number {
    return this.memoryService.countMissingWindowUse();
  }

  /**
   * 处理一批缺 windowUse 的卡片：生成 → 更新 DB → 同步 Markdown → 重建向量。
   * 单卡失败不中断本批（跳过留待下轮），全部失败时返回 processed=0。
   */
  async processBatch(batchSize: number = BACKFILL_BATCH_SIZE): Promise<BackfillResult> {
    // 模型降级时无法生成 → 本轮跳过，模型恢复后自动继续
    if (ModelAdapter.isDegradedMode) {
      return { processed: 0, remaining: this.countPending() > 0 };
    }

    const pending = this.memoryService.getMemoriesMissingWindowUse(batchSize);
    let processed = 0;

    for (const memory of pending) {
      try {
        const windowUse = await this.generateWindowUse(memory);
        if (!windowUse) continue; // 生成失败/输出非法 → 留待下轮

        this.memoryService.updateMemory(memory.id, { windowUse });

        // Markdown 与 DB 同步：全量重写 front matter（含 windowUse 行）
        await writeMemoryMarkdown({ ...memory, windowUse });

        // 立即用新键重嵌该卡（回填与重嵌绑定，避免二次扫描）
        const key = buildEmbeddingKey({
          summary: memory.summary,
          windowUse,
          content: memory.content,
        });
        await this.vectorWorker.updateVector(memory.id, key);

        processed += 1;
      } catch (error) {
        logger.audit.error(`windowUse 回填失败（${memory.id}），留待下轮重试`, {
          error: (error as Error).message,
        });
      }
    }

    return { processed, remaining: this.countPending() > 0 };
  }

  close(): void {
    this.memoryService.close();
    this.vectorWorker.close();
  }

  /**
   * 用 LLM 为单张卡生成 windowUse。输出限定 JSON：{"windowUse": "..."}，
   * 格式约定与抽卡服务（memory-extraction-service）保持一致，保证键分布同源。
   */
  private async generateWindowUse(memory: MemoryRecord): Promise<string | null> {
    const prompt = [
      '为下面这张知识卡生成一行"使用场景"（windowUse），说明它在什么场景下对用户有用。',
      "要求：",
      `1. 120 字以内，格式如"当用户问 X / 需要做 Y / 排查 Z 问题时"。`,
      "2. 只用卡片确实包含的信息，不要编造。",
      '3. 只回复 JSON，不要多余解释：{"windowUse": "..."}',
      "",
      `标题：${memory.title}`,
      `摘要：${memory.summary}`,
      "",
      `正文：${memory.content.slice(0, 4000)}`,
    ].join("\n");

    try {
      const response = await ModelAdapter.generate(prompt, "standard");
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as { windowUse?: unknown };
      if (typeof parsed.windowUse !== "string") return null;
      const windowUse = parsed.windowUse.trim().slice(0, WINDOW_USE_MAX_CHARS);
      return windowUse.length > 0 ? windowUse : null;
    } catch (error) {
      logger.audit.warn(`windowUse 生成调用失败（${memory.id}）`, {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
