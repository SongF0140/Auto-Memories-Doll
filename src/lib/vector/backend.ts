import { existsSync, mkdirSync } from "fs";
import { createRequire } from "module";
import { dirname, resolve } from "path";
import Database from "better-sqlite3";
import { logger } from "../logger";
import { cosineSimilarity } from "./similarity";
import { createShimUsearchModule } from "./usearch-shim";

export type VectorSearchRow = {
  memoryId: string;
  embedding: number[];
  dimensions?: number;
};

export type VectorSearchResult = {
  memoryId: string;
  similarity: number;
};

export interface VectorSearchBackend {
  readonly name: string;
  search(queryEmbedding: number[], limit: number): VectorSearchResult[];
  upsert(row: VectorSearchRow, previous?: VectorSearchRow | null): void;
  delete(memoryId: string, previous?: VectorSearchRow | null): void;
  rebuild(dimensions?: number): void;
  close?(): void;
  dispose?(): void;
  free?(): void;
}

type RowSource = () => VectorSearchRow[];

/**
 * 精确检索降级后端。
 *
 * 它仍然执行 O(N) 余弦扫描，只在显式 VECTOR_BACKEND=js、原生 ANN
 * 初始化失败或索引恢复失败时使用，不再作为默认路径。
 */
export class JsVectorSearchBackend implements VectorSearchBackend {
  readonly name = "js-exact";
  private readonly rowSource: RowSource;

  constructor(source: RowSource | VectorSearchRow[] = []) {
    this.rowSource = typeof source === "function" ? source : () => source;
  }

  search(queryEmbedding: number[], limit: number): VectorSearchResult[] {
    if (limit <= 0) return [];

    return this.rowSource()
      .filter((row) => row.embedding.length === queryEmbedding.length)
      .map((row) => ({
        memoryId: row.memoryId,
        similarity: cosineSimilarity(queryEmbedding, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  upsert(): void {
    // SQLite 是真源，精确后端在查询时直接读取最新数据。
  }

  delete(): void {
    // SQLite 是真源，精确后端在查询时直接读取最新数据。
  }

  rebuild(): void {
    // 无派生索引需要重建。
  }
}

type HnswState = {
  index: UsearchIndex;
  dimensions: number;
  indexedVersion: number;
};

type UsearchIndex = {
  size(): number;
  search(
    vector: Float32Array,
    count: number,
    threads?: number,
  ): { keys: ArrayLike<bigint | number>; distances: ArrayLike<number> };
  add(keyOrKeys: bigint | BigUint64Array, vectorOrVectors: Float32Array, threads?: number): void;
  load(path: string): void;
  save(path: string): void;
  contains(key: bigint): boolean;
  remove(key: bigint): void;
  close?(): void;
  dispose?(): void;
  free?(): void;
};

type UsearchModule = {
  Index: new (options: Record<string, unknown>) => UsearchIndex;
  MetricKind: { Cos: unknown };
  ScalarKind: { F32: unknown };
};

type AnnStateRow = {
  schemaVersion: number;
  sourceVersion: number;
};

type AnnDimensionRow = {
  indexedVersion: number;
  recordCount: number;
};

type VectorDbRow = {
  memoryId: string;
  embedding: string;
  dimensions: number;
};

const HNSW_CONNECTIVITY = 16;
const HNSW_EXPANSION_ADD = 128;
const HNSW_EXPANSION_SEARCH = 64;
const HNSW_SCHEMA_VERSION = 1;
const requireFromHere = createRequire(import.meta.url);
let usearchModule: UsearchModule | undefined;

function loadUsearch(): UsearchModule {
  if (usearchModule !== undefined) {
    return usearchModule;
  }

  try {
    usearchModule = requireFromHere("usearch") as UsearchModule;
    return usearchModule;
  } catch (error) {
    logger.vector.warn("usearch native module unavailable，已切换到本地 HNSW shim", {
      error: (error as Error).message,
    });
    usearchModule = createShimUsearchModule();
    return usearchModule;
  }
}

/**
 * USearch HNSW 后端。
 *
 * - SQLite vector_records 是唯一真源。
 * - .usearch 文件是可删除、可重建的 ANN 加速层。
 * - memoryId 与 USearch uint64 key 的映射持久化在 SQLite。
 * - SQLite 触发器维护 sourceVersion；版本不一致或文件损坏时自动重建。
 * - 不同 embedding 维度分别维护一个 HNSW 图，避免模型切换期间维度冲突。
 */
export class HnswVectorSearchBackend implements VectorSearchBackend {
  readonly name = "hnsw-usearch";
  private readonly db: Database.Database;
  private readonly indexBasePath: string | null;
  private readonly usearch: UsearchModule;
  private readonly states = new Map<number, HnswState>();

  constructor(db: Database.Database, indexBasePath?: string | null) {
    this.db = db;
    this.indexBasePath = indexBasePath === undefined ? this.defaultIndexBasePath() : indexBasePath;
    this.usearch = loadUsearch();
    this.initSchema();
  }

  search(queryEmbedding: number[], limit: number): VectorSearchResult[] {
    if (limit <= 0 || queryEmbedding.length === 0) return [];

    const dimensions = queryEmbedding.length;
    const state = this.ensureState(dimensions);
    const size = state.index.size();
    if (size === 0) return [];

    const candidateCount = Math.min(size, Math.max(limit * 4, limit + 24));
    const matches = state.index.search(new Float32Array(queryEmbedding), candidateCount, 1);

    const results: VectorSearchResult[] = [];
    for (let i = 0; i < matches.keys.length; i++) {
      const memoryId = this.memoryIdForKey(BigInt(matches.keys[i]));
      if (!memoryId) continue;
      results.push({
        memoryId,
        // USearch 的 cosine metric 返回 cosine distance（1 - cosine similarity）。
        similarity: Math.max(-1, Math.min(1, 1 - matches.distances[i])),
      });
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  upsert(row: VectorSearchRow, previous?: VectorSearchRow | null): void {
    const previousDimensions = previous?.embedding.length ?? previous?.dimensions;
    const nextDimensions = row.embedding.length || row.dimensions;
    const currentVersion = this.getSourceVersion();
    if (!this.canApplySingleMutation(currentVersion, [previousDimensions, nextDimensions])) {
      // 版本跳跃表示还有其他写入者绕过了当前 backend；丢弃相关维度的进程内图，
      // 下次查询按 SQLite 全量重建，避免把不完整的图误标为最新版本。
      this.dropStates([previousDimensions, nextDimensions]);
      return;
    }

    if (previousDimensions && previousDimensions !== nextDimensions) {
      const previousState = this.states.get(previousDimensions);
      if (previousState) this.removeFromState(previousState, row.memoryId);
      if (previousState) this.persistStateWithVersion(previousState, currentVersion);
    }

    if (nextDimensions) {
      const nextState = this.states.get(nextDimensions) ?? this.ensureState(nextDimensions);
      this.removeFromState(nextState, row.memoryId);
      nextState.index.add(this.keyForMemoryId(row.memoryId), new Float32Array(row.embedding));
      this.persistStateWithVersion(nextState, currentVersion);
    }
  }

  delete(memoryId: string, previous?: VectorSearchRow | null): void {
    if (!previous) return;
    const previousDimensions = previous?.embedding.length ?? previous?.dimensions;
    const currentVersion = this.getSourceVersion();
    if (!this.canApplySingleMutation(currentVersion, [previousDimensions])) {
      this.dropStates([previousDimensions]);
      return;
    }

    if (previousDimensions) {
      const state = this.states.get(previousDimensions);
      if (state) {
        this.removeFromState(state, memoryId);
        this.persistStateWithVersion(state, currentVersion);
      }
    } else {
      for (const state of this.states.values()) {
        this.removeFromState(state, memoryId);
        this.persistStateWithVersion(state, currentVersion);
      }
    }
  }

  rebuild(dimensions?: number): void {
    if (dimensions !== undefined) {
      this.rebuildDimension(dimensions);
      return;
    }

    const rows = this.db
      .prepare("SELECT DISTINCT dimensions FROM vector_records ORDER BY dimensions")
      .all() as Array<{ dimensions: number }>;
    this.closeStates();
    this.states.clear();
    for (const row of rows) this.rebuildDimension(row.dimensions);
  }

  close(): void {
    this.closeStates();
    this.states.clear();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_ann_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schemaVersion INTEGER NOT NULL,
        sourceVersion INTEGER NOT NULL DEFAULT 0
      );

      INSERT OR IGNORE INTO vector_ann_state (id, schemaVersion, sourceVersion)
      VALUES (1, ${HNSW_SCHEMA_VERSION}, 0);

      CREATE TABLE IF NOT EXISTS vector_ann_dimensions (
        dimensions INTEGER PRIMARY KEY,
        indexedVersion INTEGER NOT NULL,
        recordCount INTEGER NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vector_ann_keys (
        annKey INTEGER PRIMARY KEY AUTOINCREMENT,
        memoryId TEXT NOT NULL UNIQUE
      );

      CREATE TRIGGER IF NOT EXISTS vector_records_ann_insert
      AFTER INSERT ON vector_records
      BEGIN
        UPDATE vector_ann_state SET sourceVersion = sourceVersion + 1 WHERE id = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS vector_records_ann_update
      AFTER UPDATE ON vector_records
      BEGIN
        UPDATE vector_ann_state SET sourceVersion = sourceVersion + 1 WHERE id = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS vector_records_ann_delete
      AFTER DELETE ON vector_records
      BEGIN
        UPDATE vector_ann_state SET sourceVersion = sourceVersion + 1 WHERE id = 1;
      END;
    `);

    const state = this.db
      .prepare("SELECT schemaVersion, sourceVersion FROM vector_ann_state WHERE id = 1")
      .get() as AnnStateRow;
    if (state.schemaVersion !== HNSW_SCHEMA_VERSION) {
      this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE vector_ann_state SET schemaVersion = ?, sourceVersion = sourceVersion + 1 WHERE id = 1",
          )
          .run(HNSW_SCHEMA_VERSION);
        this.db.prepare("DELETE FROM vector_ann_dimensions").run();
      })();
    }
  }

  private ensureState(dimensions: number): HnswState {
    const sourceVersion = this.getSourceVersion();
    const cached = this.states.get(dimensions);
    if (cached && cached.indexedVersion === sourceVersion) return cached;

    if (cached) this.dropState(dimensions);

    const persisted = this.db
      .prepare("SELECT indexedVersion, recordCount FROM vector_ann_dimensions WHERE dimensions = ?")
      .get(dimensions) as AnnDimensionRow | undefined;
    const indexPath = this.indexPath(dimensions);

    if (
      persisted &&
      persisted.indexedVersion === sourceVersion &&
      indexPath &&
      existsSync(indexPath)
    ) {
      try {
        const index = this.createIndex(dimensions);
        index.load(indexPath);
        if (index.size() !== persisted.recordCount) {
          throw new Error(
            `索引记录数不匹配: file=${index.size()}, sqlite=${persisted.recordCount}`,
          );
        }
        const state = { index, dimensions, indexedVersion: sourceVersion };
        this.states.set(dimensions, state);
        return state;
      } catch (error) {
        logger.vector.warn("HNSW 索引加载失败，将从 SQLite 自动重建", {
          dimensions,
          error: (error as Error).message,
        });
      }
    }

    return this.rebuildDimension(dimensions);
  }

  private rebuildDimension(dimensions: number): HnswState {
    const rows = this.db
      .prepare(
        "SELECT memoryId, embedding, dimensions FROM vector_records WHERE dimensions = ? ORDER BY memoryId",
      )
      .all(dimensions) as VectorDbRow[];
    const index = this.createIndex(dimensions);

    if (rows.length > 0) {
      const keys: bigint[] = [];
      const vectors: number[] = [];

      for (const row of rows) {
        try {
          const embedding = JSON.parse(row.embedding) as number[];
          if (embedding.length !== dimensions) {
            throw new Error(`向量 ${row.memoryId} 的 dimensions 字段与实际长度不一致`);
          }
          keys.push(this.keyForMemoryId(row.memoryId));
          vectors.push(...embedding);
        } catch (error) {
          logger.vector.warn("跳过损坏的向量记录，继续重建 HNSW 索引", {
            memoryId: row.memoryId,
            error: (error as Error).message,
          });
        }
      }

      if (keys.length > 0) {
        index.add(
          BigUint64Array.from(keys),
          Float32Array.from(vectors),
          1,
        );
      }
    }

    const sourceVersion = this.getSourceVersion();
    const state = { index, dimensions, indexedVersion: sourceVersion };
    this.states.set(dimensions, state);
    this.persistState(state);

    logger.vector.info("HNSW 索引已从 SQLite 重建", {
      dimensions,
      records: rows.length,
      sourceVersion,
    });
    return state;
  }

  private createIndex(dimensions: number): UsearchIndex {
    return new this.usearch.Index({
      dimensions,
      metric: this.usearch.MetricKind.Cos,
      quantization: this.usearch.ScalarKind.F32,
      connectivity: HNSW_CONNECTIVITY,
      expansion_add: HNSW_EXPANSION_ADD,
      expansion_search: HNSW_EXPANSION_SEARCH,
      multi: false,
    });
  }

  private canApplySingleMutation(
    sourceVersion: number,
    dimensions: Array<number | undefined>,
  ): boolean {
    for (const dimension of dimensions) {
      if (!dimension) continue;
      const state = this.states.get(dimension);
      if (!state) continue;
      if (state.indexedVersion !== sourceVersion - 1) return false;
    }
    return true;
  }

  private persistStateWithVersion(state: HnswState, sourceVersion: number): void {
    state.indexedVersion = sourceVersion;
    this.persistState(state);
  }

  private persistState(state: HnswState): void {
    const indexPath = this.indexPath(state.dimensions);
    if (indexPath) {
      mkdirSync(dirname(indexPath), { recursive: true });
      state.index.save(indexPath);
    }

    this.db
      .prepare(
        `
        INSERT INTO vector_ann_dimensions (dimensions, indexedVersion, recordCount, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(dimensions) DO UPDATE SET
          indexedVersion = excluded.indexedVersion,
          recordCount = excluded.recordCount,
          updatedAt = excluded.updatedAt
      `,
      )
      .run(state.dimensions, state.indexedVersion, state.index.size(), new Date().toISOString());
  }

  private removeFromState(state: HnswState, memoryId: string): void {
    const key = this.lookupKey(memoryId);
    if (key !== null && state.index.contains(key)) state.index.remove(key);
  }

  private keyForMemoryId(memoryId: string): bigint {
    this.db.prepare("INSERT OR IGNORE INTO vector_ann_keys (memoryId) VALUES (?)").run(memoryId);
    const key = this.lookupKey(memoryId);
    if (key === null) throw new Error(`无法为向量分配 ANN key: ${memoryId}`);
    return key;
  }

  private lookupKey(memoryId: string): bigint | null {
    const row = this.db
      .prepare("SELECT annKey FROM vector_ann_keys WHERE memoryId = ?")
      .get(memoryId) as { annKey: number | bigint } | undefined;
    return row ? BigInt(row.annKey) : null;
  }

  private memoryIdForKey(key: bigint): string | null {
    const row = this.db
      .prepare("SELECT memoryId FROM vector_ann_keys WHERE annKey = ?")
      .get(key) as { memoryId: string } | undefined;
    return row?.memoryId ?? null;
  }

  private getSourceVersion(): number {
    const row = this.db
      .prepare("SELECT sourceVersion FROM vector_ann_state WHERE id = 1")
      .get() as AnnStateRow;
    return row.sourceVersion;
  }

  private defaultIndexBasePath(): string | null {
    if (!this.db.name || this.db.name === ":memory:") return null;
    return `${resolve(this.db.name)}.ann`;
  }

  private indexPath(dimensions: number): string | null {
    return this.indexBasePath ? `${this.indexBasePath}-${dimensions}.usearch` : null;
  }

  private dropStates(dimensions: Array<number | undefined>): void {
    for (const dimension of dimensions) {
      if (dimension) this.dropState(dimension);
    }
  }

  private dropState(dimensions: number): void {
    const state = this.states.get(dimensions);
    if (!state) return;
    this.disposeIndex(state.index);
    this.states.delete(dimensions);
  }

  private closeStates(): void {
    for (const state of this.states.values()) this.disposeIndex(state.index);
  }

  private disposeIndex(index: UsearchIndex): void {
    index.close?.();
    index.dispose?.();
    index.free?.();
  }
}

export type VectorBackendKind = "hnsw" | "js" | "sqlite-vec";

export function createVectorSearchBackend(
  db: Database.Database,
  kind = process.env.VECTOR_BACKEND || "hnsw",
): VectorSearchBackend {
  const rowSource = (): VectorSearchRow[] => {
    const rows = db
      .prepare("SELECT memoryId, embedding, dimensions FROM vector_records")
      .all() as VectorDbRow[];
    return rows.map((row) => ({
      memoryId: row.memoryId,
      embedding: JSON.parse(row.embedding) as number[],
      dimensions: row.dimensions,
    }));
  };

  if (kind === "js") return new JsVectorSearchBackend(rowSource);

  if (kind === "sqlite-vec") {
    logger.vector.warn("VECTOR_BACKEND=sqlite-vec 已弃用，自动迁移到 HNSW ANN");
  }

  try {
    return new HnswVectorSearchBackend(db);
  } catch (error) {
    logger.vector.warn("HNSW 后端初始化失败，已降级到 JS 精确检索", {
      error: (error as Error).message,
    });
    return new JsVectorSearchBackend(rowSource);
  }
}
