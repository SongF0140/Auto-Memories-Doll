import { VectorWorker } from "../workers/vector-worker";
import { logger } from "../../lib/logger";

export class VectorScheduler {
  private worker: VectorWorker;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  /** 防止上一次重建未完成时新定时触发导致并发写同一向量 */
  private isRebuilding = false;

  constructor() {
    this.worker = new VectorWorker();
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      if (this.isRebuilding) {
        logger.audit.warn("VectorScheduler: 上一次向量重建尚未完成，跳过本轮");
        return;
      }
      try {
        this.isRebuilding = true;
        await this.worker.rebuildAllVectors();
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
  }

  async triggerRebuild(): Promise<void> {
    if (this.isRebuilding) {
      logger.audit.warn("VectorScheduler: 向量重建正在进行，跳过手动触发");
      return;
    }
    try {
      this.isRebuilding = true;
      await this.worker.rebuildAllVectors();
    } finally {
      this.isRebuilding = false;
    }
  }
}
