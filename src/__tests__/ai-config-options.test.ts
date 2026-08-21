import { describe, expect, it } from "vitest";
import {
  buildProviderOptions,
  buildProviderSelectionPatch,
} from "../components/settings/ai-config-options";
import type { AiConfig } from "../types/config";

const baseConfig: AiConfig = {
  provider: "openai-compatible",
  baseURL: "https://api.example.com/v1",
  apiKey: "test-key",
  flagship: { model: "", maxTokens: 8192, temperature: 0.3, timeout: 60000, maxRetries: 3 },
  standard: { model: "", maxTokens: 4096, temperature: 0.7, timeout: 30000, maxRetries: 2 },
  budget: { model: "", maxTokens: 2048, temperature: 0.6, timeout: 15000, maxRetries: 1 },
  embedding: { model: "", dimensions: 1536, maxConcurrency: 8, queueTimeoutMs: 60000 },
};

const catalog = {
  providers: {
    "local-qwen": {
      baseURL: "http://localhost:11434/v1",
      models: {
        "qwen2.5:7b": { type: "chat" as const, contextWindow: 32768 },
      },
    },
    openai: {
      baseURL: "https://api.openai.com/v1",
      models: {
        "gpt-4o-mini": { type: "chat" as const, contextWindow: 128000 },
        "text-embedding-3-small": { type: "embedding" as const, dimensions: 1536 },
      },
    },
  },
};

describe("AI config provider catalog options", () => {
  it("builds provider choices from the declarative catalog", () => {
    const options = buildProviderOptions(catalog);

    expect(options.map((option) => option.value)).toContain("local-qwen");
    expect(options.find((option) => option.value === "local-qwen")?.label).toBe("Local Qwen");
  });

  it("keeps the current provider visible even when it is not in the catalog", () => {
    const options = buildProviderOptions(catalog, "private-gateway");

    expect(options.map((option) => option.value)).toContain("private-gateway");
  });

  it("applies catalog defaults when selecting a declared provider", () => {
    const patch = buildProviderSelectionPatch(baseConfig, "local-qwen", catalog);

    expect(patch.baseURL).toBe("http://localhost:11434/v1");
    expect(patch.flagship.model).toBe("qwen2.5:7b");
    expect(patch.standard.model).toBe("qwen2.5:7b");
    expect(patch.budget.model).toBe("qwen2.5:7b");
  });

  it("applies embedding dimensions from the catalog when available", () => {
    const patch = buildProviderSelectionPatch(baseConfig, "openai", catalog);

    expect(patch.embedding.model).toBe("text-embedding-3-small");
    expect(patch.embedding.dimensions).toBe(1536);
  });
});
