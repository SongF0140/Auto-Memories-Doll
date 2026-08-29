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

    // 第 3 步：budget 模型按指令改写。
    // 硬校验：改写结果若为"原文 + 末尾追加"结构，程序化拒绝并带反馈重试一次
    //（融合要求不依赖模型自觉，由 isAppendLikeRewrite 结构判定兜底）。
    let rewrite: LlmRewrite;
    try {
      let response = await ModelAdapter.generate(
        buildCorrectionPrompt(target, instruction),
        "budget",
      );
      if (response.finishReason === "degraded") {
        return { success: false, error: "模型调用失败，无法执行纠错改写，请稍后重试" };
      }
      rewrite = parseRewrite(response.content);

      if (rewrite.content && isAppendLikeRewrite(target.content, rewrite.content)) {
        logger.memory.warn("改写结果为末尾追加式，带反馈重试", { memoryId: target.id });
        response = await ModelAdapter.generate(
          buildCorrectionPrompt(
            target,
            instruction,
            APPEND_REJECT_FEEDBACK,
          ),
          "budget",
        );
        if (response.finishReason === "degraded") {
          return { success: false, error: "模型调用失败，无法执行纠错改写，请稍后重试" };
        }
        rewrite = parseRewrite(response.content);

        if (rewrite.content && isAppendLikeRewrite(target.content, rewrite.content)) {
          logger.memory.warn("重试后仍为末尾追加式，拒绝本次改写", { memoryId: target.id });
          return { success: false, error: "改写结果为末尾追加式而非框架融合，已拒绝" };
        }
      }
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

function buildCorrectionPrompt(memory: MemoryRecord, instruction: string, rejectReason?: string): string {
  const lines = [
    "你是记忆库更新器。下面是一条已保存的记忆和用户的更新指令（纠正错误或补充新信息）。",
    "请把指令涉及的变化融合进这条记忆的知识结构，输出修订后的完整记忆。",
    "",
    "融合要求：",
    "- 把新信息纳入这条记忆的知识框架：按主题与逻辑重组内容，让新要点归位到它所属的位置，与相关信息放在一起。",
    "- 新信息与原有内容讲同一件事时，合并成一条更完整的表述，不要重复陈述。",
    "- 修订后的记忆应当读起来像一开始就是这么写的，浑然一体，看不出拼接痕迹。",
    "- 禁止把新信息原样追加在正文末尾形成孤立的补充段。",
    "- 指令未涉及的原有信息一律保留，不得遗漏。",
    "- 与原文使用相同的语言和叙述风格。",
    "- 若内容有实质变化，同步更新 summary 使其概括融合后的内容。",
    '只输出 JSON，格式：{"title": "...", "summary": "...", "content": "..."}',
    "不需要修改的字段保持原值输出。不要添加解释性文字。",
    "",
    `当前记忆：`,
    `标题: ${memory.title}`,
    `摘要: ${memory.summary}`,
    `内容: ${memory.content}`,
    "",
    `更新指令：${instruction}`,
  ];
  if (rejectReason) {
    lines.push("", rejectReason);
  }
  return lines.join("\n");
}

/** 追加式改写被拒后注入重试的反馈 */
const APPEND_REJECT_FEEDBACK =
  "上一版输出被拒绝：你只是把新信息追加在原文末尾，没有融合进知识框架。" +
  "请按主题逻辑把新信息归位重组，与相关信息放在一起，重复表述合并，" +
  "输出一篇读起来像一开始就这么写的完整记忆。";

/**
 * 硬校验：检测改写结果是否为"原文 + 末尾追加"结构。
 * 归一化空白后，若原文是改写结果的严格前缀（且确实发生了改动），
 * 说明新内容被机械地接在原文后面，判定为追加式，拒绝融合失败。
 */
export function isAppendLikeRewrite(original: string, rewritten: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const o = norm(original);
  const n = norm(rewritten);
  if (!o || !n) return false;
  if (o === n) return false; // 完全未改动不算追加
  return n.startsWith(o);
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
