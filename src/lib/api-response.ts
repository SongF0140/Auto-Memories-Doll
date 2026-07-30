import { ErrorCode } from "./api-errors";

/** 统一 API 响应包装 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
}

/** 构造成功响应 */
export function apiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

/** 构造错误响应 */
export function apiError(code: ErrorCode, message: string): ApiResponse<never> {
  return { success: false, error: { code, message } };
}
