import { promises as fs } from "fs";
import { join, extname } from "path";
import { getNotesPath } from "../storage/path-resolver";
import { parseMemoryFromText } from "../storage/markdown-parser";

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
 * - 单次文件读取复用（每文件只读一次，同时解析 frontmatter + wikilink）
 * - 增量更新：仅重新索引变更/新增/删除的文件
 */

export class WikiGraph {
  private notesPath = getNotesPath();

  /** 缓存的图谱索引 */
  private cachedIndex: Map<string, string[]> | null = null;
  /** 记录每个文件最后扫描时的 mtime，用于增量校验 */
  private fileMtimes: Map<string, number> = new Map();
  /** 文件路径到 memoryId 的映射，用于删除时精确清理 */
  private fileMemoryIds: Map<string, string> = new Map();

  // ── 内部 ──

  /** 收集 notesPath 下所有 .md 文件（跳过 archive） */
  private async collectFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(this.notesPath, files);
    return files;
  }

  private async walkDir(dir: string, results: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "archive") {
            await this.walkDir(fullPath, results);
          }
        } else if (entry.isFile() && extname(entry.name) === ".md") {
          results.push(fullPath);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  /** 检测文件变化，无变化返回缓存，有变化则增量 / 全量重建 */
  private async ensureIndex(): Promise<Map<string, string[]>> {
    const files = await this.collectFiles();

    // 首次加载或文件数量变化 → 全量重建
    if (this.cachedIndex === null || files.length !== this.fileMtimes.size) {
      return this.rebuildIndex(files);
    }

    // 增量检测：找出变更/新增/删除的文件
    const changed: string[] = [];
    const currentFiles = new Set(files);

    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        if (this.fileMtimes.get(filePath) !== stat.mtimeMs) {
          changed.push(filePath);
        }
      } catch {
        changed.push(filePath);
      }
    }

    // 检测已删除的文件
    const deleted: string[] = [];
    for (const cachedPath of this.fileMtimes.keys()) {
      if (!currentFiles.has(cachedPath)) {
        deleted.push(cachedPath);
      }
    }

    if (changed.length === 0 && deleted.length === 0) {
      return this.cachedIndex;
    }

    // 有变化 → 增量更新
    return this.updateIndex(changed, deleted, files);
  }

  /** 第一次或文件数变化 → 全量重建 */
  private async rebuildIndex(files: string[]): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    const newMtimes = new Map<string, number>();
    const newFileMemoryIds = new Map<string, string>();

    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        newMtimes.set(filePath, stat.mtimeMs);

        // 只读一次文件，parseMemoryFromText 已从正文中提取 wikilink
        // 并合并 frontmatter related 字段到 graphLinks
        const content = await fs.readFile(filePath, "utf-8");
        const record = parseMemoryFromText(content);
        if (!record || !record.id) continue;

        newFileMemoryIds.set(filePath, record.id);
        index.set(
          record.id,
          record.graphLinks.filter((id) => id && id !== record.id),
        );
      } catch {
        // 跳过无法解析的文件
      }
    }

    this.cachedIndex = index;
    this.fileMtimes = newMtimes;
    this.fileMemoryIds = newFileMemoryIds;
    return index;
  }

  /** 增量更新：仅处理变更和删除的文件 */
  private async updateIndex(
    changed: string[],
    deleted: string[],
    _allFiles: string[],
  ): Promise<Map<string, string[]>> {
    const index = new Map(this.cachedIndex!);

    // 处理变更/新增文件：读取一次，同时更新 mtime 和索引条目
    for (const filePath of changed) {
      try {
        const stat = await fs.stat(filePath);
        this.fileMtimes.set(filePath, stat.mtimeMs);

        const content = await fs.readFile(filePath, "utf-8");
        const record = parseMemoryFromText(content);
        if (!record || !record.id) continue;

        const previousMemoryId = this.fileMemoryIds.get(filePath);
        if (previousMemoryId && previousMemoryId !== record.id) {
          index.delete(previousMemoryId);
        }
        index.set(
          record.id,
          record.graphLinks.filter((id) => id && id !== record.id),
        );
        this.fileMemoryIds.set(filePath, record.id);
      } catch {
        // 无法读取 → 跳过
      }
    }

    // 处理删除文件：利用 filePath → memoryId 映射精确清理，不再全量重建
    for (const filePath of deleted) {
      this.fileMtimes.delete(filePath);
      const memoryId = this.fileMemoryIds.get(filePath);
      if (memoryId) {
        index.delete(memoryId);
        this.fileMemoryIds.delete(filePath);
      }
    }

    this.cachedIndex = index;
    return index;
  }

  /** 使缓存失效（外部修改文件后调用） */
  invalidateCache(): void {
    this.cachedIndex = null;
    this.fileMtimes.clear();
    this.fileMemoryIds.clear();
  }

  // ── 公开查询 ──

  async scanAllFiles(): Promise<string[]> {
    return this.collectFiles();
  }

  async buildIndex(): Promise<Map<string, string[]>> {
    return this.ensureIndex();
  }

  /** 查找关联记忆（按出度，即 from → to） */
  async getOutgoingLinks(memoryId: string): Promise<string[]> {
    const index = await this.ensureIndex();
    return index.get(memoryId) || [];
  }

  /** 查找反向关联（谁引用了这个记忆） */
  async getIncomingLinks(memoryId: string): Promise<string[]> {
    const index = await this.ensureIndex();
    const incoming: string[] = [];

    for (const [sourceId, targets] of index) {
      if (targets.includes(memoryId)) {
        incoming.push(sourceId);
      }
    }

    return incoming;
  }

  /** 获取邻居记忆（出度 + 入度） */
  async getNeighbors(memoryId: string): Promise<string[]> {
    const index = await this.ensureIndex();
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
  async findPath(fromId: string, toId: string, maxDepth: number = 3): Promise<string[][] | null> {
    const index = await this.ensureIndex();
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
  async getStats(): Promise<{ totalNodes: number; totalEdges: number; orphans: number }> {
    const index = await this.ensureIndex();
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
  async addWikilinkToFile(fromFile: string, toMemoryId: string): Promise<void> {
    let content = await fs.readFile(fromFile, "utf-8");

    // 检查是否已存在该 wikilink
    if (content.includes(`[[${toMemoryId}]]`)) return;

    // 追加到文件末尾
    content += `\n[[${toMemoryId}]]\n`;
    await fs.writeFile(fromFile, content, "utf-8");

    // 使缓存失效
    this.invalidateCache();
  }
}
