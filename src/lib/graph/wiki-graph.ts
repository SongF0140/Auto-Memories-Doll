import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, extname } from "path";
import { getNotesPath } from "../storage/path-resolver";
import { parseWikilinks } from "../storage/markdown-formatter";
import { parseMemoryFromFile } from "../storage/markdown-parser";

/**
 * LLMWiki 图谱管理器（文件级）
 *
 * 替代 SQLite graph_edges 表，直接从 Markdown 文件中的 [[wikilink]]
 * 解析关系网。关系数据不单独存储——wikilink 就是关系。
 *
 * 优势：
 * - LLM 可直接读取文件理解关系
 * - 无需数据库迁移维护
 * - Git 可 diff 出关系变化
 *
 * 性能优化：
 * - 基于文件 mtime 的索引缓存，避免每次调用都全量扫描
 * - 单次文件读取复用（同一文件不重复 readFileSync）
 */

export type WikilinkRelation = {
  /** 源记忆 ID */
  from: string;
  /** 目标记忆 ID */
  to: string;
  /** 关系来源：wikilink 或 frontmatter related 字段 */
};

export class WikiGraph {
  private notesPath = getNotesPath();

  /** 缓存的图谱索引 */
  private cachedIndex: Map<string, string[]> | null = null;
  /** 记录每个文件最后扫描时的 mtime，用于增量校验 */
  private fileMtimes: Map<string, number> = new Map();

  // ── 内部 ──

  /** 收集 notesPath 下所有 .md 文件（跳过 archive） */
  private collectFiles(): string[] {
    const files: string[] = [];
    this.walkDir(this.notesPath, files);
    return files;
  }

  private walkDir(dir: string, results: string[]): void {
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "archive") {
            this.walkDir(fullPath, results);
          }
        } else if (entry.isFile() && extname(entry.name) === ".md") {
          results.push(fullPath);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  /** 检测是否有文件变化，有则重建索引 */
  private ensureIndex(): Map<string, string[]> {
    const files = this.collectFiles();

    // 文件数量变化 → 直接重建
    if (this.cachedIndex === null || files.length !== this.fileMtimes.size) {
      return this.rebuildIndex(files);
    }

    // 逐个检查 mtime
    for (const filePath of files) {
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (this.fileMtimes.get(filePath) !== mtime) {
          // 有变化 → 重建整个索引
          return this.rebuildIndex(files);
        }
      } catch {
        // 文件不可读 → 重建
        return this.rebuildIndex(files);
      }
    }

    // 无变化，返回缓存
    return this.cachedIndex;
  }

  /** 全量重建索引并更新缓存 */
  private rebuildIndex(files: string[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    const newMtimes = new Map<string, number>();

    for (const filePath of files) {
      try {
        const mtime = statSync(filePath).mtimeMs;
        newMtimes.set(filePath, mtime);

        const record = parseMemoryFromFile(filePath);
        if (!record || !record.id) continue;

        // 一次性读取文件内容（parseMemoryFromFile 已经读过，但
        // frontmatter 解析后剩下的正文部分需要重新读取以提取 wikilink）
        const content = readFileSync(filePath, "utf-8");

        // frontmatter 中的 related 字段
        const allLinks = [...record.graphLinks];

        // 正文中的 [[wikilink]]（跳过 frontmatter 区域）
        const bodyStart = content.indexOf("---\n", 4);
        const body = bodyStart !== -1 ? content.slice(content.indexOf("\n", bodyStart) + 1) : content;
        const contentLinks = parseWikilinks(body);

        const merged = [...new Set([...allLinks, ...contentLinks])];
        index.set(
          record.id,
          merged.filter((id) => id && id !== record.id),
        );
      } catch {
        // 跳过无法解析的文件
      }
    }

    this.cachedIndex = index;
    this.fileMtimes = newMtimes;
    return index;
  }

  /** 使缓存失效（外部修改文件后调用） */
  invalidateCache(): void {
    this.cachedIndex = null;
    this.fileMtimes.clear();
  }

  // ── 公开查询 ──

  scanAllFiles(): string[] {
    return this.collectFiles();
  }

  buildIndex(): Map<string, string[]> {
    return this.ensureIndex();
  }

  /** 查找关联记忆（按出度，即 from → to） */
  getOutgoingLinks(memoryId: string): string[] {
    return this.ensureIndex().get(memoryId) || [];
  }

  /** 查找反向关联（谁引用了这个记忆） */
  getIncomingLinks(memoryId: string): string[] {
    const index = this.ensureIndex();
    const incoming: string[] = [];

    for (const [sourceId, targets] of index) {
      if (targets.includes(memoryId)) {
        incoming.push(sourceId);
      }
    }

    return incoming;
  }

  /** 获取邻居记忆（出度 + 入度） */
  getNeighbors(memoryId: string): string[] {
    const index = this.ensureIndex();
    const outgoing = index.get(memoryId) || [];
    const incoming: string[] = [];

    for (const [sourceId, targets] of index) {
      if (targets.includes(memoryId)) {
        incoming.push(sourceId);
      }
    }

    return [...new Set([...outgoing, ...incoming])];
  }

  /** 搜索路径（BFS，最多 3 跳） */
  findPath(fromId: string, toId: string, maxDepth: number = 3): string[][] | null {
    const index = this.ensureIndex();
    const visited = new Set<string>();
    const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (id === toId) return [path];
      if (path.length > maxDepth) continue;
      if (visited.has(id)) continue;
      visited.add(id);

      const links = index.get(id) || [];
      for (const linkId of links) {
        if (!visited.has(linkId)) {
          queue.push({ id: linkId, path: [...path, linkId] });
        }
      }
    }

    return null;
  }

  /** 获取图谱统计 */
  getStats(): { totalNodes: number; totalEdges: number; orphans: number } {
    const index = this.ensureIndex();
    let totalEdges = 0;
    let orphans = 0;

    for (const [, links] of index) {
      totalEdges += links.length;
      if (links.length === 0) orphans++;
    }

    return {
      totalNodes: index.size,
      totalEdges,
      orphans,
    };
  }

  /** 两个记忆之间添加 wikilink（在文件中追加） */
  addWikilinkToFile(fromFile: string, toMemoryId: string): void {
    let content = readFileSync(fromFile, "utf-8");

    // 检查是否已存在该 wikilink
    if (content.includes(`[[${toMemoryId}]]`)) return;

    // 追加到文件末尾
    content += `\n[[${toMemoryId}]]\n`;
    writeFileSync(fromFile, content, "utf-8");

    // 使缓存失效
    this.invalidateCache();
  }
}
