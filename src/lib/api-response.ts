import { ErrorCode } from "./api-errors";

/** 成功响应：data 始终存在，便于前端按统一契约读取。 */
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

/** 失败响应：error 始终存在，避免各页面自行猜测错误字段位置。 */
export type ApiErrorResponse = {
  success: false;
  error: { code: ErrorCode; message: string };
};

/** 统一 API 响应包装。 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** 构造成功响应 */
export function apiResponse<T>(data: T): ApiSuccessResponse<T> {
  return { success: true, data };
}

/** 构造错误响应 */
export function apiError(code: ErrorCode, message: string): ApiErrorResponse {
  return { success: false, error: { code, message } };
}
