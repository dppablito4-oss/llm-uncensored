import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { requestSchema } from "./schema.ts";
import {
  buildContext,
  tokenBound,
  rankMemories,
} from "../../../shared/context.ts";
import { encodeEvent } from "../../../shared/sse.ts";
import { envelopeAnswer, parseEnvelope } from "../../../shared/envelope.ts";
import { providerEvents } from "../../../shared/provider.ts";
import { findModel, modelReasoning } from "../../../shared/models.ts";
import {
  contextCost,
  planSummary,
  summaryNeeded,
  validateSummary,
  summaryFailureNotice,
  type ConversationSummary,
  type HistoryTurn,
} from "../../../shared/summary.ts";

const messages: Record<string, string> = {
  RATE_LIMIT: "Demasiadas solicitudes. Espera un minuto.",
  DAILY_LIMIT: "Alcanzaste tu límite diario de solicitudes.",
  TOKEN_LIMIT:
    "Tu cuota diaria no alcanza para este contexto y la respuesta solicitada. Puedes reducir los tokens de respuesta o esperar al reinicio a las 00:00 UTC. Revisa el consumo en Configuración.",
  MODEL_NOT_ALLOWED: "Este modelo no está autorizado.",
  MODEL_UNAVAILABLE:
    "El modelo no está disponible en NanoGPT. Selecciona otro modelo autorizado.",
  PROVIDER_BALANCE: "El proveedor no tiene saldo disponible.",
  PROVIDER_RATE_LIMIT:
    "NanoGPT está limitando las solicitudes. Intenta más tarde.",
  DUPLICATE_REQUEST: "La solicitud ya fue procesada. Actualiza el historial.",
  GENERATION_RUNNING: "Esta conversación ya tiene una generación activa.",
  NOT_FOUND: "Conversación no encontrada.",
  PROVIDER_REQUEST:
    "El proveedor rechazó el modelo o sus parámetros. Revisa su disponibilidad y los ajustes.",
  CONTEXT_LIMIT:
    "El mensaje y las instrucciones superan el presupuesto de contexto. Reduce el texto o amplía el presupuesto en ajustes.",
  OUTPUT_LIMIT:
    "La respuesta alcanzó su longitud máxima y se guardó como parcial. Puedes aumentar los tokens de respuesta en el preset activo o en Configuración y regenerarla. Esto no significa que se haya agotado tu cuota diaria.",
};
export async function handler(
  req: Request,
  env: (name: string) => string | undefined,
): Promise<Response> {
  const required = (name: string) => {
    const value = env(name);
    if (!value) throw new Error("Missing backend configuration: " + name);
    return value;
  };
  const origins = (env("FORMA_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    origin = req.headers.get("origin");
  const cors = {
    "Access-Control-Allow-Origin":
      origin && origins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const json = (error: string, status: number, code?: string) =>
    Response.json(
      { error, ...(code ? { code } : {}) },
      { status, headers: cors },
    );
  let requestId: string | undefined;
  const log = (phase: string, code: string, eventId?: string) =>
    console.error(
      JSON.stringify({
        function: "chat-stream",
        phase,
        code,
        request_id: requestId,
        event_id: eventId,
      }),
    );
  if (!origin || !origins.includes(origin))
    return json("Origen no autorizado", 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json("Método no permitido", 405);
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      return json("Inicia sesión", 401);
    const db = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_ANON_KEY"),
      {
        db: { schema: "forma" },
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    // Network verification against Auth; do not decode JWTs locally or trust browser claims.
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(authorization.slice(7));
    if (authError || !user) return json("Sesión inválida o caducada", 401);
    // Bound body before parsing rather than relying solely on Content-Length.
    const body = req.body?.getReader();
    if (!body) return json("Falta solicitud", 400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await body.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 64000) {
        await body.cancel();
        return json("Solicitud demasiado grande", 413);
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    let payload;
    try {
      payload = requestSchema.safeParse(
        JSON.parse(new TextDecoder().decode(joined)),
      );
    } catch {
      return json("JSON no válido", 400);
    }
    if (!payload.success) return json("Solicitud no válida", 400);
    const input = payload.data;
    requestId = input.request_id;
    const admin = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { db: { schema: "forma" }, auth: { persistSession: false } },
    );
    const [{ data: profile }, { data: allowed }, { data: conv }] =
      await Promise.all([
        db.from("profiles").select("*").eq("id", user.id).single(),
        admin
          .from("models")
          .select("id")
          .eq("id", input.model_id)
          .eq("enabled", true)
          .maybeSingle(),
        db
          .from("conversations")
          .select("id")
          .eq("id", input.conversation_id)
          .maybeSingle(),
      ]);
    if (!conv) return json("Conversación no encontrada", 404);
    if (!allowed) return json(messages.MODEL_NOT_ALLOWED, 400);
    if (!profile) return json("Perfil no disponible", 409);
    const { data: preset, error: presetError } = input.preset_id
      ? await db.from("presets").select("*").eq("id", input.preset_id).single()
      : { data: null, error: null };
    if (presetError) return json("Preset no encontrado", 404);
    const model = findModel(input.model_id);
    if (!model) return json(messages.MODEL_NOT_ALLOWED, 400);
    const maxTokens = Math.min(
      preset?.max_tokens ?? profile.max_tokens,
      model.max_output_tokens ?? 8192,
      8192,
    );
    const contextBudget = Math.min(
        profile.context_tokens,
        24000,
        (model.context_length ?? 24000) - maxTokens,
      ),
      memoryBudget = Math.min(profile.memory_tokens, 4000);
    const key = required("LLM_UNC_API_KEY");
    const { data: event, error: reserveError } = await admin.rpc(
      "begin_generation",
      {
        p_uid: user.id,
        p_cid: input.conversation_id,
        p_request: input.request_id,
        p_content: input.content,
        p_model: input.model_id,
        p_preset: input.preset_id,
        p_action: input.action,
        p_target: input.target_id ?? null,
        // Reserve output first; prepare_generation adds the actual context
        // under the same quota lock before any provider call can happen.
        p_reserve: maxTokens,
      },
    );
    if (reserveError) {
      const code = Object.keys(messages).find((k) =>
        reserveError.message.includes(k),
      );
      return json(
        code ? messages[code] : "No se pudo iniciar la conversación",
        code === "RATE_LIMIT" ||
          code === "TOKEN_LIMIT" ||
          code === "DAILY_LIMIT"
          ? 429
          : 409,
        code,
      );
    }
    const controller = new AbortController();
    let disconnected = false;
    const abort = () => {
      disconnected = true;
      controller.abort();
    };
    req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let full = "",
      inputTokens = 0,
      outputTokens = 0,
      cost: number | null = null,
      status = "partial",
      errorCode: string | null = null,
      providerStarted = false,
      inputReported = false,
      outputReported = false;
    const compact = {
      started: false,
      input: 0,
      output: 0,
      inputReported: true,
      outputReported: true,
      cost: null as number | null,
      reserve: 0,
    };
    let rawOutput = "";
    const stream = new ReadableStream<Uint8Array>({
      async start(sink) {
        const send = (data: unknown) => {
          if (!disconnected) {
            try {
              sink.enqueue(encodeEvent(data));
            } catch {
              abort();
            }
          }
        };
        send({
          type: "accepted",
          conversation_id: input.conversation_id,
          request_id: input.request_id,
        });
        try {
          const { data: history, error: historyError } = await db
            .from("messages")
            .select("role,content,status,seq")
            .eq("conversation_id", input.conversation_id)
            .order("seq", { ascending: false })
            .limit(60);
          if (historyError) throw new Error("HISTORY_ERROR");
          const { data: memories, error: memoryError } =
            profile.memory_enabled && (preset?.memory_enabled ?? true)
              ? await db
                  .from("memories")
                  .select("content")
                  .eq("enabled", true)
                  .order("updated_at", { ascending: false })
                  .limit(100)
              : { data: [], error: null };
          if (memoryError) throw new Error("MEMORY_ERROR");
          const recent: HistoryTurn[] = (history || [])
            .reverse()
            .filter((m) => m.status === "complete");
          const system =
            "You are a helpful assistant. Be honest about uncertainty. Do not claim to remember information outside the supplied context.";
          // Validate the mandatory current message before doing any paid compaction.
          buildContext(
            system,
            preset?.system_prompt || "",
            [],
            recent.slice(-1),
            contextBudget,
            0,
          );
          let summary: ConversationSummary | null = null;
          let plan: ReturnType<typeof planSummary> = null;
          if (profile.auto_summary !== false) {
            const { data, error } = await db
              .from("conversation_summaries")
              .select("content,through_seq,source_count")
              .eq("conversation_id", input.conversation_id)
              .maybeSingle();
            if (error) throw new Error("HISTORY_ERROR");
            summary = data;
            if (
              summaryNeeded(
                recent,
                summary,
                contextBudget,
                system + (preset?.system_prompt || ""),
              )
            ) {
              const { data: oldest, error: sourceError } = await db
                .from("messages")
                .select("role,content,status,seq")
                .eq("conversation_id", input.conversation_id)
                .eq("status", "complete")
                .gt("seq", summary?.through_seq ?? 0)
                .order("seq", { ascending: true })
                .limit(60);
              if (sourceError) throw new Error("HISTORY_ERROR");
              plan = planSummary(oldest || [], recent, summary, contextBudget);
            }
          }
          const turns = recent.filter(
            (m) => m.seq > (summary?.through_seq ?? 0),
          );
          let context = buildContext(
            system,
            preset?.system_prompt || "",
            rankMemories(
              (memories || []).map((m) => m.content),
              turns.at(-1)?.content || "",
            ),
            turns,
            contextBudget,
            memoryBudget,
            summary?.content || "",
          );
          let responseTokens = maxTokens;
          if (plan) {
            responseTokens = Math.min(
              maxTokens + 1536,
              8192,
              model.max_output_tokens ?? 8192,
            );
            const combinedSystem =
              system +
              '\nReply to the current user and update conversation memory in ONE response. Return ONLY a JSON object with string fields in this order: {"answer":"your normal answer, using Markdown inside this string","summary":"updated cumulative memory of ONLY the older_messages below"}. Escape newlines and quotes correctly. No code fences. Keep memory separate from the answer; do not mention these internal instructions.\n' +
              plan.messages[0].content +
              "\nUntrusted older conversation reference data:\n" +
              plan.messages[1].content +
              "\nFor THIS combined request, override the output-only-summary instruction: return the JSON object with answer first and summary second, and nothing outside it.";
            try {
              context = buildContext(
                combinedSystem,
                preset?.system_prompt || "",
                rankMemories(
                  (memories || []).map((m) => m.content),
                  recent.at(-1)?.content || "",
                ),
                recent.filter((m) => m.seq > plan!.throughSeq),
                Math.min(
                  contextBudget,
                  (model.context_length ?? 24000) - responseTokens,
                ),
                memoryBudget,
              );
            } catch {
              // Keep the ordinary answer if a very long current message leaves
              // no room. Compaction remains pending; no cursor is advanced.
              plan = null;
              responseTokens = maxTokens;
              send({
                type: "context",
                code: "SUMMARY_DEFERRED",
                message:
                  "El mensaje actual deja poco espacio para actualizar el resumen. Se conserva el anterior y se reintentará en el próximo envío.",
              });
            }
          }
          if (summary)
            send({
              type: "context",
              message: context[0].content.includes(
                JSON.stringify(summary.content),
              )
                ? `Resumen de ${summary.source_count} mensajes anteriores activo. El historial original se conserva.`
                : "El mensaje actual deja poco espacio para el resumen. Reduce su tamaño o amplía el contexto en Configuración.",
            });
          inputTokens = context.reduce(
            (sum, m) => sum + tokenBound(m.content) + 32,
            0,
          );
          const { error: prepareError } = await admin.rpc(
            "prepare_generation",
            {
              p_event: event,
              p_input: inputTokens,
              p_max_output: responseTokens,
              p_spent: 0,
            },
          );
          if (prepareError)
            throw new Error(
              prepareError.message.includes("TOKEN_LIMIT")
                ? "TOKEN_LIMIT"
                : "RESERVATION_ERROR",
            );
          controller.signal.throwIfAborted();
          providerStarted = true;
          send({
            type: "status",
            message: plan ? "Respondiendo y actualizando memoria" : "Pensando",
          });
          const response = await fetch(
            "https://nano-gpt.com/api/v1/chat/completions",
            {
              method: "POST",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: input.model_id,
                messages: context,
                stream: true,
                stream_options: { include_usage: true },
                max_tokens: responseTokens,
                temperature: preset?.temperature ?? profile.temperature,
                top_p: preset?.top_p ?? profile.top_p,
                ...(modelReasoning(
                  input.model_id,
                  preset?.reasoning_effort ?? profile.reasoning_effort,
                )
                  ? {
                      reasoning_effort: modelReasoning(
                        input.model_id,
                        preset?.reasoning_effort ?? profile.reasoning_effort,
                      ),
                    }
                  : {}),
              }),
            },
          );
          try {
            for await (const item of providerEvents(
              response,
              controller.signal,
            )) {
              if (item.text) {
                rawOutput += item.text;
                if (rawOutput.length > 120000) throw new Error("OUTPUT_LIMIT");
                if (plan) {
                  const answer = envelopeAnswer(rawOutput);
                  const delta = answer.slice(full.length);
                  full = answer;
                  if (delta) send({ type: "delta", text: delta });
                } else {
                  full += item.text;
                  send({ type: "delta", text: item.text });
                }
              }
              if (item.usage) {
                if (
                  Number.isInteger(item.usage.prompt_tokens) &&
                  item.usage.prompt_tokens! >= 0
                ) {
                  inputTokens = item.usage.prompt_tokens!;
                  inputReported = true;
                }
                if (
                  Number.isInteger(item.usage.completion_tokens) &&
                  item.usage.completion_tokens! >= 0
                ) {
                  outputTokens = item.usage.completion_tokens!;
                  outputReported = true;
                }
                if (Number.isFinite(item.usage.cost))
                  cost = Math.max(0, item.usage.cost!);
              }
              if (item.done) status = "complete";
            }
          } catch (error) {
            if (
              plan &&
              error instanceof Error &&
              error.message === "OUTPUT_LIMIT" &&
              envelopeAnswer(rawOutput, true).trim()
            ) {
              // The visible answer finished; only memory was truncated.
              status = "complete";
            } else throw error;
          }
          if (plan && status === "complete") {
            let candidate = "";
            try {
              candidate = validateSummary(parseEnvelope(rawOutput).summary);
            } catch {
              /* Retry only memory below. */
            }
            let lastError: unknown = new Error("SUMMARY_EMPTY");
            // One normal combined call; at most two explicit recovery calls.
            for (let attempt = 0; !candidate && attempt < 2; attempt++) {
              try {
                controller.signal.throwIfAborted();
                send({
                  type: "status",
                  message: `Actualizando resumen · reintento ${attempt + 1}/2`,
                });
                const retryInput = contextCost(plan.messages),
                  retryOutput = Math.min(2048, model.max_output_tokens ?? 8192);
                const spent =
                  (inputReported && outputReported
                    ? inputTokens + outputTokens
                    : contextCost(context) + responseTokens) + compact.reserve;
                const { error: reserveError } = await admin.rpc(
                  "prepare_generation",
                  {
                    p_event: event,
                    p_input: retryInput,
                    p_max_output: retryOutput,
                    p_spent: spent,
                  },
                );
                if (reserveError)
                  throw new Error(
                    reserveError.message.includes("TOKEN_LIMIT")
                      ? "SUMMARY_QUOTA"
                      : "SUMMARY_RESERVATION",
                  );
                compact.started = true;
                compact.reserve += retryInput + retryOutput;
                let retryText = "",
                  usedInput = retryInput,
                  usedOutput = 0,
                  reportedInput = false,
                  reportedOutput = false;
                try {
                  const retrySignal = AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(25000),
                  ]);
                  const retryResponse = await fetch(
                    "https://nano-gpt.com/api/v1/chat/completions",
                    {
                      method: "POST",
                      signal: retrySignal,
                      headers: {
                        Authorization: `Bearer ${key}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        model: input.model_id,
                        messages: plan.messages,
                        stream: true,
                        stream_options: { include_usage: true },
                        max_tokens: retryOutput,
                        temperature: 0.2,
                        ...(modelReasoning(input.model_id, "low")
                          ? {
                              reasoning_effort: modelReasoning(
                                input.model_id,
                                "low",
                              ),
                            }
                          : {}),
                      }),
                    },
                  );
                  for await (const item of providerEvents(
                    retryResponse,
                    retrySignal,
                  )) {
                    if (item.text) {
                      retryText += item.text;
                      if (tokenBound(retryText) > 6000)
                        throw new Error("SUMMARY_SIZE");
                    }
                    if (item.usage) {
                      if (
                        Number.isInteger(item.usage.prompt_tokens) &&
                        item.usage.prompt_tokens! >= 0
                      ) {
                        usedInput = item.usage.prompt_tokens!;
                        reportedInput = true;
                      }
                      if (
                        Number.isInteger(item.usage.completion_tokens) &&
                        item.usage.completion_tokens! >= 0
                      ) {
                        usedOutput = item.usage.completion_tokens!;
                        reportedOutput = true;
                      }
                      if (Number.isFinite(item.usage.cost))
                        compact.cost =
                          (compact.cost ?? 0) + Math.max(0, item.usage.cost!);
                    }
                  }
                  candidate = validateSummary(retryText);
                } finally {
                  compact.input += usedInput;
                  compact.output += reportedOutput
                    ? usedOutput
                    : tokenBound(retryText);
                  compact.inputReported &&= reportedInput;
                  compact.outputReported &&= reportedOutput;
                }
              } catch (error) {
                lastError = error;
                if (controller.signal.aborted) throw error;
              }
            }
            if (candidate) {
              // Retry a failed database write without repeating inference.
              let saved = false;
              for (let attempt = 0; attempt < 2 && !saved; attempt++) {
                const { error: saveError } = await admin.rpc(
                  "save_conversation_summary",
                  {
                    p_event: event,
                    p_previous_seq: summary?.through_seq ?? 0,
                    p_through_seq: plan.throughSeq,
                    p_content: candidate,
                    p_source_count: plan.sourceCount,
                  },
                );
                saved = !saveError;
              }
              if (saved)
                send({
                  type: "context",
                  message: `Resumen acumulativo actualizado · ${plan.sourceCount} mensajes. Los originales se conservan.`,
                });
              else lastError = new Error("SUMMARY_SAVE");
              if (!saved) {
                const failure = summaryFailureNotice(lastError);
                log("summary", failure.code, event);
                send({ type: "context", ...failure });
              }
            } else {
              const failure = summaryFailureNotice(lastError);
              log("summary", failure.code, event);
              send({ type: "context", ...failure });
            }
            if (!full.trim()) throw new Error("EMPTY_STREAM");
          }
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const safeCodes = [
            "PROVIDER_RATE_LIMIT",
            "PROVIDER_BALANCE",
            "MODEL_UNAVAILABLE",
            "PROVIDER_ERROR",
            "PROVIDER_REQUEST",
            "PROVIDER_STREAM_ERROR",
            "EMPTY_STREAM",
            "INCOMPLETE_STREAM",
            "OUTPUT_LIMIT",
            "HISTORY_ERROR",
            "MEMORY_ERROR",
            "TOKEN_LIMIT",
            "RESERVATION_ERROR",
          ];
          errorCode = controller.signal.aborted
            ? "CANCELLED"
            : safeCodes.includes(code)
              ? code
              : code.includes("presupuesto") || code.includes("Contexto")
                ? "CONTEXT_LIMIT"
                : "UNEXPECTED_ERROR";
          status = full ? "partial" : "error";
          log("generation", errorCode, event);
        } finally {
          clearTimeout(timeout);
          req.signal.removeEventListener("abort", abort);
          if (!providerStarted) inputTokens = 0;
          if (!outputReported) outputTokens = tokenBound(rawOutput);
          const { error: persistError } = await admin.rpc("finish_generation", {
            p_event: event,
            p_content: full,
            p_status: status,
            p_input: inputTokens + (compact.started ? compact.input : 0),
            p_output: outputTokens + compact.output,
            p_cost:
              cost === null && compact.cost === null
                ? null
                : (cost ?? 0) + (compact.cost ?? 0),
            p_error: errorCode,
            p_usage_reported:
              (providerStarted || compact.started) &&
              (!providerStarted || (inputReported && outputReported)) &&
              (!compact.started ||
                (compact.inputReported && compact.outputReported)),
            p_provider_started: providerStarted || compact.started,
          });
          if (persistError) {
            log("persistence", "FINALIZE_FAILED", event);
            send({
              type: "error",
              code: "PERSISTENCE_ERROR",
              message:
                "No se pudo confirmar el guardado. Actualiza el historial antes de reenviar.",
            });
          } else if (errorCode)
            send({
              type: "error",
              code: errorCode,
              message:
                (errorCode === "OUTPUT_LIMIT" && !full
                  ? "El modelo agotó los tokens de salida antes de producir una respuesta visible. Reduce el razonamiento o aumenta los tokens de respuesta en el preset activo o en Configuración y regenera. Tu cuota diaria no está necesariamente agotada."
                  : messages[errorCode]) ||
                "Generación interrumpida. La respuesta disponible se guardó como parcial.",
            });
          else send({ type: "done", status });
          try {
            sink.close();
          } catch {
            /* closed client */
          }
        }
      },
      cancel() {
        abort();
      },
    });
    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    log("handler", "UNEXPECTED_ERROR");
    return json(
      "Error de configuración del servidor. Revisa los secretos de Supabase.",
      500,
    );
  }
}
