/**
 * 时间感知检索策略（阶段二，数据驱动）。
 *
 * Locomo 跑分显示 temporal 组 Recall@1 仅 0.67，其余组为 1.0。
 * 失败样例："在决定用 Zustand 之前，用户最后一次调整部署平台是什么时候？"
 * —— 查询里的锚定实体（Zustand）作为干扰项抢走了排名，
 * 而真正的目标（部署平台调整）需要按"锚定时间之前 + 最近优先"来定位。
 *
 * 本模块是纯函数集合，零 LLM 调用、不触碰存储：
 * - extractTemporalAnchor  解析"在 X 之前/之后"锚定子句
 * - stripTemporalClause    剥离锚定子句得到聚焦意图的查询
 * - extractDate            从记忆文本/时间戳中提取日期
 * - rankTemporal           锚定日期过滤 + 相似度并列时新者优先
 */

import { RankedHit } from "./fusion";

/** 时序检索所需的记忆元数据（由调用方从存储层批量取回） */
export type TemporalMeta = {
  memoryId: string;
  /** 记录创建时间（ISO 字符串）；无则回退从 text 提取日期 */
  createdAt?: string;
  /** 摘要 + 正文，用于日期回退提取与锚定命中 */
  text?: string;
};

/** 锚定子句："在 X 之前"（目标在锚定事件之前）/ "在 X 之后" */
export type TemporalAnchor = {
  /** 锚文本（如"决定用 Zustand"），用于反查锚定记忆的时间 */
  text: string;
  /** 目标记忆相对锚定时间的方向 */
  direction: "before" | "after";
};

/** 匹配"在 X 之前 / 在 X 之后"，X 为 1-20 个非标点字符 */
const ANCHOR_PATTERN = /在([^，。？！,?!]{1,20}?)(之前|之后)/;

/** 日期模式：2026-03-25 / 2026/3/25 / 2026年3月25日 */
const DATE_PATTERN = /20\d{2}[-/年](\d{1,2})[-/月](\d{1,2})/;

/** 解析锚定子句；无锚定时返回 null（普通时序问句如"哪一天决定了 X"） */
export function extractTemporalAnchor(query: string): TemporalAnchor | null {
  const match = (query || "").match(ANCHOR_PATTERN);
  if (!match) return null;
  return {
    text: match[1].trim(),
    direction: match[2] === "之前" ? "before" : "after",
  };
}

/** 剥离"在 X 之前/之后"子句并清理残留标点，得到聚焦意图的查询 */
export function stripTemporalClause(query: string): string {
  const stripped = (query || "").replace(ANCHOR_PATTERN, " ");
  return stripped.replace(/^[\s，,、。]+/, "").trim();
}

/** 从文本中提取 ISO 日期（yyyy-mm-dd）；无日期返回 null */
export function extractDate(text: string): string | null {
  if (!text) return null;
  const match = text.match(DATE_PATTERN);
  if (!match) return null;
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${match[0].slice(0, 4)}-${month}-${day}`;
}

/** 取候选的可用日期：优先 createdAt，回退正文日期 */
function resolveDate(meta: TemporalMeta | undefined): string | null {
  if (!meta) return null;
  if (meta.createdAt && meta.createdAt.length >= 10) return meta.createdAt.slice(0, 10);
  return extractDate(meta.text ?? "");
}

/**
 * 时间感知排序：
 * 1. 有锚定时按方向过滤（before: 严格早于锚定日；after: 严格晚于），
 *    无日期元数据的候选不误杀；过滤清空则回退未过滤集合，宁可宽松也不空手而归。
 * 2. 相似度并列（RRF 归一化后常见）时新者优先——"最近一次/最后一次"的默认时间语义。
 */
export function rankTemporal(
  fused: RankedHit[],
  metaMap: Map<string, TemporalMeta>,
  anchor: TemporalAnchor | null,
  anchorDate: string | null,
): RankedHit[] {
  let candidates = fused;

  if (anchor && anchorDate) {
    const filtered = candidates.filter((hit) => {
      const date = resolveDate(metaMap.get(hit.memoryId));
      if (!date) return true;
      return anchor.direction === "before" ? date < anchorDate : date > anchorDate;
    });
    if (filtered.length > 0) candidates = filtered;
  }

  return [...candidates].sort((a, b) => {
    if (Math.abs(b.similarity - a.similarity) > 1e-9) return b.similarity - a.similarity;
    const dateA = resolveDate(metaMap.get(a.memoryId)) ?? "";
    const dateB = resolveDate(metaMap.get(b.memoryId)) ?? "";
    return dateB.localeCompare(dateA);
  });
}
