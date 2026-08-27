import { requestApi } from "./api-client";
import type { MemoryListResponse, MemorySearchResponse } from "../types/api";
import type { MemoryRecord } from "../types/memory";

type MemoryErrorPayload = {
  error?: string | { message?: string };
};

export function memoryDetailHref(memoryId: string): string {
  return `/memory/${encodeURIComponent(memoryId)}`;
}

export function memoryTopicHref(topic: string): string {
  return `/memory/topic/${encodeURIComponent(topic)}`;
}

export async function listMemoriesClient(
  pageSize = 100,
  page = 1,
  topic?: string,
): Promise<MemoryListResponse> {
  const safePageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
  const safePage = Math.max(1, Math.trunc(page));
  const params = new URLSearchParams();
  if (safePage > 1) params.set("page", String(safePage));
  params.set("pageSize", String(safePageSize));
  if (topic?.trim()) params.set("topic", topic.trim());

  const response = await requestApi<MemoryListResponse>(`/api/memory?${params.toString()}`);
  return response.data;
}

export async function searchMemoriesClient(
  query: string,
  limit = 10,
): Promise<MemorySearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("搜索内容不能为空");
  }

  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const response = await requestApi<MemorySearchResponse>(
    `/api/memory/search?q=${encodeURIComponent(trimmedQuery)}&limit=${safeLimit}`,
  );
  return response.data;
}

export async function getMemoryClient(
  memoryId: string,
  signal?: AbortSignal,
): Promise<MemoryRecord> {
  const response = await fetch(`/api${memoryDetailHref(memoryId)}`, { signal });
  const payload = (await response.json()) as MemoryRecord | MemoryErrorPayload;

  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined;
    const message =
      typeof error === "string" ? error : error?.message || `记忆加载失败 (${response.status})`;
    throw new Error(message);
  }

  return payload as MemoryRecord;
}

export async function recordMemoryAccessClient(memoryId: string): Promise<void> {
  const response = await fetch(`/api${memoryDetailHref(memoryId)}/access`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`访问记录写入失败 (${response.status})`);
  }
}
