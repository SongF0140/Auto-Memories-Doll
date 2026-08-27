import type { ProviderCatalog } from "../../config/provider-loader";
import type { AiConfig, AiProvider, EmbeddingConfig, ModelTierConfig } from "../../types/config";

type ChatSlot = "flagship" | "standard" | "budget";

export type ProviderOption = {
  value: AiProvider;
  label: string;
};

export type ProviderSelectionPatch = {
  provider: AiProvider;
  baseURL: string;
  flagship: ModelTierConfig;
  standard: ModelTierConfig;
  budget: ModelTierConfig;
  embedding: EmbeddingConfig;
};

const legacyProviders: ProviderOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom" },
];

function titleCaseProvider(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildProviderOptions(
  catalog: ProviderCatalog | undefined,
  currentProvider?: AiProvider,
): ProviderOption[] {
  const options = new Map<string, ProviderOption>();
  for (const option of legacyProviders) {
    options.set(option.value, option);
  }

  for (const providerId of Object.keys(catalog?.providers || {})) {
    options.set(providerId, {
      value: providerId,
      label: titleCaseProvider(providerId),
    });
  }

  if (currentProvider && !options.has(currentProvider)) {
    options.set(currentProvider, {
      value: currentProvider,
      label: titleCaseProvider(currentProvider),
    });
  }

  return [...options.values()];
}

export function buildProviderSelectionPatch(
  config: AiConfig,
  provider: AiProvider,
  catalog: ProviderCatalog | undefined,
): ProviderSelectionPatch {
  const providerEntry = catalog?.providers[provider];
  if (!providerEntry) {
    return { ...config, provider };
  }

  const chatModels = Object.entries(providerEntry.models)
    .filter(([, model]) => model.type === "chat")
    .map(([name]) => name);
  const embeddingModel = Object.entries(providerEntry.models).find(
    ([, model]) => model.type === "embedding",
  );
  const firstChatModel = chatModels[0];
  const firstEmbeddingModel = embeddingModel?.[0];
  const embeddingDimensions = embeddingModel?.[1].dimensions;

  const patchTier = (slot: ChatSlot): ModelTierConfig => ({
    ...config[slot],
    model: config[slot].model || firstChatModel || "",
  });

  return {
    provider,
    baseURL: providerEntry.baseURL,
    flagship: patchTier("flagship"),
    standard: patchTier("standard"),
    budget: patchTier("budget"),
    embedding: {
      ...config.embedding,
      model: config.embedding.model || firstEmbeddingModel || config.embedding.model,
      dimensions: embeddingDimensions || config.embedding.dimensions,
    },
  };
}
