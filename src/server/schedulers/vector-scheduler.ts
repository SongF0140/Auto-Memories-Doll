import { VectorWorker } from "../workers/vector-worker";
import { logger } from "../../lib/logger";

export class VectorScheduler {
  private worker: VectorWorker;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.worker = new VectorWorker();
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      try {
        await this.worker.rebuildAllVectors();
      } catch (error) {
        logger.audit.error("Vector scheduler error:", { error: (error as Error).message });
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
    await this.worker.rebuildAllVectors();
  }
}
