import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function createRequest(
  method: string,
  contentLength?: string,
  url = "http://localhost/api/memory",
  extraHeaders?: Record<string, string>,
): NextRequest {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new NextRequest(url, { method, headers });
}

describe("middleware — 本机 Host 安全边界", () => {
  it.each([
    ["localhost", "http://localhost/api/health"],
    ["IPv4 loopback", "http://127.0.0.1/api/health"],
    ["IPv6 loopback", "http://[::1]/api/health"],
    ["带端口的 loopback", "http://localhost:3000/api/health"],
  ])("放行 %s 请求", (_name, url) => {
    const res = middleware(createRequest("GET", undefined, url));
    expect(res.status).toBe(200);
  });

  it("拒绝非本机 Host，并返回统一错误结构", async () => {
    const req = createRequest("GET", undefined, "http://localhost/api/health", { host: "example.com:3000" });
    const res = middleware(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "仅允许通过本机地址访问 API",
      },
    });
  });

  it("不因外部 Origin 阻止本机工具的 POST 请求", () => {
    const req = createRequest("POST", undefined, "http://localhost/api/listen", {
      origin: "https://example.com",
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});

describe("middleware — 请求体大小限制", () => {
  it("放行 POST 请求（body 在 5MB 以内）", async () => {
    const req = createRequest("POST", "1048576"); // 1 MB
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("拒绝 POST 请求（body 超过 5MB）", async () => {
    const req = createRequest("POST", "6291456"); // 6 MB
    const res = middleware(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("5 MB");
  });

  it("拒绝 PUT 请求（body 超过 5MB）", async () => {
    const req = createRequest("PUT", "10485761"); // 约 10 MB
    const res = middleware(req);
    expect(res.status).toBe(413);
  });

  it("拒绝 PATCH 请求（body 超过 5MB）", async () => {
    const req = createRequest("PATCH", "10000000"); // 约 9.5 MB
    const res = middleware(req);
    expect(res.status).toBe(413);
  });

  it("放行 GET 请求（无 content-length 也放行）", async () => {
    const req = createRequest("GET");
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("放行 DELETE 请求", async () => {
    const req = createRequest("DELETE");
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("放行 POST 请求（无 content-length，chunked 传输）", async () => {
    const req = createRequest("POST"); // 无 content-length
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("放行 content-length 正好等于 5MB", async () => {
    const req = createRequest("POST", String(5 * 1024 * 1024)); // 5 MB 精确
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("拒绝无效的 content-length 值（非数字）", async () => {
    const req = createRequest("POST", "abc");
    const res = middleware(req);
    // NaN → 触发 isNaN → 按超大处理
    expect(res.status).toBe(413);
  });
});
