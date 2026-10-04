import { ConversationLearningService } from "../services/conversation-learning-service";
import { logger } from "../../lib/logger";

/**
 * ConversationLearningWorker — 按现有后台 worker 生命周期消费学习任务。
 *
 * 第九块：服务默认无处理器，processNextLearningTask 返回 no-processor，
 * 任务保持 queued——本块不创建知识（第十块接入真实分析后注入处理器）。
 * 启动时恢复被中断的 processing 任务为 queued；失败任务不自动重试。
 */
export class ConversationLearningWorker {
  private service: ConversationLearningService;
  private isRunning = false;

  constructor() {
    this.service = new ConversationLearningService();
  }

  async start(): Promise<void> {
    this.isRunning = true;
    try {
      const recovered = this.service.recoverInterruptedTasks();
      if (recovered > 0) {
        logger.chat.info(`恢复 ${recovered} 个被中断的学习任务为 queued`);
      }
    } catch (error) {
      logger.chat.error("学习任务中断恢复失败（不阻塞启动）", {
        error: (error as Error).message,
      });
    }
    await this.processLoop();
  }

  stop(): void {
    this.isRunning = false;
  }

  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.service.processNextLearningTask();
      } catch (error) {
        logger.chat.error("Learning worker error:", { error: (error as Error).message });
      }
      await this.sleep(10000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
