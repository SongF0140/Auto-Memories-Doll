import { AuditWorker } from "../workers/audit-worker";

export class AuditScheduler {
  private worker: AuditWorker;
  private intervalId: number | null = null;

  constructor() {
    this.worker = new AuditWorker();
  }

  start(): void {
    this.worker.start();
    
    this.intervalId = setInterval(async () => {
      await this.worker.retryFailedEvents();
    }, 60000) as unknown as number;
  }

  stop(): void {
    this.worker.stop();
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}