import type { ChatMode } from "../../types/api";
import { getDatabase } from "../../lib/storage/database";

/** 学习任务状态机：queued → processing → completed/failed；failed 不自动重试 */
export type LearningTaskStatus = "queued" | "processing" | "completed" | "failed";

export type LearningTask = {
  turnId: string;
  sessionId: string;
  mode: ChatMode;
  userText: string;
  assistantText: string;
  status: LearningTaskStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueResult =
  { enqueued: true } | { enqueued: false; reason: "prompt-mode" | "duplicate" };

export type ProcessResult =
  | { processed: true; turnId: string; status: "completed" | "failed" }
  | { processed: false; reason: "no-task" | "no-processor" };

/**
 * 任务处理器：消费一轮完整对话（仅本轮 user/assistant）。
 * 返回结果摘要（如"无新增知识"）；抛错则任务置 failed。
 * 第十块接入真实价值判断（skip/knowledge/unavailable）前，路由层不注入处理器。
 */
export type LearningTaskProcessor = (task: {
  turnId: string;
  sessionId: string;
  mode: ChatMode;
  userText: string;
  assistantText: string;
}) => Promise<string> | string;

/**
 * ConversationLearningService — 对话增量学习任务
 *
 * 持久任务入队/取出与处理；会话正文仍由 ChatSessionService（JSONL）存储，
 * 本服务不复制会话内容，任务表只保留处理所需的本轮文本与状态。
 * turnId 是唯一键：一次成功终态只入队一次，同 turn 重复入队被幂等拒绝。
 */
export class ConversationLearningService {
  private processor: LearningTaskProcessor | null = null;
  private db: ReturnType<typeof getDatabase>;

  constructor() {
    this.db = getDatabase();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_learning_tasks (
        turn_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        user_text TEXT NOT NULL,
        assistant_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
        result_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  /** 注入任务处理器（第十块接入真实分析）；传 null 恢复无处理器状态 */
  setProcessor(fn: LearningTaskProcessor | null): void {
    this.processor = fn;
  }

  /**
   * 成功完成的对话轮次入队。
   * 提示词模式直接跳过；turnId 唯一约束保证幂等（重复入队返回 duplicate）。
   * 入队失败（非法绑定、库不可用等）向外抛错，由调用方决定如何记录——不返回伪造成功。
   */
  enqueueCompletedTurn(input: {
    turnId: string;
    sessionId: string;
    mode: ChatMode;
    userText: string;
    assistantText: string;
  }): EnqueueResult {
    if (input.mode === "prompt") return { enqueued: false, reason: "prompt-mode" };

    const now = new Date().toISOString();
    // 不用 INSERT OR IGNORE：它会把 NOT NULL 等约束违规也静默吞掉，违背"失败不谎报"
    try {
      this.db
        .prepare(
          `INSERT INTO conversation_learning_tasks
           (turn_id, session_id, mode, user_text, assistant_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
        )
        .run(
          input.turnId,
          input.sessionId,
          input.mode,
          input.userText,
          input.assistantText,
          now,
          now,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed: conversation_learning_tasks.turn_id")
      ) {
        return { enqueued: false, reason: "duplicate" };
      }
      throw error;
    }
    return { enqueued: true };
  }

  /**
   * 取出并处理一个排队任务：queued → processing → completed/failed。
   * 无处理器或无任务时不改变任何状态（不谎报处理完成）。
   * 处理器抛错 → failed + 错误摘要；失败任务不再被取出（本轮不自动重试）。
   */
  async processNextLearningTask(): Promise<ProcessResult> {
    if (!this.processor) return { processed: false, reason: "no-processor" };

    const row = this.db
      .prepare(
        `SELECT turn_id, session_id, mode, user_text, assistant_text
         FROM conversation_learning_tasks WHERE status = 'queued'
         ORDER BY created_at ASC, turn_id ASC LIMIT 1`,
      )
      .get() as
      | {
          turn_id: string;
          session_id: string;
          mode: ChatMode;
          user_text: string;
          assistant_text: string;
        }
      | undefined;
    if (!row) return { processed: false, reason: "no-task" };

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE conversation_learning_tasks SET status = 'processing', updated_at = ? WHERE turn_id = ?`,
      )
      .run(now, row.turn_id);

    try {
      const summary = await this.processor({
        turnId: row.turn_id,
        sessionId: row.session_id,
        mode: row.mode,
        userText: row.user_text,
        assistantText: row.assistant_text,
      });
      this.db
        .prepare(
          `UPDATE conversation_learning_tasks SET status = 'completed', result_summary = ?, updated_at = ? WHERE turn_id = ?`,
        )
        .run(summary, new Date().toISOString(), row.turn_id);
      return { processed: true, turnId: row.turn_id, status: "completed" };
    } catch (error) {
      this.db
        .prepare(
          `UPDATE conversation_learning_tasks SET status = 'failed', result_summary = ?, updated_at = ? WHERE turn_id = ?`,
        )
        .run(`分析失败: ${(error as Error).message}`, new Date().toISOString(), row.turn_id);
      return { processed: true, turnId: row.turn_id, status: "failed" };
    }
  }

  /** 启动恢复：仅把被中断的 processing 任务放回 queued（completed/failed 不动） */
  recoverInterruptedTasks(): number {
    const result = this.db
      .prepare(
        `UPDATE conversation_learning_tasks SET status = 'queued', updated_at = ? WHERE status = 'processing'`,
      )
      .run(new Date().toISOString());
    return result.changes;
  }

  getTask(turnId: string): LearningTask | null {
    const row = this.db
      .prepare(`SELECT * FROM conversation_learning_tasks WHERE turn_id = ?`)
      .get(turnId) as Record<string, string> | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** 会话查询状态摘要用：返回该会话全部任务（含终态） */
  listTasksBySession(sessionId: string): LearningTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_learning_tasks WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId) as Array<Record<string, string>>;
    return rows.map((row) => this.mapRow(row));
  }

  close(): void {
    // getDatabase() 返回共享连接，与其他 service 一致不在此关闭
  }

  private mapRow(row: Record<string, string>): LearningTask {
    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      mode: row.mode as ChatMode,
      userText: row.user_text,
      assistantText: row.assistant_text,
      status: row.status as LearningTaskStatus,
      resultSummary: row.result_summary ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
