import { AuditWorker } from "../workers/audit-worker";

export class AuditScheduler {
  private worker: AuditWorker;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.worker = new AuditWorker();
  }

  start(): void {
    this.worker.start();

    this.intervalId = setInterval(async () => {
      await this.worker.retryFailedEvents();
    }, 60000);
  }

  stop(): void {
    this.worker.stop();

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
