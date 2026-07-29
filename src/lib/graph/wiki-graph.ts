import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { getNotesPath } from "../storage/path-resolver";
import { parseWikilinks } from "../storage/markdown-formatter";
import { parseMemoryFromFile } from "../storage/markdown-parser";
import { MemoryRecord } from "../../types/memory";

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

  /** 扫描所有笔记文件，列出所有 markdown 文件路径 */
  scanAllFiles(): string[] {
    const files: string[] = [];
    this.scanDir(this.notesPath, files);
    return files;
  }

  private scanDir(dir: string, results: string[]): void {
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "archive") {
            this.scanDir(fullPath, results);
          }
        } else if (entry.isFile() && extname(entry.name) === ".md") {
          results.push(fullPath);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  /** 从所有文件中构建完整 wikilink 索引 */
  buildIndex(): Map<string, string[]> {
    const files = this.scanAllFiles();
    const index = new Map<string, string[]>();

    for (const filePath of files) {
      const record = parseMemoryFromFile(filePath);
      if (!record || !record.id) continue;

      // frontmatter 中的 related 字段
      const allLinks = [...record.graphLinks];

      // 正文中的 [[wikilink]]
      const content = readFileSync(filePath, "utf-8");
      const contentLinks = parseWikilinks(content);

      const merged = [...new Set([...allLinks, ...contentLinks])];
      index.set(
        record.id,
        merged.filter((id) => id && id !== record.id),
      );
    }

    return index;
  }

  /** 查找关联记忆（按出度，即 from → to） */
  getOutgoingLinks(memoryId: string): string[] {
    const index = this.buildIndex();
    return index.get(memoryId) || [];
  }

  /** 查找反向关联（谁引用了这个记忆） */
  getIncomingLinks(memoryId: string): string[] {
    const index = this.buildIndex();
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
    const outgoing = this.getOutgoingLinks(memoryId);
    const incoming = this.getIncomingLinks(memoryId);
    return [...new Set([...outgoing, ...incoming])];
  }

  /** 搜索路径（BFS，最多 3 跳） */
  findPath(fromId: string, toId: string, maxDepth: number = 3): string[][] | null {
    const index = this.buildIndex();
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
    const index = this.buildIndex();
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
  }
}
