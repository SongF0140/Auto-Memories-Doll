import Database from "better-sqlite3";
import { getDatabasePath } from "./path-resolver";

let instance: Database.Database | null = null;

/**
 * 获取共享的数据库单例连接。
 * 所有 service 共用同一个 SQLite connection，
 * 避免 SQLITE_BUSY 和连接数膨胀。
 */
export function getDatabase(): Database.Database {
  if (!instance) {
    instance = new Database(getDatabasePath());
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
  }
  return instance;
}

/**
 * 关闭数据库连接（仅用于进程退出时）。
 */
export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
