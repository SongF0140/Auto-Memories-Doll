import { VectorWorker } from "../workers/vector-worker";

export class VectorScheduler {
  private worker: VectorWorker;
  private intervalId: number | null = null;

  constructor() {
    this.worker = new VectorWorker();
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      try {
        await this.worker.rebuildAllVectors();
      } catch (error) {
        console.error("Vector scheduler error:", error);
      }
    }, 3600000) as unknown as number;
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