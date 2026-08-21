import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelAdapter } from "../lib/ai/model-adapter";
import { AiEvent } from "../lib/ai/ai-events";

const aiMock = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

const providerMock = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
  generateStream: vi.fn(),
}));

const configMock = vi.hoisted(() => ({
  config: {
    provider: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    flagship: { model: "gpt-4o", maxTokens: 8192, temperature: 0.3, timeout: 60000, maxRetries: 3 },
    standard: {
      model: "gpt-4o-mini",
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 30000,
      maxRetries: 2,
    },
    budget: {
      model: "gpt-4o-mini",
      maxTokens: 2048,
      temperature: 0.6,
      timeout: 15000,
      maxRetries: 1,
    },
    embedding: {
      model: "text-embedding-3-small",
      dimensions: 1536,
      maxConcurrency: 8,
      queueTimeoutMs: 60000,
    },
  },
}));

vi.mock("ai", () => ({
  embed: vi.fn(),
  generateText: aiMock.generateText,
}));

vi.mock("../lib/ai/openai-provider", () => ({
  OpenAIProvider: vi.fn(() => providerMock),
}));

vi.mock("../server/services/config-service", () => ({
  ConfigService: vi.fn(() => ({
    getAiConfig: vi.fn(() => configMock.config),
    getDefaultAiConfig: vi.fn(() => configMock.config),
    close: vi.fn(),
  })),
}));

async function drain(stream: ReadableStream<AiEvent>): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
  }
  return events;
}

describe("ModelAdapter degradation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    configMock.config.apiKey = "";
    ModelAdapter.stopHealthCheck();
    const adapterState = ModelAdapter as unknown as {
      isDegraded?: boolean;
      llmDegraded?: boolean;
      embeddingDegraded?: boolean;
      apiKeyConfiguredCache?: unknown;
    };
    adapterState.isDegraded = false;
    adapterState.llmDegraded = false;
    adapterState.embeddingDegraded = false;
    adapterState.apiKeyConfiguredCache = null;
  });

  it("returns a fallback AiEvent stream when API key is missing", async () => {
    expect(ModelAdapter.isDegradedMode).toBe(true);

    const stream = ModelAdapter.generateStream({
      messages: [{ role: "user", content: "hello" }],
      modelType: "standard",
    });

    const events = await drain(stream);

    expect(events.map((event) => event.type)).toEqual([
      "text_start",
      "text_delta",
      "text_end",
      "done",
    ]);
    expect(events.find((event) => event.type === "text_delta")).toMatchObject({
      type: "text_delta",
      content: expect.stringContaining("API Key"),
    });
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "error" });
  });

  it("returns an empty embedding instead of throwing when API key is missing", async () => {
    const result = await ModelAdapter.generateEmbedding("query");

    expect(result.embedding).toEqual([]);
    expect(result.model).toBe("text-embedding-3-small");
  });

  it("keeps LLM degradation after a later embedding success", async () => {
    configMock.config.apiKey = "test-key";
    aiMock.generateText.mockRejectedValueOnce(new Error("llm down"));
    providerMock.generateEmbedding.mockResolvedValueOnce([0.1, 0.2]);

    const llmResult = await ModelAdapter.generate("remember this", "standard");
    expect(llmResult.finishReason).toBe("degraded");
    expect(ModelAdapter.isDegradedMode).toBe(true);

    const embeddingResult = await ModelAdapter.generateEmbedding("query");

    expect(embeddingResult.embedding).toEqual([0.1, 0.2]);
    expect(ModelAdapter.isDegradedMode).toBe(true);
  });

  it("keeps degraded mode when health check embedding succeeds but LLM probe fails", async () => {
    vi.useFakeTimers();
    configMock.config.apiKey = "test-key";
    aiMock.generateText
      .mockRejectedValueOnce(new Error("initial llm down"))
      .mockRejectedValueOnce(new Error("llm still down"));
    providerMock.generateEmbedding.mockResolvedValue([0.1, 0.2]);

    await ModelAdapter.generate("remember this", "standard");
    expect(ModelAdapter.isDegradedMode).toBe(true);

    ModelAdapter.startHealthCheck();
    await vi.advanceTimersByTimeAsync(30000);

    expect(providerMock.generateEmbedding).toHaveBeenCalledWith("health-check");
    expect(aiMock.generateText).toHaveBeenCalledTimes(2);
    expect(ModelAdapter.isDegradedMode).toBe(true);
  });
});
