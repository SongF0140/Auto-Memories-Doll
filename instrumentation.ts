export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAllListeners } = await import("./src/server/listener/listener-service");
    const port = parseInt(process.env.PORT || "3000", 10);
    startAllListeners(port);

    // ── 后台调度器 ──
    const { AuditScheduler } = await import("./src/server/schedulers/audit-scheduler");
    const { CleanupScheduler } = await import("./src/server/schedulers/cleanup-scheduler");
    const { VectorScheduler } = await import("./src/server/schedulers/vector-scheduler");

    const auditScheduler = new AuditScheduler();
    const cleanupScheduler = new CleanupScheduler();
    const vectorScheduler = new VectorScheduler();

    auditScheduler.start();
    cleanupScheduler.start();
    vectorScheduler.start();

    console.log("[Instrumentation] 调度器已启动: audit / cleanup / vector");
  }
}
