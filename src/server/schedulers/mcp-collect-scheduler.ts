import { McpIngestBridge } from "../../lib/mcp/ingest-bridge";
import { logger } from "../../lib/logger";

const COLLECT_INTERVAL_MS = 600000; // 10 分钟

/**
 * 定时从 MCP 服务器和 Skills 采集数据，送入 ingest 管线。
 */
export class McpCollectScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), COLLECT_INTERVAL_MS);
    logger.ingest.info("MCP 采集调度器已启动");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const bridge = new McpIngestBridge();
    try {
      const result = await bridge.collectAll();
      if (result.mcp > 0 || result.skills > 0) {
        logger.ingest.info("定时采集完成", result);
      }
    } catch (error) {
      logger.ingest.error("MCP 采集调度异常", { error: (error as Error).message });
    } finally {
      bridge.close();
      this.running = false;
    }
  }
}
