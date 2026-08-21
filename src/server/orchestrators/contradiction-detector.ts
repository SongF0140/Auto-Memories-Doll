import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { logger } from "../../lib/logger";

export interface ContradictionItem {
  memoryA: { id: string; title: string; summary: string };
  memoryB: { id: string; title: string; summary: string };
  /** 旗舰模型分析得出的矛盾描述 */
  description: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface ContradictionReport {
  contradictions: ContradictionItem[];
  totalCompared: number;
}

/**
 * 知识矛盾检测器（旗舰模型驱动）。
 *
 * 扫描今日新增记忆与已有记忆，检测语义矛盾：
 * - "昨天说 React 18 用 useEffect，今天说用 useMemo 替代 useEffect"
 * - "之前记录用 PostgreSQL，现在说改用 MySQL"
 *
 * 分两阶段：
 * 1. 本地粗筛：标题相似且 topic 相同的记忆对
 * 2. 旗舰模型精判：确认是否存在实质矛盾
 */
export class ContradictionDetector {
  private readonly BATCH_SIZE = 10;

  async detect(todaysMemories: MemoryRecord[], allMemories: MemoryRecord[]): Promise<ContradictionReport> {
    if (todaysMemories.length === 0) {
      return { contradictions: [], totalCompared: 0 };
    }

    if (ModelAdapter.isDegradedMode) {
      logger.nightly.info("模型降级中，跳过矛盾精判");
      return { contradictions: [], totalCompared: 0 };
    }

    // 已有记忆（排除今天的）
    const oldMemories = allMemories.filter((m) => !todaysMemories.some((t) => t.id === m.id));

    // 阶段 1：本地粗筛 — topic 相同的记忆对
    const pairs: { newMem: MemoryRecord; oldMem: MemoryRecord }[] = [];
    for (const newMem of todaysMemories) {
      const sameTopic = oldMemories.filter((m) => m.topic === newMem.topic && m.id !== newMem.id);
      for (const oldMem of sameTopic.slice(0, 5)) {
        pairs.push({ newMem, oldMem });
      }
    }

    if (pairs.length === 0) {
      return { contradictions: [], totalCompared: 0 };
    }

    // 阶段 2：旗舰模型精判（分批）
    const contradictions: ContradictionItem[] = [];
    const batchCount = Math.ceil(pairs.length / this.BATCH_SIZE);

    for (let b = 0; b < batchCount; b++) {
      const batch = pairs.slice(b * this.BATCH_SIZE, (b + 1) * this.BATCH_SIZE);
      try {
        const results = await this.analyzeBatch(batch);
        contradictions.push(...results);
      } catch (e) {
        logger.nightly.error("矛盾检测批次失败", { batch: b, error: (e as Error).message });
      }
    }

    return { contradictions, totalCompared: pairs.length };
  }

  private async analyzeBatch(
    pairs: { newMem: MemoryRecord; oldMem: MemoryRecord }[],
  ): Promise<ContradictionItem[]> {
    const pairsText = pairs
      .map(
        (p, i) =>
          `[对 ${i + 1}]
  新记忆: "${p.newMem.title}" | ${p.newMem.topic}
  摘要: ${p.newMem.summary}
  旧记忆: "${p.oldMem.title}" | ${p.oldMem.topic}
  摘要: ${p.oldMem.summary}`,
      )
      .join("\n\n");

    const prompt = `分析以下新旧记忆对是否存在知识矛盾（同一主题下新信息与旧信息冲突）。

${pairsText}

返回 JSON 数组，每项格式：
{
  "pairIndex": 数字(1开始),
  "hasContradiction": true/false,
  "description": "矛盾描述（无矛盾时为空）",
  "severity": "high"|"medium"|"low",
  "suggestion": "解决建议（无矛盾时为空）"
}

只返回 JSON 数组，不要其他文字。`;

    const response = await ModelAdapter.generate(prompt, "flagship");
    const jsonStr = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let analyzed: any[];
    try {
      analyzed = JSON.parse(jsonStr);
      if (!Array.isArray(analyzed)) return [];
    } catch {
      return [];
    }

    return analyzed
      .filter((item: any) => item.hasContradiction)
      .map((item: any) => {
        const pair = pairs[item.pairIndex - 1];
        return {
          memoryA: { id: pair.newMem.id, title: pair.newMem.title, summary: pair.newMem.summary },
          memoryB: { id: pair.oldMem.id, title: pair.oldMem.title, summary: pair.oldMem.summary },
          description: item.description || "",
          severity: item.severity || "medium",
          suggestion: item.suggestion || "",
        };
      });
  }

  close(): void {}
}
