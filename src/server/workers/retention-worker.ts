import { MemoryRetentionService } from "../services/retention-service";
import { MemoryService } from "../services/memory-service";
import { logger } from "../../lib/logger";
import { RETENTION_RUN_INTERVAL_MS } from "../../config/constants";

export class RetentionWorker {
  private retentionService: MemoryRetentionService;
  private isRunning: boolean = false;

  constructor() {
    this.retentionService = new MemoryRetentionService(new MemoryService());
  }

  async start(): Promise<void> {
    this.isRunning = true;
    await this.processLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.retentionService.runRetention();
      } catch (error) {
        logger.retention.error("Retention worker error", { error: (error as Error).message });
      }
      await this.sleep(RETENTION_RUN_INTERVAL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
