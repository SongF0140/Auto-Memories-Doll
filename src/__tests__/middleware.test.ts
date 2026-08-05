import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function createRequest(method: string, contentLength?: string): NextRequest {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }
  return new NextRequest("http://localhost/api/memory", { method, headers });
}

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
