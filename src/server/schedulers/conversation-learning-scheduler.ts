import { ConversationLearningWorker } from "../workers/conversation-learning-worker";

/** 学习任务调度器：与 audit/vector 等调度器同生命周期（instrumentation 注册） */
export class ConversationLearningScheduler {
  private worker: ConversationLearningWorker;

  constructor() {
    this.worker = new ConversationLearningWorker();
  }

  start(): void {
    void this.worker.start();
  }

  stop(): void {
    this.worker.stop();
  }
}
