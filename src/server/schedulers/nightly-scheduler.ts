import { NightlyOrchestrator } from "../orchestrators/nightly-orchestrator";
import { logger } from "../../lib/logger";

/**
 * 深夜督查调度器。
 *
 * 每天凌晨 2:00 触发 NightlyOrchestrator 执行完整督查流程。
 * 启动后计算距离下一个凌晨 2:00 的毫秒数，设置首次定时，
 * 之后每 24 小时重复。
 *
 * 通过 env NIGHTLY_ENABLED=true 启用（默认开启，因为这是核心功能）。
 */
export class NightlyScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private orchestrator: NightlyOrchestrator;

  constructor() {
    this.orchestrator = new NightlyOrchestrator();
  }

  start(): void {
    const enabled = process.env.NIGHTLY_ENABLED !== "false";
    if (!enabled) {
      logger.nightly.info("[NightlyScheduler] 深夜督查已禁用（设置 NIGHTLY_ENABLED=true 启用）");
      return;
    }

    // 计算距离下一个凌晨 2:00 的毫秒数
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delayMs = next.getTime() - now.getTime();

    logger.nightly.info("[NightlyScheduler] 深夜督查已启动", {
      nextRun: next.toISOString(),
      delayMinutes: Math.round(delayMs / 60000),
    });

    // 首次延迟到凌晨 2:00，之后每 24 小时一次
    this.timer = setTimeout(() => {
      this.runNightly();
      // 之后每 24 小时
      this.timer = setInterval(() => this.runNightly(), 24 * 60 * 60 * 1000);
    }, delayMs);
  }

  private async runNightly(): Promise<void> {
    logger.nightly.info("[NightlyScheduler] 开始执行深夜督查");
    try {
      const report = await this.orchestrator.run();
      logger.nightly.info("[NightlyScheduler] 深夜督查完成", {
        allSucceeded: report.allSucceeded,
        contradictions: report.contradiction?.contradictions.length ?? 0,
        linksAdded: report.links?.addedCount ?? 0,
        routingChanges: report.routing?.appliedCount ?? 0,
      });
    } catch (e) {
      logger.nightly.error("[NightlyScheduler] 深夜督查异常", { error: (e as Error).message });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.orchestrator.close();
    logger.nightly.info("[NightlyScheduler] 已停止");
  }
}
