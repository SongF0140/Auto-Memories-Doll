import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// env 固化对象 mock：持久配置的 env 默认来源（第八块契约）。
// MEMORY_ROOT 透传 process.env——setup.ts 已先于测试模块设置临时目录。
vi.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    MODEL_API_KEY: "env-secret-key-42",
    MODEL_BASE_URL: "https://relay.example.com/v1",
    MEMORY_ROOT: process.env.MEMORY_ROOT || "./memory-root",
    PORT: 3000,
    RERANK_MODEL: "Xenova/bge-reranker-base",
    RERANK_HF_ENDPOINT: "https://hf-mirror.com",
    RERANK_DISABLED: false,
  },
}));

import { getDatabase } from "../lib/storage/database";
import { ConfigService } from "../server/services/config-service";
import { GET, POST } from "../app/api/config/ai/route";
import { POST as testPOST } from "../app/api/config/ai/test/route";

const tier = (model: string) => ({
  model,
  maxTokens: 4096,
  temperature: 0.7,
  timeout: 30000,
  maxRetries: 2,
});

const baseConfig = {
  provider: "openai-compatible",
  baseURL: "https://relay.example.com/v1",
  apiKey: "real-key-abcd1234",
  flagship: tier("flagship-model"),
  standard: tier("standard-model"),
  budget: tier("budget-model"),
  embedding: {
    model: "embedding-model",
    dimensions: 1536,
    maxConcurrency: 8,
    queueTimeoutMs: 30000,
    apiKey: "",
    baseURL: "",
  },
};

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function storedConfig(): ReturnType<ConfigService["getAiConfig"]> {
  const service = new ConfigService();
  try {
    return service.getAiConfig();
  } finally {
    service.close();
  }
}

describe("AI 中转站配置闭环", () => {
  beforeEach(() => {
    // ConfigService.init() 负责 建 config 表 → seed 默认配置；先触发建表再清空，
    // 使每个用例从"无持久配置、由 env seed"的干净状态开始
    new ConfigService().close();
    getDatabase().prepare("DELETE FROM config WHERE key = 'ai'").run();
  });

  it("首次 seed 默认配置来自 env（持久配置优先于 env 的前提）", () => {
    const config = storedConfig()!;
    expect(config.baseURL).toBe("https://relay.example.com/v1");
    expect(config.apiKey).toBe("env-secret-key-42");
  });

  it("任意模型名不强制命中模型目录（保存即生效）", async () => {
    const res = await POST(
      jsonRequest("/api/config/ai", { ...baseConfig, standard: tier("my-relay/custom-model-v9") }),
    );
    expect(res.status).toBe(200);
    expect(storedConfig()!.standard.model).toBe("my-relay/custom-model-v9");
  });

  it("apiKeyIntent=clear 清除共享 Key（此前 schema 拒绝空 Key 无法清除）", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    const res = await POST(
      jsonRequest("/api/config/ai", { ...baseConfig, apiKey: "", apiKeyIntent: "clear" }),
    );
    expect(res.status).toBe(200);
    const stored = storedConfig()!;
    expect(stored.apiKey).toBe("");
    // intent 是保存指令，不属于持久配置，不能入库
    expect("apiKeyIntent" in (stored as unknown as Record<string, unknown>)).toBe(false);
  });

  it("apiKeyIntent=keep 忽略前端传值保留库存 Key", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    const res = await POST(
      jsonRequest("/api/config/ai", {
        ...baseConfig,
        apiKey: "wrong-typed-value",
        apiKeyIntent: "keep",
      }),
    );
    expect(res.status).toBe(200);
    expect(storedConfig()!.apiKey).toBe("real-key-abcd1234");
  });

  it("apiKeyIntent=replace 传空 Key 被拒绝", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    const res = await POST(
      jsonRequest("/api/config/ai", { ...baseConfig, apiKey: "", apiKeyIntent: "replace" }),
    );
    expect(res.status).toBe(400);
  });

  it("未提供 intent 时保持掩码回填兼容（不把掩码当真实 Key）", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    const res = await POST(jsonRequest("/api/config/ai", { ...baseConfig, apiKey: "****1234" }));
    expect(res.status).toBe(200);
    expect(storedConfig()!.apiKey).toBe("real-key-abcd1234");
  });

  it("掩码与库存不匹配（Key 已轮换）→ 400 拒绝，不把掩码当真实 Key 入库", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    const res = await POST(jsonRequest("/api/config/ai", { ...baseConfig, apiKey: "****9999" }));
    expect(res.status).toBe(400);
    expect(storedConfig()!.apiKey).toBe("real-key-abcd1234");
  });

  it("GET 脱敏共享与 embedding Key，响应不包含完整真实 Key", async () => {
    await POST(
      jsonRequest("/api/config/ai", {
        ...baseConfig,
        embedding: { ...baseConfig.embedding, apiKey: "emb-key-9876zz" },
      }),
    );
    const res = await GET();
    const text = await res.text();
    expect(text).toContain("****1234");
    expect(text).toContain("****76zz");
    expect(text).not.toContain("real-key-abcd1234");
    expect(text).not.toContain("emb-key-9876zz");
  });

  it("GET 对过短 Key 整体隐藏，掩码不泄露尾4位", async () => {
    await POST(jsonRequest("/api/config/ai", baseConfig));
    await POST(
      jsonRequest("/api/config/ai", {
        ...baseConfig,
        apiKey: "real-key-abcd1234",
        embedding: { ...baseConfig.embedding, apiKey: "abcd" },
      }),
    );
    const body = JSON.parse(await (await GET()).text());
    expect(body.apiKey).toBe("****1234");
    expect(body.embedding.apiKey).toBe("****");
  });

  it("embeddingApiKeyIntent=clear 独立清除 embedding Key，不影响共享 Key", async () => {
    await POST(
      jsonRequest("/api/config/ai", {
        ...baseConfig,
        embedding: { ...baseConfig.embedding, apiKey: "emb-key-9876zz" },
      }),
    );
    const res = await POST(
      jsonRequest("/api/config/ai", {
        ...baseConfig,
        embedding: { ...baseConfig.embedding, apiKey: "" },
        embeddingApiKeyIntent: "clear",
      }),
    );
    expect(res.status).toBe(200);
    const stored = storedConfig()!;
    expect(stored.embedding.apiKey).toBe("");
    expect(stored.apiKey).toBe("real-key-abcd1234");
  });

  it("连接测试对 401 返回明确错误文案而非裸 HTTP 状态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), {
          status: 401,
        }),
      ),
    );
    try {
      const res = await testPOST(
        jsonRequest("/api/config/ai/test", {
          baseURL: "https://relay.example.com/v1",
          apiKey: "bad-key",
          model: "chat-model",
          embedding: { model: "embedding-model", apiKey: "bad-key" },
        }),
      );
      const body = await res.json();
      expect(body.llm.success).toBe(false);
      expect(body.llm.message).toBe("Incorrect API key");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("连接测试请求断言实际 URL、model 与 Authorization Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ model: "chat-model" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await testPOST(
        jsonRequest("/api/config/ai/test", {
          baseURL: "https://relay.example.com/v1/",
          apiKey: "the-relay-key",
          model: "relay-chat-model",
          embedding: { model: "relay-embedding-model", apiKey: "the-relay-key" },
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://relay.example.com/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer the-relay-key" }),
          body: JSON.stringify({
            model: "relay-chat-model",
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 5,
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
