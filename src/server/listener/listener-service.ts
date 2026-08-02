/**
 * 后台监听服务
 *
 * 在 Next.js instrumentation 中注册，追踪监听器运行状态，
 * 负责启动文件监听和提供运行状态查询。
 */
import { startFileWatcher, stopFileWatcher } from "../watchers/file-watcher";
import { logger } from "../../lib/logger";

let isRunning = false;
let startTime: string | null = null;

export type ListenerStatus = {
  running: boolean;
  startTime: string | null;
  uptime: number;
  port: number;
  endpoints: {
    listen: string;
    ingest: string;
    status: string;
  };
};

/** 启动所有监听器 */
export function startAllListeners(port: number = 3000): void {
  if (isRunning) return;

  isRunning = true;
  startTime = new Date().toISOString();

  // 启动文件系统监听（自动导入 memory-root 下的 .md 文件）
  startFileWatcher();

  logger.ingest.info(`[ListenerService] 后台监听已启动，端口: ${port}`);
  logger.ingest.info(`[ListenerService] API 端点: POST http://localhost:${port}/api/listen`);
  logger.ingest.info(`[ListenerService] 状态查询: GET  http://localhost:${port}/api/listen`);
}

/** 停止所有监听器 */
export function stopAllListeners(): void {
  if (!isRunning) return;

  stopFileWatcher();
  isRunning = false;
  startTime = null;

  logger.ingest.info("[ListenerService] 后台监听已停止");
}

/** 获取运行状态 */
export function getListenerStatus(port: number = 3000): ListenerStatus {
  return {
    running: isRunning,
    startTime,
    uptime: startTime ? (Date.now() - new Date(startTime).getTime()) / 1000 : 0,
    port,
    endpoints: {
      listen: `POST http://localhost:${port}/api/listen`,
      ingest: `POST http://localhost:${port}/api/ingest`,
      status: `GET  http://localhost:${port}/api/listen`,
    },
  };
}
