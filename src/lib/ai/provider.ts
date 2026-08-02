import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { LanguageModel } from "ai";
import { ConfigService } from "../../server/services/config-service";
import { AiConfig } from "../../types/config";
import { AiServiceError } from "../errors";
import { apiConfig } from "../../config/api.config";
import type { ModelType } from "./model-adapter";

function getConfig(): AiConfig {
  const service = new ConfigService();
  try {
    return service.getAiConfig() || service.getDefaultAiConfig();
  } finally {
    service.close();
  }
}

export function createLanguageModel(modelType?: ModelType): LanguageModel {
  const config = getConfig();
  const modelName = modelType === "mini" ? apiConfig.miniLlmModel
    : modelType === "pro" ? apiConfig.proLlmModel
    : config.chatModel;

  if (config.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    return anthropic(modelName);
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return openai(modelName);
}

export function createEmbeddingModel() {
  const config = getConfig();

  if (config.provider === "anthropic") {
    throw new AiServiceError(
      "Anthropic provider does not support embeddings. Please use an OpenAI-compatible embedding model.",
    );
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return openai.embedding(config.embeddingModel);
}
