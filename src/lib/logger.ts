/** 日志级别 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_MAP: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  message: string;
  extra?: Record<string, unknown>;
}

interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
}

let config: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) || "info",
  enableConsole: true,
};

/** 设置全局日志级别 */
export function setLogLevel(level: LogLevel): void {
  config.level = level;
}

/** 创建模块级日志器 */
export function createLogger(module: string) {
  return {
    debug: (message: string, extra?: Record<string, unknown>) =>
      log(module, "debug", message, extra),
    info: (message: string, extra?: Record<string, unknown>) =>
      log(module, "info", message, extra),
    warn: (message: string, extra?: Record<string, unknown>) =>
      log(module, "warn", message, extra),
    error: (message: string, extra?: Record<string, unknown>) =>
      log(module, "error", message, extra),
  };
}

function log(module: string, level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (LEVEL_MAP[level] < LEVEL_MAP[config.level]) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(extra ? { extra } : {}),
  };

  if (config.enableConsole) {
    const prefix = `[${entry.ts}] [${level.toUpperCase()}] [${module}]`;
    const extras = extra ? ` ${JSON.stringify(extra)}` : "";
    switch (level) {
      case "error":
        console.error(`${prefix} ${message}${extras}`);
        break;
      case "warn":
        console.warn(`${prefix} ${message}${extras}`);
        break;
      case "debug":
        console.debug(`${prefix} ${message}${extras}`);
        break;
      default:
        console.log(`${prefix} ${message}${extras}`);
    }
  }
}

// 预置模块日志器
export const logger = {
  chat: createLogger("chat"),
  memory: createLogger("memory"),
  ingest: createLogger("ingest"),
  audit: createLogger("audit"),
  agent: createLogger("agent"),
  api: createLogger("api"),
  storage: createLogger("storage"),
  vector: createLogger("vector"),
};
