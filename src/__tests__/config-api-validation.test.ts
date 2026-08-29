import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAiConfig, POST as updateAiConfig } from "../app/api/config/ai/route";
import {
  PATCH as previewStorageMigration,
  POST as updateStorageConfig,
} from "../app/api/config/storage/route";
import { POST as createToolSource } from "../app/api/config/tool-sources/route";
import { PUT as updateToolSource } from "../app/api/config/tool-sources/[id]/route";

function jsonRequest(url: string, method: "POST" | "PATCH" | "PUT", body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("configuration API request validation", () => {
  it("exposes the provider catalog with AI config responses", async () => {
    const response = await getAiConfig();
    const body = await response.json();

    // providers.json 已置空（不预设用户环境不存在的模型），目录必须是对象结构且可自由扩展
    expect(body.providerCatalog).toHaveProperty("providers");
    expect(body.providerCatalog.providers).toEqual({});
  });

  it("accepts provider IDs declared in providers.json without code changes", async () => {
    const response = await updateAiConfig(
      jsonRequest("http://localhost/api/config/ai", "POST", {
        provider: "custom-proxy",
        baseURL: "http://localhost:11434/v1",
        apiKey: "local-key",
        flagship: {
          model: "qwen2.5:7b",
          maxTokens: 4096,
          temperature: 0.3,
          timeout: 30000,
          maxRetries: 1,
        },
        standard: {
          model: "qwen2.5:7b",
          maxTokens: 4096,
          temperature: 0.7,
          timeout: 30000,
          maxRetries: 1,
        },
        budget: {
          model: "qwen2.5:7b",
          maxTokens: 2048,
          temperature: 0.6,
          timeout: 15000,
          maxRetries: 0,
        },
        embedding: {
          model: "text-embedding-3-small",
          dimensions: 1536,
          maxConcurrency: 8,
          queueTimeoutMs: 60000,
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects a string copyExisting value before storage migration", async () => {
    const response = await updateStorageConfig(
      jsonRequest("http://localhost/api/config/storage", "POST", {
        notesPath: "memory-root-new",
        copyExisting: "false",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-string storage preview path", async () => {
    const response = await previewStorageMigration(
      jsonRequest("http://localhost/api/config/storage", "PATCH", { notesPath: 123 }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects invalid tool source primitive types before persistence", async () => {
    const response = await createToolSource(
      jsonRequest("http://localhost/api/config/tool-sources", "POST", {
        name: "Codex",
        toolType: "codex",
        path: "C:/sessions",
        enabled: "false",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects stale tool source update field names", async () => {
    const response = await updateToolSource(
      jsonRequest("http://localhost/api/config/tool-sources/source-1", "PUT", {
        dirPath: "C:/sessions",
      }),
      { params: { id: "source-1" } },
    );

    expect(response.status).toBe(400);
  });
});
