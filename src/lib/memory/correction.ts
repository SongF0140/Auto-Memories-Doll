import { ModelAdapter } from "../ai/model-adapter";
import type { MemoryService } from "../../server/services/memory-service";
import type { VectorRetriever } from "../vector/retriever";
import type { MemoryRecord } from "../../types/memory";
import { logger } from "../logger";

/** 纠错后追加的标记标签，便于审计时区分人工纠错来源 */
export const CORRECTED_TAG = "corrected";

export type CorrectionRequest = {
  /** 目标记忆 id；不提供时用 locateQuery 检索定位 top-1 */
  memoryId?: string;
  /** 对目标记忆的描述（标题/关键词），用于检索定位 */
  locateQuery?: string;
  /** 用户的纠错指令，例如"项目名写错了，应该是 Auto-Memories-Doll" */
  instruction: string;
};

export type CorrectionResult =
  | {
      success: true;
      memoryId: string;
      title: string;
      eventId: string;
      changedFields: string[];
    }
  | { success: false; error: string };

type LlmRewrite = {
  title?: string;
  summary?: string;
  content?: string;
};

/**
 * 记忆纠错闭环（最小可用版）
 *
 * 流程：定位目标记忆（id 或检索定位）→ budget 模型按纠错指令改写
 * title/summary/content → 经 stageUpdateMemory 走审计队列落库。
 *
 * 设计约束：
 * - 纠错是"改写"而不是"直接覆盖"：所有变更生成 PendingEvent，
 *   与手动更新共用审计/版本快照通道，可追溯可回滚；
 * - 模型降级（无 Key / API 失败）时拒绝纠错并明确报错，
 *   避免用兜底文案污染记忆内容；
 * - 定位失败、无有效改动等情况都返回结构化失败，不抛异常。
 */
export class MemoryCorrectionService {
  constructor(
    private readonly memoryService: Pick<MemoryService, "getMemory" | "stageUpdateMemory">,
    private readonly retriever: Pick<VectorRetriever, "search">,
  ) {}

  async correct(request: CorrectionRequest): Promise<CorrectionResult> {
    const instruction = (request.instruction || "").trim();
    if (!instruction) {
      return { success: false, error: "缺少纠错指令" };
    }

    // 第 1 步：定位目标记忆
    const target = await this.locateTarget(request);
    if (!target) {
      return { success: false, error: "未找到要纠错的记忆，请提供记忆 ID 或更具体的描述" };
    }

    // 第 2 步：模型降级时拒绝改写（兜底文案会污染记忆）
    if (ModelAdapter.isDegradedMode) {
      return { success: false, error: "模型当前不可用，无法执行纠错改写，请稍后重试" };
    }

    // 第 3 步：budget 模型按指令改写
    let rewrite: LlmRewrite;
    try {
      const response = await ModelAdapter.generate(
        buildCorrectionPrompt(target, instruction),
        "budget",
      );
      if (response.finishReason === "degraded") {
        return { success: false, error: "模型调用失败，无法执行纠错改写，请稍后重试" };
      }
      rewrite = parseRewrite(response.content);
    } catch (err) {
      logger.memory.warn("纠错改写失败", {
        memoryId: target.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false, error: "纠错改写失败，请稍后重试" };
    }

    // 第 4 步：只保留真实发生变化的字段
    const updates: Partial<MemoryRecord> = {};
    const changedFields: string[] = [];
    if (rewrite.title && rewrite.title.trim() !== target.title) {
      updates.title = rewrite.title.trim();
      changedFields.push("title");
    }
    if (rewrite.summary && rewrite.summary.trim() !== target.summary) {
      updates.summary = rewrite.summary.trim();
      changedFields.push("summary");
    }
    if (rewrite.content && rewrite.content.trim() !== target.content) {
      updates.content = rewrite.content.trim();
      changedFields.push("content");
    }

    if (changedFields.length === 0) {
      return { success: false, error: "未产生有效改动，记忆保持不变" };
    }

    // 打上 corrected 标签，审计时可区分纠错来源
    if (!target.tags.includes(CORRECTED_TAG)) {
      updates.tags = [...target.tags, CORRECTED_TAG];
      changedFields.push("tags");
    }

    // 第 5 步：走审计队列落库
    try {
      const eventId = this.memoryService.stageUpdateMemory(target.id, updates);
      logger.memory.info("记忆纠错已入队", { memoryId: target.id, changedFields });
      return {
        success: true,
        memoryId: target.id,
        title: updates.title ?? target.title,
        eventId,
        changedFields,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async locateTarget(request: CorrectionRequest): Promise<MemoryRecord | null> {
    if (request.memoryId) {
      return this.memoryService.getMemory(request.memoryId);
    }

    const locateQuery = (request.locateQuery || "").trim();
    if (!locateQuery) return null;

    const results = await this.retriever.search(locateQuery, 1);
    if (results.length === 0) return null;
    return this.memoryService.getMemory(results[0].memoryId);
  }
}

function buildCorrectionPrompt(memory: MemoryRecord, instruction: string): string {
  return [
    "你是记忆库纠错器。下面是一条已保存的记忆和用户提出的纠错指令。",
    "请根据纠错指令修订记忆内容，只修正指令涉及的部分，保留其余信息。",
    "只输出 JSON，格式：{\"title\": \"...\", \"summary\": \"...\", \"content\": \"...\"}",
    "不需要修改的字段保持原值输出。不要添加解释性文字。",
    "",
    `当前记忆：`,
    `标题: ${memory.title}`,
    `摘要: ${memory.summary}`,
    `内容: ${memory.content}`,
    "",
    `纠错指令：${instruction}`,
  ].join("\n");
}

/** 从模型输出中提取改写结果；结构非法时返回空对象 */
export function parseRewrite(raw: string): LlmRewrite {
  if (typeof raw !== "string" || raw.length === 0) return {};

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null) return {};

  const result: LlmRewrite = {};
  const obj = parsed as Record<string, unknown>;
  for (const key of ["title", "summary", "content"] as const) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      result[key] = value;
    }
  }
  return result;
}
