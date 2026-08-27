import { dirname } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { cosineSimilarity } from "./similarity";

type ShimIndexState = {
  dimensions: number;
  vectors: Array<[string, number[]]>;
};

type ShimIndexOptions = {
  dimensions?: number;
  connectivity?: number;
  expansion_add?: number;
  expansion_search?: number;
  ef_search?: number;
};

type SearchCandidate = {
  key: bigint;
  similarity: number;
};

function toVectorArray(vector: Float32Array): number[] {
  return Array.from(vector, (value) => Number(value));
}

function toKeyArray(keys: bigint | BigUint64Array): bigint[] {
  return typeof keys === "bigint" ? [keys] : Array.from(keys, (key) => BigInt(key));
}

class ShimIndex {
  private vectors = new Map<bigint, number[]>();
  private graph = new Map<bigint, Set<bigint>>();
  private entryPoint: bigint | null = null;
  private dimensions: number;
  private readonly connectivity: number;
  private readonly expansionAdd: number;
  private readonly expansionSearch: number;

  constructor(options: ShimIndexOptions) {
    this.dimensions = Number(options.dimensions || 0);
    this.connectivity = this.clamp(Number(options.connectivity ?? 16), 1, 64);
    this.expansionAdd = this.clamp(Number(options.expansion_add ?? 128), 1, 1024);
    this.expansionSearch = this.clamp(
      Number(options.expansion_search ?? options.ef_search ?? 64),
      1,
      1024,
    );
  }

  size(): number {
    return this.vectors.size;
  }

  search(
    vector: Float32Array,
    count: number,
  ): {
    keys: ArrayLike<bigint | number>;
    distances: ArrayLike<number>;
  } {
    const query = toVectorArray(vector);
    const matches = this.traverse(query, Math.max(count, this.expansionSearch))
      .map((match) => ({
        key: match.key,
        distance: 1 - match.similarity,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);

    return {
      keys: matches.map((match) => match.key),
      distances: matches.map((match) => match.distance),
    };
  }

  add(keyOrKeys: bigint | BigUint64Array, vectorOrVectors: Float32Array): void {
    const keys = toKeyArray(keyOrKeys);
    const values = toVectorArray(vectorOrVectors);
    const dimensions =
      this.dimensions || (keys.length > 0 ? Math.floor(values.length / keys.length) : 0);

    if (keys.length === 1) {
      this.insertSingle(keys[0], values.slice(), dimensions || values.length);
      return;
    }

    for (let i = 0; i < keys.length; i++) {
      const start = i * dimensions;
      const end = start + dimensions;
      this.insertSingle(keys[i], values.slice(start, end), dimensions);
    }
  }

  load(path: string): void {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ShimIndexState;
    this.dimensions = raw.dimensions;
    this.vectors = new Map(raw.vectors.map(([key, embedding]) => [BigInt(key), embedding]));
    this.rebuildGraph();
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const payload: ShimIndexState = {
      dimensions: this.dimensions,
      vectors: Array.from(this.vectors.entries()).map(([key, embedding]) => [
        key.toString(),
        embedding,
      ]),
    };
    writeFileSync(path, JSON.stringify(payload));
  }

  contains(key: bigint): boolean {
    return this.vectors.has(key);
  }

  remove(key: bigint): void {
    const neighbors = this.graph.get(key);
    if (neighbors) {
      for (const neighbor of neighbors) {
        this.graph.get(neighbor)?.delete(key);
      }
    }
    this.vectors.delete(key);
    this.graph.delete(key);
    if (this.entryPoint === key) {
      this.entryPoint = this.firstKey();
    }
  }

  private insertSingle(key: bigint, embedding: number[], dimensions: number): void {
    if (this.vectors.has(key)) {
      this.remove(key);
    }

    this.vectors.set(key, embedding.slice());
    this.ensureNode(key);
    if (this.entryPoint === null) {
      this.entryPoint = key;
    }

    const neighbors = this.findInsertionNeighbors(key, embedding);
    this.linkNode(key, neighbors);
    this.dimensions = dimensions || embedding.length;
  }

  private rebuildGraph(): void {
    const entries = Array.from(this.vectors.entries());
    this.graph = new Map();
    this.entryPoint = null;

    for (const [key] of entries) {
      this.ensureNode(key);
      if (this.entryPoint === null) {
        this.entryPoint = key;
      }
    }

    for (const [key, embedding] of entries) {
      const neighbors = this.findInsertionNeighbors(key, embedding);
      this.linkNode(key, neighbors);
    }
  }

  private findInsertionNeighbors(key: bigint, embedding: number[]): bigint[] {
    if (this.vectors.size <= 1) return [];

    return this.traverse(embedding, this.expansionAdd, key)
      .filter((candidate) => candidate.key !== key)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.connectivity)
      .map((candidate) => candidate.key);
  }

  private traverse(query: number[], budget: number, excludeKey?: bigint): SearchCandidate[] {
    const start = this.entryPoint ?? this.firstKey();
    if (start === null) return [];

    const maxVisits = Math.min(this.vectors.size, Math.max(1, budget));
    const visited = new Set<bigint>();
    const best = new Map<bigint, number>();
    const frontier: SearchCandidate[] = [];

    if (excludeKey !== start) {
      frontier.push({ key: start, similarity: this.similarityForKey(query, start) });
    }

    while (frontier.length > 0 && visited.size < maxVisits) {
      frontier.sort((a, b) => b.similarity - a.similarity);
      const current = frontier.shift();
      if (!current || visited.has(current.key)) continue;
      if (excludeKey === current.key) continue;

      visited.add(current.key);
      best.set(current.key, current.similarity);

      const neighbors = this.graph.get(current.key);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (visited.has(neighbor) || neighbor === excludeKey) continue;
        frontier.push({ key: neighbor, similarity: this.similarityForKey(query, neighbor) });
      }
    }

    return Array.from(best.entries()).map(([key, similarity]) => ({ key, similarity }));
  }

  private linkNode(key: bigint, neighbors: bigint[]): void {
    this.ensureNode(key);
    const node = this.graph.get(key);
    if (!node) return;

    for (const neighbor of neighbors) {
      if (neighbor === key) continue;
      this.ensureNode(neighbor);
      node.add(neighbor);
      this.graph.get(neighbor)?.add(key);
      this.pruneNode(neighbor);
    }

    this.pruneNode(key);
  }

  private pruneNode(key: bigint): void {
    const neighbors = this.graph.get(key);
    const base = this.vectors.get(key);
    if (!neighbors || !base || neighbors.size <= this.connectivity) return;

    const ordered = Array.from(neighbors)
      .map((neighbor) => ({
        neighbor,
        similarity: this.similarityForEmbedding(base, neighbor),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.connectivity);

    const keep = new Set(ordered.map((item) => item.neighbor));
    for (const neighbor of Array.from(neighbors)) {
      if (!keep.has(neighbor)) {
        neighbors.delete(neighbor);
        this.graph.get(neighbor)?.delete(key);
      }
    }
  }

  private ensureNode(key: bigint): void {
    if (!this.graph.has(key)) {
      this.graph.set(key, new Set());
    }
  }

  private firstKey(): bigint | null {
    const first = this.vectors.keys().next();
    return first.done ? null : first.value;
  }

  private similarityForKey(query: number[], key: bigint): number {
    const embedding = this.vectors.get(key);
    if (!embedding || embedding.length !== query.length) return -1;
    return cosineSimilarity(query, embedding);
  }

  private similarityForEmbedding(base: number[], key: bigint): number {
    const embedding = this.vectors.get(key);
    if (!embedding || embedding.length !== base.length) return -1;
    return cosineSimilarity(base, embedding);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  close(): void {}

  dispose(): void {}

  free(): void {}
}

export function createShimUsearchModule() {
  return {
    Index: ShimIndex as unknown as new (options: Record<string, unknown>) => {
      size(): number;
      search(
        vector: Float32Array,
        count: number,
        threads?: number,
      ): { keys: ArrayLike<bigint | number>; distances: ArrayLike<number> };
      add(
        keyOrKeys: bigint | BigUint64Array,
        vectorOrVectors: Float32Array,
        threads?: number,
      ): void;
      load(path: string): void;
      save(path: string): void;
      contains(key: bigint): boolean;
      remove(key: bigint): void;
      close?(): void;
      dispose?(): void;
      free?(): void;
    },
    MetricKind: { Cos: "Cos" },
    ScalarKind: { F32: "F32" },
  };
}
