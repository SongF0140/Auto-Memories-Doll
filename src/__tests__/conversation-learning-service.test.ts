import { beforeEach, describe, expect, it, vi } from "vitest";

// env 固化：MEMORY_ROOT 透传 process.env——setup.ts 已先于测试模块设置临时目录
vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    MODEL_API_KEY: "",
    MODEL_BASE_URL: "http://localhost:8080",
    MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
    PORT: 3000,
    RERANK_MODEL: "Xenova/bge-reranker-base",
    RERANK_HF_ENDPOINT: "https://hf-mirror.com",
    RERANK_DISABLED: false,
  },
}));

import { getDatabase } from "../lib/storage/database";
import { ConversationLearningService } from "../server/services/conversation-learning-service";

const taskInput = {
  turnId: "turn-1",
  sessionId: "sess-1",
  mode: "chat" as const,
  userText: "今天学到了 Vue 的 watchEffect 用法",
  assistantText: "watchEffect 会立即执行一次，并在依赖变化时重新运行。",
};

describe("ConversationLearningService — 增量学习任务", () => {
  beforeEach(() => {
    // 触发建表后清空，保证每用例从空表开始
    const service = new ConversationLearningService();
    service.close();
    getDatabase().prepare("DELETE FROM conversation_learning_tasks").run();
  });

  it("prompt 模式不入队（提示词模式不写记忆）", () => {
    const service = new ConversationLearningService();
    try {
      const result = service.enqueueCompletedTurn({ ...taskInput, mode: "prompt" });
      expect(result).toEqual({ enqueued: false, reason: "prompt-mode" });
      expect(service.getTask("turn-1")).toBeNull();
    } finally {
      service.close();
    }
  });

  it("普通模式成功轮次入队为 queued", () => {
    const service = new ConversationLearningService();
    try {
      const result = service.enqueueCompletedTurn(taskInput);
      expect(result.enqueued).toBe(true);
      const task = service.getTask("turn-1");
      expect(task).toMatchObject({
        turnId: "turn-1",
        sessionId: "sess-1",
        mode: "chat",
        status: "queued",
      });
      expect(task!.userText).toContain("watchEffect 用法");
      expect(task!.assistantText).toContain("立即执行一次");
    } finally {
      service.close();
    }
  });

  it("同一 turnId 重复入队被唯一约束拒绝（不产生第二条任务）", () => {
    const service = new ConversationLearningService();
    try {
      expect(service.enqueueCompletedTurn(taskInput).enqueued).toBe(true);
      const second = service.enqueueCompletedTurn({ ...taskInput, userText: "改过的文本" });
      expect(second).toEqual({ enqueued: false, reason: "duplicate" });
      const bySession = service.listTasksBySession("sess-1");
      expect(bySession).toHaveLength(1);
      // 首条任务内容不被后入队覆盖
      expect(bySession[0].userText).toContain("watchEffect");
    } finally {
      service.close();
    }
  });

  it("入队失败时向外抛错，不返回伪造的成功", () => {
    const service = new ConversationLearningService();
    try {
      // 非法绑定值触发底层抛错：enqueue 不得吞错返回 enqueued:true
      expect(() =>
        service.enqueueCompletedTurn({
          ...taskInput,
          turnId: undefined as unknown as string,
        }),
      ).toThrow();
    } finally {
      service.close();
    }
  });

  it("无处理器时任务保持 queued，不谎报处理完成", async () => {
    new ConversationLearningService().close();
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      const result = await service.processNextLearningTask();
      expect(result).toEqual({ processed: false, reason: "no-processor" });
      expect(service.getTask("turn-1")!.status).toBe("queued");
    } finally {
      service.close();
    }
  });

  it("队列为空时返回 no-task", async () => {
    const service = new ConversationLearningService();
    try {
      service.setProcessor(() => "不应该被调用");
      const result = await service.processNextLearningTask();
      expect(result).toEqual({ processed: false, reason: "no-task" });
    } finally {
      service.close();
    }
  });

  it("处理器成功 → completed + 结果摘要", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      const seen: string[] = [];
      service.setProcessor((task) => {
        seen.push(task.turnId);
        return "无新增知识";
      });
      const result = await service.processNextLearningTask();
      expect(seen).toEqual(["turn-1"]);
      expect(result).toEqual({ processed: true, turnId: "turn-1", status: "completed" });
      const task = service.getTask("turn-1")!;
      expect(task.status).toBe("completed");
      expect(task.resultSummary).toBe("无新增知识");
    } finally {
      service.close();
    }
  });

  it("处理器抛错 → failed + 错误摘要，且失败任务不再被取出（不自动重试）", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      let calls = 0;
      service.setProcessor(() => {
        calls += 1;
        throw new Error("分析器不可用");
      });
      const first = await service.processNextLearningTask();
      expect(first).toEqual({ processed: true, turnId: "turn-1", status: "failed" });
      const task = service.getTask("turn-1")!;
      expect(task.status).toBe("failed");
      expect(task.resultSummary).toContain("分析器不可用");

      const second = await service.processNextLearningTask();
      expect(second).toEqual({ processed: false, reason: "no-task" });
      expect(calls).toBe(1);
    } finally {
      service.close();
    }
  });

  it("processNextLearningTask 取出任务时置 processing", async () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      service.setProcessor(() => {
        // 处理中读取：应已处于 processing（崩溃可被启动恢复）
        expect(service.getTask("turn-1")!.status).toBe("processing");
        return "ok";
      });
      await service.processNextLearningTask();
    } finally {
      service.close();
    }
  });

  it("恢复中断任务：processing → queued，completed/failed 不受影响", () => {
    const service = new ConversationLearningService();
    try {
      const db = getDatabase();
      const insert = db.prepare(
        `INSERT INTO conversation_learning_tasks
         (turn_id, session_id, mode, user_text, assistant_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      insert.run("t-a", "s", "chat", "u", "a", "processing", now, now);
      insert.run("t-b", "s", "chat", "u", "a", "completed", now, now);
      insert.run("t-c", "s", "chat", "u", "a", "failed", now, now);

      const recovered = service.recoverInterruptedTasks();
      expect(recovered).toBe(1);
      expect(service.getTask("t-a")!.status).toBe("queued");
      expect(service.getTask("t-b")!.status).toBe("completed");
      expect(service.getTask("t-c")!.status).toBe("failed");
    } finally {
      service.close();
    }
  });

  it("listTasksBySession 返回该会话全部任务（含终态），供状态摘要", () => {
    const service = new ConversationLearningService();
    try {
      service.enqueueCompletedTurn(taskInput);
      service.enqueueCompletedTurn({ ...taskInput, turnId: "turn-2", sessionId: "sess-1" });
      service.enqueueCompletedTurn({ ...taskInput, turnId: "turn-3", sessionId: "sess-2" });
      expect(service.listTasksBySession("sess-1")).toHaveLength(2);
      expect(service.listTasksBySession("sess-2")).toHaveLength(1);
      expect(service.listTasksBySession("nope")).toHaveLength(0);
    } finally {
      service.close();
    }
  });
});
