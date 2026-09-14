import { VectorWorker } from "../workers/vector-worker";
import { WindowUseBackfillService } from "../services/window-use-backfill-service";
import { logger } from "../../lib/logger";

export class VectorScheduler {
  private worker: VectorWorker;
  /** I-11 存量迁移：先回填 windowUse（LLM），回填完成的卡才进入向量重建 */
  private backfill: WindowUseBackfillService;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  /** 防止上一次重建未完成时新定时触发导致并发写同一向量 */
  private isRebuilding = false;

  constructor() {
    this.worker = new VectorWorker();
    this.backfill = new WindowUseBackfillService();
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      if (this.isRebuilding) {
        logger.audit.warn("VectorScheduler: 上一次向量重建尚未完成，跳过本轮");
        return;
      }
      try {
        this.isRebuilding = true;
        await this.runMigrationCycle();
      } catch (error) {
        logger.audit.error("Vector scheduler error:", { error: (error as Error).message });
      } finally {
        this.isRebuilding = false;
      }
    }, 3600000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.worker.close();
    this.backfill.close();
  }

  async triggerRebuild(): Promise<void> {
    if (this.isRebuilding) {
      logger.audit.warn("VectorScheduler: 向量重建正在进行，跳过手动触发");
      return;
    }
    try {
      this.isRebuilding = true;
      await this.runMigrationCycle();
    } finally {
      this.isRebuilding = false;
    }
  }

  /**
   * 单轮迁移周期：回填一批 windowUse（每批完成即重嵌）→ 常规向量重建。
   * 回填失败不影响重建（各自 try/catch）；全量补齐后回填空转，只剩重建开销。
   */
  private async runMigrationCycle(): Promise<void> {
    try {
      const result = await this.backfill.processBatch();
      if (result.processed > 0 || result.remaining) {
        logger.audit.info("VectorScheduler: windowUse 回填推进", {
          processed: result.processed,
          remaining: result.remaining,
        });
      }
    } catch (error) {
      logger.audit.error("windowUse 回填失败，跳过本轮回填", {
        error: (error as Error).message,
      });
    }

    await this.worker.rebuildAllVectors();
  }
}
