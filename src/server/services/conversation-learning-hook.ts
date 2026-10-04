import { randomUUID } from "crypto";
import type { ChatMessage, ChatMode } from "../../types/api";
import type { AiStreamStatus } from "../../lib/ai/ai-events";
import { ConversationLearningService } from "./conversation-learning-service";
import { logger } from "../../lib/logger";

/**
 * 对话完成 → 增量学习入队钩子（两个聊天 route 共用，第九块契约 3.1）
 *
 * - turnId 由服务端生成，与 sessionId 无关；一次成功终态只入队一次
 * - 仅普通/记忆模式、completed 终态入队（error/abort/degraded 均不入队）
 * - 入队失败只记日志：不伪造"已保存"，也不把成功聊天改成失败
 */
export function createTurnLearningHook(input: {
  sessionId: string;
  mode: ChatMode;
  messages: ChatMessage[];
}): {
  turnId: string;
  onComplete: (outcome: {
    status: AiStreamStatus;
    hasToolErrors: boolean;
    assistantContent: string;
  }) => void;
} {
  const turnId = `turn-${randomUUID()}`;

  const onComplete = (outcome: {
    status: AiStreamStatus;
    hasToolErrors: boolean;
    assistantContent: string;
  }): void => {
    if (outcome.status !== "completed" || input.mode === "prompt") return;

    try {
      const service = new ConversationLearningService();
      try {
        const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
        const result = service.enqueueCompletedTurn({
          turnId,
          sessionId: input.sessionId,
          mode: input.mode,
          userText: lastUser?.content ?? "",
          assistantText: outcome.assistantContent,
        });
        if (!result.enqueued) {
          logger.chat.info("本轮未入队学习任务", { turnId, reason: result.reason });
        }
      } finally {
        service.close();
      }
    } catch (error) {
      logger.chat.warn("学习任务入队失败（不影响聊天响应，不伪造已保存）", {
        turnId,
        error: (error as Error).message,
      });
    }
  };

  return { turnId, onComplete };
}
