import { Orchestrator } from "../services/orchestrator";
import { RETRY_DELAYS } from "../../config/constants";
import { logger } from "../../lib/logger";

export class AuditWorker {
  private orchestrator: Orchestrator;
  private isRunning: boolean = false;

  constructor() {
    this.orchestrator = new Orchestrator();
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
        await this.orchestrator.processQueue();
      } catch (error) {
        logger.audit.error("Audit worker error:", { error: (error as Error).message });
      }
      await this.sleep(10000);
    }
  }

  async retryFailedEvents(): Promise<void> {
    const stmt = this.orchestrator["memoryService"]["db"].prepare(
      "SELECT * FROM pending_events WHERE status = 'failed' AND retryCount < 3",
    );
    const rows = stmt.all() as any[];

    for (const row of rows) {
      const delay = RETRY_DELAYS[row.retryCount] || 60000;
      await this.sleep(delay);

      const stmtUpdate = this.orchestrator["memoryService"]["db"].prepare(
        "UPDATE pending_events SET status = 'pending' WHERE eventId = ?",
      );
      stmtUpdate.run(row.eventId);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
