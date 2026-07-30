import { describe, it, expect } from "vitest";
import { ErrorCode } from "../lib/api-errors";
import { apiResponse, apiError } from "../lib/api-response";

describe("api-response", () => {
  it("constructs success response", () => {
    const resp = apiResponse({ id: "abc" });
    expect(resp.success).toBe(true);
    expect(resp.data).toEqual({ id: "abc" });
    expect(resp.error).toBeUndefined();
  });

  it("constructs error response", () => {
    const resp = apiError(ErrorCode.NOT_FOUND, "资源不存在");
    expect(resp.success).toBe(false);
    expect(resp.error?.code).toBe("NOT_FOUND");
    expect(resp.error?.message).toBe("资源不存在");
  });
});

describe("ErrorCode", () => {
  it("has unique values for all codes", () => {
    const values = Object.values(ErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
