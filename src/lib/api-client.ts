import { ErrorCode } from "./api-errors";
import type { ApiResponse, ApiSuccessResponse } from "./api-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 判断响应体是否符合统一 API 契约。 */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;

  if (value.success) {
    return Object.prototype.hasOwnProperty.call(value, "data");
  }

  const error = value.error;
  return isRecord(error) && typeof error.code === "string" && typeof error.message === "string";
}

/** 前端请求失败时携带统一错误码和 HTTP 状态。 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * 调用统一 JSON API，并在边界处完成 HTTP 状态、JSON 格式和业务 success 校验。
 * 成功时仍返回完整的 { success, data }，让调用方显式读取 response.data。
 */
export async function requestApi<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiSuccessResponse<T>> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new ApiClientError(
      ErrorCode.UNKNOWN,
      error instanceof Error ? error.message : "网络请求失败",
      0,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(ErrorCode.UNKNOWN, "服务端返回了无效的 JSON 响应", response.status);
  }

  if (!isApiResponse(payload)) {
    throw new ApiClientError(ErrorCode.UNKNOWN, "服务端返回格式不符合 API 契约", response.status);
  }

  if (!payload.success) {
    throw new ApiClientError(payload.error.code, payload.error.message, response.status);
  }

  if (!response.ok) {
    throw new ApiClientError(
      ErrorCode.UNKNOWN,
      `请求失败（HTTP ${response.status}）`,
      response.status,
    );
  }

  return payload as ApiSuccessResponse<T>;
}
