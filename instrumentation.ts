let auditScheduler: { start: () => void; stop: () => void } | null = null;
let cleanupScheduler: { start: () => void; stop: () => void } | null = null;
let vectorScheduler: { start: () => void; stop: () => void } | null = null;
let retentionScheduler: { start: () => void; stop: () => void } | null = null;
let mcpCollectScheduler: { start: () => void; stop: () => void } | null = null;
let browserCollectScheduler: { start: () => void; stop: () => void } | null = null;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAllListeners } = await import("./src/server/listener/listener-service");
    const port = parseInt(process.env.PORT || "3000", 10);
    startAllListeners(port);

    // ── 后台调度器 ──
    const { AuditScheduler } = await import("./src/server/schedulers/audit-scheduler");
    const { CleanupScheduler } = await import("./src/server/schedulers/cleanup-scheduler");
    const { VectorScheduler } = await import("./src/server/schedulers/vector-scheduler");
    const { RetentionScheduler } = await import("./src/server/schedulers/retention-scheduler");
    const { McpCollectScheduler } = await import("./src/server/schedulers/mcp-collect-scheduler");
    const { BrowserCollectScheduler } = await import("./src/server/schedulers/browser-collect-scheduler");

    auditScheduler = new AuditScheduler();
    cleanupScheduler = new CleanupScheduler();
    vectorScheduler = new VectorScheduler();
    retentionScheduler = new RetentionScheduler();
    mcpCollectScheduler = new McpCollectScheduler();
    browserCollectScheduler = new BrowserCollectScheduler();

    auditScheduler.start();
    cleanupScheduler.start();
    vectorScheduler.start();
    retentionScheduler.start();
    mcpCollectScheduler.start();
    browserCollectScheduler.start();

    console.log("[Instrumentation] 调度器已启动: audit / cleanup / vector / retention / mcp-collect / browser-collect");

    // 启动 AI API 健康检查（降级恢复）
    const { ModelAdapter } = await import("./src/lib/ai/model-adapter");
    ModelAdapter.startHealthCheck();
    console.log("[Instrumentation] AI API 健康检查已启动");

    // 启动本地工具目录监听器（Cursor/Codex/Claude Code 等会话文件采集）
    const { startToolDirWatcher, stopToolDirWatcher } = await import(
      "./src/server/watchers/tool-dir-watcher"
    );
    startToolDirWatcher().catch((e) => {
      console.error("[Instrumentation] ToolDirWatcher 启动失败:", e);
    });

    // 注册进程退出时的优雅关闭
    const shutdown = (signal: string) => {
      console.log(`[Instrumentation] 收到 ${signal}，正在关闭调度器...`);
      auditScheduler?.stop();
      cleanupScheduler?.stop();
      vectorScheduler?.stop();
      retentionScheduler?.stop();
      mcpCollectScheduler?.stop();
      browserCollectScheduler?.stop();
      stopToolDirWatcher();
      ModelAdapter.stopHealthCheck();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
