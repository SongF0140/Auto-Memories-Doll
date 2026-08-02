import fs from "node:fs";
import path from "node:path";

export type ProviderModelType = "chat" | "embedding";

export type ProviderModelEntry = {
  type: ProviderModelType;
  contextWindow?: number;
  dimensions?: number;
};

export type ProviderEntry = {
  baseURL: string;
  models: Record<string, ProviderModelEntry>;
};

export type ProviderCatalog = {
  providers: Record<string, ProviderEntry>;
};

const DEFAULT_PATH = path.join(__dirname, "providers.json");

let _cached: ProviderCatalog | null = null;

/** 加载提供商目录（首次调用后缓存） */
export function loadProviderCatalog(filePath?: string): ProviderCatalog {
  if (_cached) return _cached;
  const raw = fs.readFileSync(filePath || DEFAULT_PATH, "utf-8");
  _cached = JSON.parse(raw) as ProviderCatalog;
  return _cached;
}

/** 清除缓存（用于热更新） */
export function clearProviderCache(): void {
  _cached = null;
}

/** 根据提供商名称获取其所有模型列表 */
export function getProviderModels(providerName: string): ProviderEntry | undefined {
  const catalog = loadProviderCatalog();
  return catalog.providers[providerName];
}

/** 查找指定类型的第一个模型名（chat 或 embedding） */
export function findModelByType(
  providerName: string,
  type: ProviderModelType,
): string | undefined {
  const provider = getProviderModels(providerName);
  if (!provider) return undefined;
  for (const [name, entry] of Object.entries(provider.models)) {
    if (entry.type === type) return name;
  }
  return undefined;
}
