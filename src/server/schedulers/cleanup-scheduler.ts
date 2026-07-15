import { CleanupWorker } from "../workers/cleanup-worker";

export class CleanupScheduler {
  private worker: CleanupWorker;
  private intervalId: number | null = null;

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
        console.error("Cleanup scheduler error:", error);
      }
    }, 86400000) as unknown as number;
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