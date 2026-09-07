import { MemoryRetentionService } from "../services/retention-service";
import { MemoryService } from "../services/memory-service";
import { HeatService } from "../services/heat-service";
import { ConfidenceService } from "../services/confidence-service";
import { logger } from "../../lib/logger";
import { RETENTION_RUN_INTERVAL_MS } from "../../config/constants";

/** 每 24 个 retention 周期（约 24 小时）对检索弱信号做一次日衰减 */
const RETRIEVAL_DECAY_EVERY_N_LOOPS = 24;

export class RetentionWorker {
  private retentionService: MemoryRetentionService;
  private memoryService: MemoryService;
  private isRunning: boolean = false;
  private loopCount: number = 0;

  constructor() {
    this.memoryService = new MemoryService();
    this.retentionService = new MemoryRetentionService(this.memoryService);
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

      // 派生分值重算（F-2 热度 / I-4 置信度衰减 / I-9 弱信号日衰减）
      try {
        await this.refreshDerivedScores();
      } catch (error) {
        logger.retention.error("派生分值重算失败", { error: (error as Error).message });
      }

      await this.sleep(RETENTION_RUN_INTERVAL_MS);
    }
  }

  /**
   * heatScore 与 confidence 是 sortable/rankable 的派生字段，
   * 建卡后长期不重算会让 ranker 的 heat 因子与 retention 冷热判据失效。
   */
  private async refreshDerivedScores(): Promise<void> {
    const memories = this.memoryService.listMemories();
    if (memories.length === 0) return;

    const heats = await HeatService.create().then((service) => service.recalculate(memories));
    for (const [id, heatScore] of heats) {
      this.memoryService.updateHeatScore(id, heatScore);
    }

    const hoursElapsed = Math.max(RETENTION_RUN_INTERVAL_MS / 3_600_000, 0);
    const confidences = ConfidenceService.decayAll(memories, hoursElapsed);
    for (const [id, confidence] of confidences) {
      this.memoryService.updateConfidence(id, confidence);
    }

    this.loopCount += 1;
    if (this.loopCount % RETRIEVAL_DECAY_EVERY_N_LOOPS === 0) {
      this.memoryService.decayRetrievalCounts();
    }

    logger.retention.info("派生分值重算完成", {
      memories: memories.length,
      confidenceDecayed: confidences.size,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
