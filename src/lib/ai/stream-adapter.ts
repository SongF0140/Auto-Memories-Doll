import { AiEvent } from "./ai-events";

/**
 * 将 AiEvent 流转换为浏览器可直接消费的 SSE 文本流
 * 格式：data: <type>:<json>\n\n
 */
export function aiEventStreamToResponse(stream: ReadableStream<AiEvent>): Response {
  const encoder = new TextEncoder();

  const transformed = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const line = formatAiEvent(value);
          controller.enqueue(encoder.encode(line));
        }
      } catch (error) {
        const errLine = formatAiEvent({
          type: "error",
          message: (error as Error).message || "Stream error",
        });
        controller.enqueue(encoder.encode(errLine));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(transformed, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function formatAiEvent(event: AiEvent): string {
  const json = JSON.stringify(event);
  return `data: ${json}\n\n`;
}
