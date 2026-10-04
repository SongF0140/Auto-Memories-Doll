import { AiEvent, terminalStatus } from "./ai-events";

export function wrapAiStream(
  source: () => ReadableStream<AiEvent> | Promise<ReadableStream<AiEvent>>,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: AiEvent) => void;
    onFinalize?: (cancelled: boolean) => void;
  } = {},
): ReadableStream<AiEvent> {
  let reader: ReadableStreamDefaultReader<AiEvent> | undefined;
  let cancelled = false;
  let terminal = false;
  let cancelReason: unknown;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    options.signal?.removeEventListener("abort", abort);
    reader?.releaseLock();
    options.onFinalize?.(cancelled);
  };
  const abort = () => {
    cancelReason = options.signal?.reason;
    void reader?.cancel(cancelReason).catch(() => undefined);
  };
  return new ReadableStream<AiEvent>({
    async start(controller) {
      const emit = (event: AiEvent) => {
        if (cancelled || terminal) return;
        options.onEvent?.(event);
        controller.enqueue(event);
        terminal = terminalStatus(event) !== undefined;
      };
      try {
        if (options.signal?.aborted) {
          emit({ type: "done", finishReason: "abort", status: "aborted" });
        } else {
          options.signal?.addEventListener("abort", abort, { once: true });
          const stream = await source();
          reader = stream.getReader();
          if (cancelled || options.signal?.aborted)
            await reader.cancel(cancelReason || options.signal?.reason);
          while (!cancelled && !options.signal?.aborted) {
            const { done, value } = await reader.read();
            if (done || cancelled || options.signal?.aborted) break;
            emit(value);
            if (terminal) {
              await reader.cancel("terminal received");
              break;
            }
          }
          if (!cancelled && !terminal) {
            emit(
              options.signal?.aborted
                ? { type: "done", finishReason: "abort", status: "aborted" }
                : {
                    type: "error",
                    message: "Stream ended without a terminal event",
                    status: "failed",
                  },
            );
          }
        }
      } catch (error) {
        emit(
          options.signal?.aborted
            ? { type: "done", finishReason: "abort", status: "aborted" }
            : {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
                status: "failed",
              },
        );
      } finally {
        finalize();
        if (!cancelled) controller.close();
      }
    },
    async cancel(reason) {
      if (terminal || finalized) {
        // 终态已观察：这是下游清理取消，不得改判为用户中止。
        cancelReason = reason;
        if (reader) await reader.cancel(reason).catch(() => undefined);
        return;
      }
      cancelled = true;
      cancelReason = reason;
      if (reader) {
        try {
          await reader.cancel(reason);
        } finally {
          finalize();
        }
      }
    },
  });
}

export function aiEventStreamToResponse(
  stream: ReadableStream<AiEvent>,
  contentType = "text/plain; charset=utf-8",
): Response {
  const encoder = new TextEncoder();
  const reader = wrapAiStream(() => stream).getReader();
  let cancelled = false;
  const transformed = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        }
      } finally {
        reader.releaseLock();
        if (!cancelled) controller.close();
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason);
    },
  });
  return new Response(transformed, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
