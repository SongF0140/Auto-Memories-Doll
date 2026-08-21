import { dirname } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { cosineSimilarity } from "./similarity";

type ShimIndexState = {
  dimensions: number;
  vectors: Array<[string, number[]]>;
};

function toVectorArray(vector: Float32Array): number[] {
  return Array.from(vector, (value) => Number(value));
}

function toKeyArray(keys: bigint | BigUint64Array): bigint[] {
  return typeof keys === "bigint" ? [keys] : Array.from(keys, (key) => BigInt(key));
}

class ShimIndex {
  private vectors = new Map<bigint, number[]>();
  private dimensions: number;

  constructor(options: Record<string, unknown>) {
    this.dimensions = Number(options.dimensions || 0);
  }

  size(): number {
    return this.vectors.size;
  }

  search(vector: Float32Array, count: number): {
    keys: ArrayLike<bigint | number>;
    distances: ArrayLike<number>;
  } {
    const query = toVectorArray(vector);
    const matches = Array.from(this.vectors.entries())
      .map(([key, embedding]) => ({
        key,
        distance: 1 - cosineSimilarity(query, embedding),
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
    const dimensions = this.dimensions || (keys.length > 0 ? Math.floor(values.length / keys.length) : 0);

    if (keys.length === 1) {
      this.vectors.set(keys[0], values.slice());
      this.dimensions = dimensions || values.length;
      return;
    }

    for (let i = 0; i < keys.length; i++) {
      const start = i * dimensions;
      const end = start + dimensions;
      this.vectors.set(keys[i], values.slice(start, end));
    }
    this.dimensions = dimensions;
  }

  load(path: string): void {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ShimIndexState;
    this.dimensions = raw.dimensions;
    this.vectors = new Map(
      raw.vectors.map(([key, embedding]) => [BigInt(key), embedding]),
    );
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
    this.vectors.delete(key);
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
      add(keyOrKeys: bigint | BigUint64Array, vectorOrVectors: Float32Array, threads?: number): void;
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
