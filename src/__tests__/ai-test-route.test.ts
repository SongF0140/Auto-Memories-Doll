import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/config/ai/test/route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/config/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/config/ai/test", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns independent chat and embedding connection results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: "chat-model" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "embedding-model",
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        baseURL: "https://chat.example.com/v1",
        apiKey: "chat-key",
        model: "chat-model",
        embedding: {
          baseURL: "https://embedding.example.com/v1",
          apiKey: "embedding-key",
          model: "embedding-model",
        },
      }),
    );
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.llm).toMatchObject({ success: true, model: "chat-model" });
    expect(body.embedding).toMatchObject({
      success: true,
      model: "embedding-model",
      dimensions: 3,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://embedding.example.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "embedding-model", input: "health-check" }),
      }),
    );
  });

  it("keeps embedding failure visible when chat succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ model: "chat-model" }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: "embedding model not found" } }), {
            status: 404,
          }),
        ),
    );

    const response = await POST(
      jsonRequest({
        baseURL: "https://api.example.com/v1",
        apiKey: "shared-key",
        model: "chat-model",
        embedding: { model: "missing-embedding-model" },
      }),
    );
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.llm).toMatchObject({ success: true });
    expect(body.embedding).toMatchObject({
      success: false,
      message: "embedding model not found",
    });
  });
});
