let auditScheduler: { start: () => void; stop: () => void } | null = null;
let cleanupScheduler: { start: () => void; stop: () => void } | null = null;
let vectorScheduler: { start: () => void; stop: () => void } | null = null;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAllListeners } = await import("./src/server/listener/listener-service");
    const port = parseInt(process.env.PORT || "3000", 10);
    startAllListeners(port);

    // ── 后台调度器 ──
    const { AuditScheduler } = await import("./src/server/schedulers/audit-scheduler");
    const { CleanupScheduler } = await import("./src/server/schedulers/cleanup-scheduler");
    const { VectorScheduler } = await import("./src/server/schedulers/vector-scheduler");

    auditScheduler = new AuditScheduler();
    cleanupScheduler = new CleanupScheduler();
    vectorScheduler = new VectorScheduler();

    auditScheduler.start();
    cleanupScheduler.start();
    vectorScheduler.start();

    console.log("[Instrumentation] 调度器已启动: audit / cleanup / vector");

    // 启动 AI API 健康检查（降级恢复）
    const { ModelAdapter } = await import("./src/lib/ai/model-adapter");
    ModelAdapter.startHealthCheck();
    console.log("[Instrumentation] AI API 健康检查已启动");

    // 注册进程退出时的优雅关闭
    const shutdown = (signal: string) => {
      console.log(`[Instrumentation] 收到 ${signal}，正在关闭调度器...`);
      auditScheduler?.stop();
      cleanupScheduler?.stop();
      vectorScheduler?.stop();
      ModelAdapter.stopHealthCheck();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
