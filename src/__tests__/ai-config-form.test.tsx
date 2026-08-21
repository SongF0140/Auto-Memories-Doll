import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiConfigForm from "../components/settings/AiConfigForm";
import type { AiConfig } from "../types/config";

const config: AiConfig = {
  provider: "openai-compatible",
  baseURL: "https://api.example.com/v1",
  apiKey: "test-key",
  flagship: { model: "", maxTokens: 8192, temperature: 0.3, timeout: 60000, maxRetries: 3 },
  standard: { model: "", maxTokens: 4096, temperature: 0.7, timeout: 30000, maxRetries: 2 },
  budget: { model: "", maxTokens: 2048, temperature: 0.6, timeout: 15000, maxRetries: 1 },
  embedding: { model: "", dimensions: 1536, maxConcurrency: 8, queueTimeoutMs: 60000 },
};

const providerCatalog = {
  providers: {
    "local-qwen": {
      baseURL: "http://localhost:11434/v1",
      models: {
        "qwen2.5:7b": { type: "chat" as const, contextWindow: 32768 },
      },
    },
  },
};

describe("AiConfigForm", () => {
  it("renders provider catalog options from settings data", () => {
    const html = renderToStaticMarkup(
      <AiConfigForm config={config} providerCatalog={providerCatalog} onSave={() => undefined} />,
    );

    expect(html).toContain("local-qwen");
    expect(html).toContain("Local Qwen");
  });
});
