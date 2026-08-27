import { Semaphore } from "./semaphore";
import type { ModelSlot } from "../../types/config";
import { logger } from "../logger";

/** 池统计信息（供调试和监控） */
export type PoolStats = {
  [slot in ModelSlot]: {
    maxConcurrency: number;
    activeCount: number;
    waitingCount: number;
    availableSlots: number;
  };
};

/**
 * 模型调用池 — 按层级限制并发 API 调用。
 *
 * 每个 tier 有独立的信号量：
 * - flagship: 低并发（昂贵、用量谨慎）
 * - standard: 中并发（常规任务）
 * - budget:  高并发（廉价、快速）
 * - embedding: 高并发（向量生成，批量场景多）
 *
 * 超时时抛出 ConcurrencyTimeoutError。
 */
export class ModelPool {
  private pools: Record<ModelSlot, Semaphore>;
  private configs: Record<ModelSlot, { maxConcurrency: number; queueTimeoutMs: number }>;

  constructor(configs: {
    flagship: { maxConcurrency: number; queueTimeoutMs: number };
    standard: { maxConcurrency: number; queueTimeoutMs: number };
    budget: { maxConcurrency: number; queueTimeoutMs: number };
    embedding: { maxConcurrency: number; queueTimeoutMs: number };
  }) {
    this.configs = configs;
    this.pools = {
      flagship: new Semaphore(configs.flagship.maxConcurrency),
      standard: new Semaphore(configs.standard.maxConcurrency),
      budget: new Semaphore(configs.budget.maxConcurrency),
      embedding: new Semaphore(configs.embedding.maxConcurrency),
    };
  }

  /**
   * 在指定层级执行一个异步任务。
   * 如果并发已满，等待至槽位释放或超时。
   *
   * @param slot    模型层级
   * @param fn      要执行的异步函数
   * @param timeout 可选，覆盖默认排队超时时间
   */
  async execute<T>(slot: ModelSlot, fn: () => Promise<T>, timeout?: number): Promise<T> {
    const pool = this.pools[slot];
    const cfg = this.configs[slot];
    const effectiveTimeout = timeout ?? cfg.queueTimeoutMs;

    const acquired = await pool.acquire(effectiveTimeout);
    if (!acquired) {
      logger.api.warn(
        `[ModelPool] ${slot} 排队超时 (${effectiveTimeout}ms)，active=${pool.activeCount} waiting=${pool.waitingCount}`,
      );
      throw new ConcurrencyTimeoutError(slot, effectiveTimeout);
    }

    try {
      return await fn();
    } finally {
      pool.release();
    }
  }

  /** 获取所有池的统计信息 */
  getStats(): PoolStats {
    return {
      flagship: this.getSlotStats("flagship"),
      standard: this.getSlotStats("standard"),
      budget: this.getSlotStats("budget"),
      embedding: this.getSlotStats("embedding"),
    };
  }

  private getSlotStats(slot: ModelSlot): PoolStats[ModelSlot] {
    const pool = this.pools[slot];
    const cfg = this.configs[slot];
    return {
      maxConcurrency: cfg.maxConcurrency,
      activeCount: pool.activeCount,
      waitingCount: pool.waitingCount,
      availableSlots: pool.availableSlots,
    };
  }
}

export class ConcurrencyTimeoutError extends Error {
  constructor(
    public readonly slot: ModelSlot,
    public readonly timeoutMs: number,
  ) {
    super(`模型层级 "${slot}" 并发已满，排队 ${timeoutMs}ms 后超时`);
    this.name = "ConcurrencyTimeoutError";
  }
}
