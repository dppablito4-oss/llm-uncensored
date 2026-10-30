import { sseData } from "./sse.ts";
export type ProviderDelta = {
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  done?: boolean;
};
export async function* providerEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<ProviderDelta> {
  if (!response.ok)
    throw new Error(
      response.status === 400
        ? "PROVIDER_REQUEST"
        : response.status === 429
          ? "PROVIDER_RATE_LIMIT"
          : response.status === 404
            ? "MODEL_UNAVAILABLE"
            : response.status === 402
              ? "PROVIDER_BALANCE"
              : "PROVIDER_ERROR",
    );
  if (!response.body) throw new Error("EMPTY_STREAM");
  let done = false;
  for await (const raw of sseData(response.body, signal)) {
    if (raw === "[DONE]") {
      done = true;
      yield { done: true };
      break;
    }
    const event = JSON.parse(raw);
    if (event.error) throw new Error("PROVIDER_STREAM_ERROR");
    if (event.usage) yield { usage: event.usage };
    const choice = event.choices?.[0];
    if (choice?.delta?.content) yield { text: choice.delta.content };
    if (choice?.finish_reason === "error")
      throw new Error("PROVIDER_STREAM_ERROR");
    if (choice?.finish_reason === "length") throw new Error("OUTPUT_LIMIT");
  }
  if (!done) throw new Error("INCOMPLETE_STREAM");
}
