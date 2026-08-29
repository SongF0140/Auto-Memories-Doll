import { promises as fs, existsSync } from "fs";
import { join } from "path";
import { platform } from "os";
import Database from "better-sqlite3";
import { tmpdir } from "os";
import { logger } from "../logger";

/**
 * 浏览器历史与书签采集器。
 *
 * Chrome/Edge 的 History 文件是 SQLite，运行时被浏览器锁定，
 * 必须 copy 一份到临时目录再读。Bookmarks 是 JSON，可直接读。
 *
 * 路径（Windows）：
 * - Chrome: %LOCALAPPDATA%\Google\Chrome\User Data\Default\
 * - Edge:   %LOCALAPPDATA%\Microsoft\Edge\User Data\Default\
 *
 * Chrome 时间戳是 1601-01-01 起的微秒数，需转换为 Unix 毫秒。
 */

type HistoryEntry = {
  url: string;
  title: string;
  visitCount: number;
  lastVisitTime: string; // ISO
  domain: string;
};

type BookmarkNode = {
  name: string;
  url?: string;
  children?: BookmarkNode[];
};

type BookmarkEntry = {
  title: string;
  url: string;
  folder: string;
};

/** 浏览器配置文件路径 */
function getBrowserPaths(): { name: string; profilePath: string }[] {
  const paths: { name: string; profilePath: string }[] = [];
  if (platform() !== "win32") return paths;

  // Windows 正常会提供 LOCALAPPDATA；缺失时跳过采集，避免构建器把整个用户目录当作资源扫描。
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return paths;

  const chromePath = join(localAppData, "Google", "Chrome", "User Data", "Default");
  if (existsSync(chromePath)) paths.push({ name: "Chrome", profilePath: chromePath });

  const edgePath = join(localAppData, "Microsoft", "Edge", "User Data", "Default");
  if (existsSync(edgePath)) paths.push({ name: "Edge", profilePath: edgePath });

  return paths;
}

/** Chrome/Edge 时间戳（1601-01-01 起的微秒数）转 ISO */
function chromeTimeToISO(chromeTime: number): string {
  // 1601-01-01 00:00:00 UTC 的 Unix 毫秒是 -11644473600000
  const unixMs = chromeTime / 1000 - 11644473600000;
  return new Date(unixMs).toISOString();
}

/** 从 URL 提取域名 */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "unknown";
  }
}

/**
 * 采集单个浏览器的最近历史。
 * @param hours 只采集最近 N 小时内的访问
 */
async function collectHistoryFromBrowser(
  name: string,
  profilePath: string,
  hours: number,
): Promise<HistoryEntry[]> {
  const historyPath = join(profilePath, "History");
  if (!existsSync(historyPath)) return [];

  // copy 到临时目录（浏览器锁定了原文件）
  const tempPath = join(tmpdir(), `browser-history-${name}-${Date.now()}.db`);
  try {
    await fs.copyFile(historyPath, tempPath);
  } catch {
    return [];
  }

  try {
    const db = new Database(tempPath, { readonly: true });
    const since = Date.now() - hours * 60 * 60 * 1000;
    const chromeSince = (since + 11644473600000) * 1000;

    const rows = db
      .prepare(
        `SELECT url, title, visit_count, last_visit_time
         FROM urls
         WHERE last_visit_time > ?
         ORDER BY last_visit_time DESC
         LIMIT 500`,
      )
      .all(chromeSince) as Array<{
      url: string;
      title: string;
      visit_count: number;
      last_visit_time: number;
    }>;

    db.close();

    return rows.map((row) => ({
      url: row.url,
      title: row.title || row.url,
      visitCount: row.visit_count,
      lastVisitTime: chromeTimeToISO(row.last_visit_time),
      domain: extractDomain(row.url),
    }));
  } catch (error) {
    logger.ingest.error(`[BrowserCollector] 读取 ${name} 历史失败:`, {
      error: (error as Error).message,
    });
    return [];
  } finally {
    // 清理临时文件
    try {
      await fs.unlink(tempPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 采集书签。
 */
async function collectBookmarksFromBrowser(
  name: string,
  profilePath: string,
): Promise<BookmarkEntry[]> {
  const bookmarksPath = join(profilePath, "Bookmarks");
  if (!existsSync(bookmarksPath)) return [];

  try {
    const content = await fs.readFile(bookmarksPath, "utf-8");
    const data = JSON.parse(content);
    const entries: BookmarkEntry[] = [];

    // Chrome/Edge 书签结构: { roots: { bookmark_bar: {children}, other: {children} } }
    const roots = data.roots || {};
    for (const rootKey of Object.keys(roots)) {
      const root = roots[rootKey];
      if (root && root.children) {
        collectBookmarkNodes(root.children, "根目录", entries);
      }
    }

    return entries;
  } catch {
    return [];
  }
}

function collectBookmarkNodes(
  nodes: BookmarkNode[],
  folder: string,
  entries: BookmarkEntry[],
): void {
  for (const node of nodes) {
    if (node.url) {
      entries.push({ title: node.name, url: node.url, folder });
    } else if (node.children) {
      collectBookmarkNodes(node.children, node.name || folder, entries);
    }
  }
}

/**
 * 按域名分组历史访问，生成结构化摘要。
 */
function groupByDomain(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.domain) || [];
    list.push(entry);
    groups.set(entry.domain, list);
  }
  return groups;
}

/**
 * 采集所有浏览器的最近历史，返回按域名分组的结构化内容。
 * @param hours 采集最近 N 小时
 */
export async function collectBrowserHistory(hours = 2): Promise<
  Array<{
    browser: string;
    content: string;
    domainCount: number;
    visitCount: number;
  }>
> {
  const browsers = getBrowserPaths();
  if (browsers.length === 0) return [];

  const results: Array<{
    browser: string;
    content: string;
    domainCount: number;
    visitCount: number;
  }> = [];

  for (const browser of browsers) {
    const entries = await collectHistoryFromBrowser(browser.name, browser.profilePath, hours);
    if (entries.length === 0) continue;

    const grouped = groupByDomain(entries);
    const lines: string[] = [
      `# ${browser.name} 最近 ${hours} 小时浏览记录`,
      "",
      `共访问 ${entries.length} 个页面，涉及 ${grouped.size} 个域名。`,
      "",
    ];

    // 按访问次数排序域名
    const sortedDomains = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [domain, domainEntries] of sortedDomains.slice(0, 20)) {
      lines.push(`## ${domain}（${domainEntries.length} 次访问）`);
      for (const entry of domainEntries.slice(0, 5)) {
        lines.push(`- ${entry.title}`);
      }
      if (domainEntries.length > 5) {
        lines.push(`- ...等 ${domainEntries.length} 条`);
      }
      lines.push("");
    }

    results.push({
      browser: browser.name,
      content: lines.join("\n"),
      domainCount: grouped.size,
      visitCount: entries.length,
    });
  }

  return results;
}

/**
 * 采集所有浏览器的书签，返回按文件夹分组的结构化内容。
 */
export async function collectBrowserBookmarks(): Promise<
  Array<{
    browser: string;
    content: string;
    bookmarkCount: number;
  }>
> {
  const browsers = getBrowserPaths();
  if (browsers.length === 0) return [];

  const results: Array<{
    browser: string;
    content: string;
    bookmarkCount: number;
  }> = [];

  for (const browser of browsers) {
    const entries = await collectBookmarksFromBrowser(browser.name, browser.profilePath);
    if (entries.length === 0) continue;

    // 按文件夹分组
    const grouped = new Map<string, BookmarkEntry[]>();
    for (const entry of entries) {
      const list = grouped.get(entry.folder) || [];
      list.push(entry);
      grouped.set(entry.folder, list);
    }

    const lines: string[] = [
      `# ${browser.name} 书签收藏`,
      "",
      `共 ${entries.length} 个书签，分布在 ${grouped.size} 个文件夹。`,
      "",
    ];

    for (const [folder, folderEntries] of grouped) {
      lines.push(`## ${folder}（${folderEntries.length} 个）`);
      for (const entry of folderEntries) {
        lines.push(`- [${entry.title}](${entry.url})`);
      }
      lines.push("");
    }

    results.push({
      browser: browser.name,
      content: lines.join("\n"),
      bookmarkCount: entries.length,
    });
  }

  return results;
}
