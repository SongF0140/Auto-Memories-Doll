import { apiConfig } from "../../config/api.config";

export class StreamHandler {
  static async *stream(prompt: string, modelType: "mini" | "pro"): AsyncGenerator<string> {
    const model = modelType === "mini" ? apiConfig.miniLlmModel : apiConfig.proLlmModel;

    try {
      const response = await fetch(`${apiConfig.baseURL}/v1/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          max_tokens: 2048,
          stream: true,
        }),
        signal: AbortSignal.timeout(apiConfig.timeout),
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
              const text = json.choices?.[0]?.text || "";
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