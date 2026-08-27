import {
  collectBrowserHistory,
  collectBrowserBookmarks,
} from "../../lib/browser/history-collector";
import { MemoryService } from "../services/memory-service";
import { logger } from "../../lib/logger";

/**
 * 浏览器历史与书签采集调度器。
 *
 * 每 30 分钟采集一次最近 2 小时的浏览器历史，
 * 每 6 小时采集一次书签（书签变化频率低）。
 *
 * 采集结果送入 MemoryService.stageCreateMemory 入队，
 * 经过质量过滤 → 分类 → 索引 → 审计 → 回写完整链路。
 *
 * 通过 env BROWSER_COLLECT_ENABLED=true 启用（默认关闭，涉及隐私）。
 */
export class BrowserCollectScheduler {
  private historyTimer: ReturnType<typeof setInterval> | null = null;
  private bookmarkTimer: ReturnType<typeof setInterval> | null = null;

  private readonly HISTORY_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
  private readonly BOOKMARK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
  private readonly HISTORY_HOURS = 2; // 每次采集最近 2 小时

  start(): void {
    if (process.env.BROWSER_COLLECT_ENABLED !== "true") {
      logger.ingest.info(
        "[BrowserScheduler] 浏览器采集未启用（设置 BROWSER_COLLECT_ENABLED=true 启用）",
      );
      return;
    }

    // 启动后延迟 60 秒首次执行，避免与启动初始化竞争
    setTimeout(() => this.collectHistory(), 60_000);
    setTimeout(() => this.collectBookmarks(), 90_000);

    this.historyTimer = setInterval(() => this.collectHistory(), this.HISTORY_INTERVAL_MS);
    this.bookmarkTimer = setInterval(() => this.collectBookmarks(), this.BOOKMARK_INTERVAL_MS);

    logger.ingest.info("[BrowserScheduler] 已启动，历史采集间隔 30min，书签采集间隔 6h");
  }

  stop(): void {
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
    if (this.bookmarkTimer) {
      clearInterval(this.bookmarkTimer);
      this.bookmarkTimer = null;
    }
  }

  private async collectHistory(): Promise<void> {
    try {
      const results = await collectBrowserHistory(this.HISTORY_HOURS);
      if (results.length === 0) return;

      const memoryService = new MemoryService();
      try {
        for (const result of results) {
          memoryService.stageCreateMemory(
            `browser-history:${result.browser}`,
            "ingest",
            `${result.browser} 浏览记录 ${new Date().toLocaleDateString("zh-CN")}`,
            result.content,
            `最近${this.HISTORY_HOURS}小时访问 ${result.visitCount} 个页面，${result.domainCount} 个域名`,
            ["browser-history", result.browser.toLowerCase()],
            "browser-history",
          );
        }
        logger.ingest.info("[BrowserScheduler] 历史采集完成", {
          browsers: results.map((r) => `${r.browser}:${r.visitCount}`).join(", "),
        });
      } finally {
        memoryService.close();
      }
    } catch (error) {
      logger.ingest.error("[BrowserScheduler] 历史采集失败:", {
        error: (error as Error).message,
      });
    }
  }

  private async collectBookmarks(): Promise<void> {
    try {
      const results = await collectBrowserBookmarks();
      if (results.length === 0) return;

      const memoryService = new MemoryService();
      try {
        for (const result of results) {
          memoryService.stageCreateMemory(
            `browser-bookmarks:${result.browser}`,
            "ingest",
            `${result.browser} 书签收藏`,
            result.content,
            `共 ${result.bookmarkCount} 个书签`,
            ["browser-bookmarks", result.browser.toLowerCase()],
            "browser-bookmarks",
          );
        }
        logger.ingest.info("[BrowserScheduler] 书签采集完成", {
          browsers: results.map((r) => `${r.browser}:${r.bookmarkCount}`).join(", "),
        });
      } finally {
        memoryService.close();
      }
    } catch (error) {
      logger.ingest.error("[BrowserScheduler] 书签采集失败:", {
        error: (error as Error).message,
      });
    }
  }
}
