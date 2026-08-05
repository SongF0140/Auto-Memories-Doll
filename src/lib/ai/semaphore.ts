/**
 * 异步信号量 — 控制并发数量的经典同步原语。
 *
 * 用于限制对 API（带速率限制的资源）的并发访问。
 * 与操作系统信号量不同，此实现使用 JS Promise 队列而不是阻塞线程。
 */
export class Semaphore {
  private available: number;
  private readonly max: number;
  private waitQueue: Array<{
    resolve: (v: boolean) => void;
    reject: (e: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
    this.max = max;
    this.available = max;
  }

  /** 获取一个可用槽位。如果已满，等待至槽位释放或超时。 */
  acquire(timeoutMs?: number): Promise<boolean> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve, reject) => {
      const entry: (typeof this.waitQueue)[number] = { resolve, reject };

      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          // 从队列中移除
          const idx = this.waitQueue.indexOf(entry);
          if (idx >= 0) {
            this.waitQueue.splice(idx, 1);
            resolve(false);
          }
        }, timeoutMs);
      }

      this.waitQueue.push(entry);
    });
  }

  /** 释放一个槽位，唤醒下一个等待者。 */
  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      if (next.timer) clearTimeout(next.timer);
      next.resolve(true);
    } else {
      this.available = Math.min(this.available + 1, this.max);
    }
  }

  /** 当前可用槽位数 */
  get availableSlots(): number {
    return this.available;
  }

  /** 等待队列长度 */
  get waitingCount(): number {
    return this.waitQueue.length;
  }

  /** 正在使用的槽位数 */
  get activeCount(): number {
    return this.max - this.available - this.waitQueue.length;
  }

  /** 重置为全容量（谨慎使用，仅用于测试或紧急情况） */
  reset(): void {
    // 拒绝所有等待者
    for (const entry of this.waitQueue) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error("Semaphore reset"));
    }
    this.waitQueue = [];
    this.available = this.max;
  }
}
