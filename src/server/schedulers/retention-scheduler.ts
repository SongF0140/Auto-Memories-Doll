import { RetentionWorker } from "../workers/retention-worker";

export class RetentionScheduler {
  private worker: RetentionWorker;

  constructor() {
    this.worker = new RetentionWorker();
  }

  start(): void {
    this.worker.start();
  }

  stop(): void {
    this.worker.stop();
  }
}
