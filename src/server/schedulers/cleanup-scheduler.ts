import { CleanupWorker } from "../workers/cleanup-worker";
import { logger } from "../../lib/logger";

export class CleanupScheduler {
  private worker: CleanupWorker;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.worker = new CleanupWorker();
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      try {
        await this.worker.cleanupOldEvents();
        await this.worker.cleanupResolvedConflicts();
        await this.worker.vacuum();
      } catch (error) {
        logger.audit.error("Cleanup scheduler error:", { error: (error as Error).message });
      }
    }, 86400000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.worker.close();
  }

  async triggerCleanup(): Promise<void> {
    await this.worker.cleanupOldEvents();
    await this.worker.cleanupResolvedConflicts();
    await this.worker.vacuum();
  }
}
