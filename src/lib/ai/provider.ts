import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { LanguageModel } from "ai";
import { ConfigService } from "../../server/services/config-service";
import { AiConfig, ModelTierConfig } from "../../types/config";
import { AiServiceError } from "../errors";
import type { ModelType } from "./model-adapter";

function getConfig(): AiConfig {
  const service = new ConfigService();
  try {
    return service.getAiConfig() || service.getDefaultAiConfig();
  } finally {
    service.close();
  }
}

function getTier(config: AiConfig, modelType?: ModelType): ModelTierConfig {
  const slot = modelType || "standard";
  return config[slot];
}

export function createLanguageModel(modelType?: ModelType): LanguageModel {
  const config = getConfig();
  const tier = getTier(config, modelType);

  if (config.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    return anthropic(tier.model);
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return openai.chat(tier.model);
}

export function createEmbeddingModel() {
  const config = getConfig();

  const embeddingApiKey = config.embedding.apiKey || config.apiKey;
  const embeddingBaseURL = config.embedding.baseURL || config.baseURL;

  // Anthropic 无 embedding API；但若 embedding 配了专属端点则放行走该端点
  if (config.provider === "anthropic" && !config.embedding.baseURL) {
    throw new AiServiceError(
      "Anthropic provider does not support embeddings. Please use an OpenAI-compatible embedding model.",
    );
  }

  const openai = createOpenAI({
    apiKey: embeddingApiKey,
    baseURL: embeddingBaseURL,
  });
  return openai.embedding(config.embedding.model);
}
