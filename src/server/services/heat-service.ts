import { MemoryRecord } from "../../types/memory";
import { calculateHeatScore } from "../../config/scoring.config";
import { readProfileTags } from "../../lib/storage/index-writer";

/** 热度计算的全局归一化上下文（由整批记忆推导，避免单条计算得到失真分值） */
export type HeatContext = {
  maxAccessCount: number;
  maxExposureCount: number;
};

/**
 * 热度重算服务（F-2）。
 *
 * 背景：`builder.ts` 建卡时 heatScore 恒为 0，且 `MemoryScorer` 全仓无调用点，
 * 导致 ranker 中权重 0.25 的 heat 因子长期贡献 0，retention 的冷热判据对全库恒真。
 * 本服务补上"每小时重算一次热度"的挂点。
 *
 * 曝光量（exposure）用 I-9 引入的检索弱信号 `retrievalCount` 作为代理：
 * 一条记忆被自动召回得越多，说明它越常进入上下文，属于曝光而非用户认可。
 */
export class HeatService {
  constructor(private readonly profileTags: string[] = []) {}

  /** 从 profile.md 读取画像标签后构造（供 worker 调用） */
  static async create(): Promise<HeatService> {
    try {
      return new HeatService(await readProfileTags());
    } catch {
      return new HeatService([]);
    }
  }

  buildContext(memories: MemoryRecord[]): HeatContext {
    const maxAccessCount = memories.reduce((max, m) => Math.max(max, m.accessCount), 0);
    const maxExposureCount = memories.reduce((max, m) => Math.max(max, m.retrievalCount ?? 0), 0);
    return {
      maxAccessCount: Math.max(maxAccessCount, 1),
      maxExposureCount: Math.max(maxExposureCount, 1),
    };
  }

  compute(memory: MemoryRecord, ctx: HeatContext): number {
    return clamp01(
      calculateHeatScore(
        memory.accessCount,
        memory.updatedAt,
        memory.retrievalCount ?? 0,
        memory.tags,
        this.profileTags,
        ctx.maxAccessCount,
        ctx.maxExposureCount,
      ),
    );
  }

  /** 批量重算，返回 memoryId → heatScore */
  recalculate(memories: MemoryRecord[]): Map<string, number> {
    const ctx = this.buildContext(memories);
    const result = new Map<string, number>();
    for (const memory of memories) {
      result.set(memory.id, this.compute(memory, ctx));
    }
    return result;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
