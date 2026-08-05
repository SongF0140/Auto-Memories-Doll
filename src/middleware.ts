import { NextRequest, NextResponse } from "next/server";

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB

export function middleware(request: NextRequest) {
  const method = request.method;

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (isNaN(size) || size > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: `请求体过大，最大允许 ${MAX_BODY_SIZE / 1024 / 1024} MB` },
          { status: 413 },
        );
      }
    } else {
      // 无 Content-Length 头 → Transfer-Encoding: chunked
      // App Router 的 request.json() 在前 5 MB 时会正常返回，
      // 超过 5 MB 时流会被截断 → 由各路由的 try/catch 兜底
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
