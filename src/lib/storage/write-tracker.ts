/**
 * 记录本进程最近写入的文件路径，用于文件监听器识别“自己写的文件”，
 * 避免 Markdown 写回 → 文件监听 → 再次入队的循环。
 */

const recentWrites = new Map<string, number>();
const RECENT_MS = 5000;

export function recordWrite(filePath: string): void {
  recentWrites.set(filePath, Date.now());
}

export function isRecentWrite(filePath: string): boolean {
  const ts = recentWrites.get(filePath);
  if (!ts) return false;
  if (Date.now() - ts > RECENT_MS) {
    recentWrites.delete(filePath);
    return false;
  }
  return true;
}
