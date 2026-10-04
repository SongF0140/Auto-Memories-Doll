import type { ChatMode } from "../../types/api";
import { getDatabase } from "../../lib/storage/database";
import type { TurnAnalysisResult } from "./memory-extraction-service";

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
  /** 第十块：结构化分析结果（判别联合 JSON），skip/unavailable/损坏时为 null */
  resultJson: unknown;
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
 * 返回判别联合（skip→completed；knowledge→completed+result_json；unavailable→failed）
 * 或字符串摘要（第十块前的兼容语义，视为 completed）；抛错则任务置 failed。
 */
export type LearningTaskProcessor = (task: {
  turnId: string;
  sessionId: string;
  mode: ChatMode;
  userText: string;
  assistantText: string;
}) => Promise<TurnAnalysisResult | string> | TurnAnalysisResult | string;

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
    // 第十块加法迁移：结构化分析结果列（旧库缺列时补齐，已存在则跳过）
    try {
      this.db.exec("ALTER TABLE conversation_learning_tasks ADD COLUMN result_json TEXT");
    } catch {
      // 列已存在
    }
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
      const outcome = await this.processor({
        turnId: row.turn_id,
        sessionId: row.session_id,
        mode: row.mode,
        userText: row.user_text,
        assistantText: row.assistant_text,
      });

      // 字符串摘要：第十块前的兼容语义，直接视为 completed
      if (typeof outcome === "string") {
        this.finishTask(row.turn_id, "completed", outcome, null);
        return { processed: true, turnId: row.turn_id, status: "completed" };
      }

      // 判别联合：skip → completed（无知识，不产生候选）；unavailable → failed；knowledge → completed + result_json
      if (outcome.type === "skip") {
        this.finishTask(row.turn_id, "completed", `无新增知识：${outcome.reason}`, null);
        return { processed: true, turnId: row.turn_id, status: "completed" };
      }
      if (outcome.type === "unavailable") {
        this.finishTask(row.turn_id, "failed", outcome.reason, null);
        return { processed: true, turnId: row.turn_id, status: "failed" };
      }

      const autoCount = outcome.items.filter((item) => item.reviewStatus === "auto").length;
      const manualCount = outcome.items.length - autoCount;
      this.finishTask(
        row.turn_id,
        "completed",
        `产出 ${outcome.items.length} 张知识卡（自动 ${autoCount} / 人工 ${manualCount}）`,
        JSON.stringify(outcome),
      );
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

  /** 任务终态回写：status + result_summary + result_json 同步更新 */
  private finishTask(
    turnId: string,
    status: LearningTaskStatus,
    summary: string,
    resultJson: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE conversation_learning_tasks
         SET status = ?, result_summary = ?, result_json = ?, updated_at = ? WHERE turn_id = ?`,
      )
      .run(status, summary, resultJson, new Date().toISOString(), turnId);
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
    // result_json 由本服务写入，损坏时不谎报结果（诚实返回 null，摘要仍在）
    let resultJson: unknown = null;
    if (row.result_json) {
      try {
        resultJson = JSON.parse(row.result_json);
      } catch {
        resultJson = null;
      }
    }
    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      mode: row.mode as ChatMode,
      userText: row.user_text,
      assistantText: row.assistant_text,
      status: row.status as LearningTaskStatus,
      resultSummary: row.result_summary ?? null,
      resultJson,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
