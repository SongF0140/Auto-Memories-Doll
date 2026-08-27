import { NextRequest, NextResponse } from "next/server";
import { ErrorCode } from "./lib/api-errors";
import { apiError } from "./lib/api-response";

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function hostnameFromHostHeader(hostHeader: string): string | null {
  const value = hostHeader.trim();
  if (!value || /[/?#@]/.test(value)) return null;

  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function isLoopbackRequest(request: NextRequest): boolean {
  const hostHeader = request.headers.get("host");
  const hostname = hostHeader === null ? normalizeHostname(request.nextUrl.hostname) : hostnameFromHostHeader(hostHeader);
  return hostname !== null && LOOPBACK_HOSTNAMES.has(hostname);
}

export function middleware(request: NextRequest) {
  if (!isLoopbackRequest(request)) {
    return NextResponse.json(apiError(ErrorCode.VALIDATION_FAILED, "仅允许通过本机地址访问 API"), { status: 403 });
  }

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
