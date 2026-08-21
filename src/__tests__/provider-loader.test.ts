import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import {
  clearProviderCache,
  loadProviderCatalog,
  writeProviderCatalog,
} from "../config/provider-loader";

describe("provider catalog loader", () => {
  it("rejects invalid provider catalogs before caching them", () => {
    const dir = mkdtempSync(join(tmpdir(), "providers-"));
    const filePath = join(dir, "providers.json");
    try {
      const invalid = {
        providers: {
          broken: {
            baseURL: "http://localhost:11434/v1",
            models: {
              "qwen2.5": { type: "completion" },
            },
          },
        },
      };
      writeFileSync(filePath, JSON.stringify(invalid), "utf-8");

      expect(() => loadProviderCatalog(filePath)).toThrow(/type/i);
    } finally {
      clearProviderCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a validated catalog and refreshes the loader cache", () => {
    const dir = mkdtempSync(join(tmpdir(), "providers-"));
    const filePath = join(dir, "providers.json");
    try {
      const catalog = {
        providers: {
          "local-qwen": {
            baseURL: "http://localhost:11434/v1",
            models: {
              "qwen2.5:7b": { type: "chat" as const, contextWindow: 32768 },
            },
          },
        },
      };

      writeProviderCatalog(catalog, filePath);

      expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual(catalog);
      expect(loadProviderCatalog(filePath)).toEqual(catalog);
    } finally {
      clearProviderCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
