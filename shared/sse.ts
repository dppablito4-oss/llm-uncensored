export async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  const abort = () => {
    void reader.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");
      let pos;
      while ((pos = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, pos);
        pending = pending.slice(pos + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (pending.length > 1_000_000)
        throw new Error("Evento demasiado grande");
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const encodeEvent = (data: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
