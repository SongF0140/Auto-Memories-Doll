import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { LanguageModel } from "ai";
import { ConfigService } from "../../server/services/config-service";
import { AiConfig } from "../../types/config";

function getConfig(): AiConfig {
  const service = new ConfigService();
  try {
    return service.getAiConfig() || service.getDefaultAiConfig();
  } finally {
    service.close();
  }
}

export function createLanguageModel(): LanguageModel {
  const config = getConfig();

  if (config.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    return anthropic(config.chatModel);
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return openai(config.chatModel);
}

export function createEmbeddingModel() {
  const config = getConfig();

  if (config.provider === "anthropic") {
    throw new Error("Anthropic provider does not support embeddings. Please use an OpenAI-compatible embedding model.");
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return openai.embedding(config.embeddingModel);
}
