import { ConfigService } from "../../server/services/config-service";

export class StreamHandler {
  private static getConfig() {
    const service = new ConfigService();
    try {
      return service.getAiConfig() || service.getDefaultAiConfig();
    } finally {
      service.close();
    }
  }

  static async *stream(prompt: string, _modelType: "mini" | "pro"): AsyncGenerator<string> {
    const config = this.getConfig();

    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.chatModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: true,
        }),
        signal: AbortSignal.timeout(config.timeout),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield "当前无法建立流式连接，请稍后再试。";
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6);
            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
              if (text) yield text;
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }
    } catch (error) {
      console.error("Stream API call failed:", error);
      yield "当前处于降级模式，无法生成流式回复。";
    }
  }
}
