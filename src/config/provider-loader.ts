import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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
const providerModelEntrySchema = z.object({
  type: z.enum(["chat", "embedding"]),
  contextWindow: z.number().int().positive().optional(),
  dimensions: z.number().int().positive().optional(),
});

export const providerCatalogSchema = z.object({
  providers: z.record(
    z.string().min(1),
    z.object({
      baseURL: z.string().url(),
      models: z.record(z.string().min(1), providerModelEntrySchema),
    }),
  ),
});

let _cached: ProviderCatalog | null = null;

/** 加载提供商目录（首次调用后缓存） */
export function loadProviderCatalog(filePath?: string): ProviderCatalog {
  if (_cached) return _cached;
  const raw = fs.readFileSync(filePath || DEFAULT_PATH, "utf-8");
  _cached = providerCatalogSchema.parse(JSON.parse(raw));
  return _cached;
}

/** 清除缓存（用于热更新） */
export function clearProviderCache(): void {
  _cached = null;
}

/** 写入提供商目录并刷新缓存 */
export function writeProviderCatalog(catalog: ProviderCatalog, filePath?: string): void {
  const parsed = providerCatalogSchema.parse(catalog);
  const target = filePath || DEFAULT_PATH;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  _cached = parsed;
}

/** 根据提供商名称获取其所有模型列表 */
export function getProviderModels(providerName: string): ProviderEntry | undefined {
  const catalog = loadProviderCatalog();
  return catalog.providers[providerName];
}

/** 查找指定类型的第一个模型名（chat 或 embedding） */
export function findModelByType(providerName: string, type: ProviderModelType): string | undefined {
  const provider = getProviderModels(providerName);
  if (!provider) return undefined;
  for (const [name, entry] of Object.entries(provider.models)) {
    if (entry.type === type) return name;
  }
  return undefined;
}
