import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { requestSchema } from "./schema.ts";
import {
  buildContext,
  tokenBound,
  rankMemories,
} from "../../../shared/context.ts";
import { encodeEvent } from "../../../shared/sse.ts";
import { providerEvents } from "../../../shared/provider.ts";
import { findModel } from "../../../shared/models.ts";

const messages: Record<string, string> = {
  RATE_LIMIT: "Demasiadas solicitudes. Espera un minuto.",
  DAILY_LIMIT: "Alcanzaste tu límite diario de solicitudes.",
  TOKEN_LIMIT: "No queda suficiente presupuesto diario de tokens.",
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
    "La respuesta alcanzó el límite de tokens; se guardó como parcial.",
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
  const json = (error: string, status: number) =>
    Response.json({ error }, { status, headers: cors });
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
        p_reserve: contextBudget + maxTokens,
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
      errorCode: string | null = null;
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
          const turns = (history || [])
            .reverse()
            .filter((m) => m.status === "complete")
            .map((m) => ({ role: m.role, content: m.content }));
          const context = buildContext(
            "You are a helpful assistant. Be honest about uncertainty. Do not claim to remember information outside the supplied context.",
            preset?.system_prompt || "",
            rankMemories(
              (memories || []).map((m) => m.content),
              turns.at(-1)?.content || "",
            ),
            turns,
            contextBudget,
            memoryBudget,
          );
          inputTokens = context.reduce(
            (sum, m) => sum + tokenBound(m.content) + 32,
            0,
          );
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
                max_tokens: maxTokens,
                temperature: preset?.temperature ?? profile.temperature,
                top_p: preset?.top_p ?? profile.top_p,
              }),
            },
          );
          for await (const item of providerEvents(
            response,
            controller.signal,
          )) {
            if (item.text) {
              full += item.text;
              if (full.length > 100000) throw new Error("OUTPUT_LIMIT");
              send({ type: "delta", text: item.text });
            }
            if (item.usage) {
              if (Number.isFinite(item.usage.prompt_tokens))
                inputTokens = Math.max(0, item.usage.prompt_tokens!);
              if (Number.isFinite(item.usage.completion_tokens))
                outputTokens = Math.max(0, item.usage.completion_tokens!);
              if (Number.isFinite(item.usage.cost))
                cost = Math.max(0, item.usage.cost!);
            }
            if (item.done) status = "complete";
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
          ];
          errorCode = controller.signal.aborted
            ? "CANCELLED"
            : safeCodes.includes(code)
              ? code
              : code.includes("presupuesto") || code.includes("Contexto")
                ? "CONTEXT_LIMIT"
                : "UNEXPECTED_ERROR";
          status = full ? "partial" : "error";
        } finally {
          clearTimeout(timeout);
          req.signal.removeEventListener("abort", abort);
          if (!outputTokens) outputTokens = tokenBound(full);
          const { error: persistError } = await admin.rpc("finish_generation", {
            p_event: event,
            p_content: full,
            p_status: status,
            p_input: inputTokens,
            p_output: outputTokens,
            p_cost: cost,
            p_error: errorCode,
          });
          if (persistError) {
            send({
              type: "error",
              message:
                "No se pudo confirmar el guardado. Actualiza el historial antes de reenviar.",
            });
          } else if (errorCode)
            send({
              type: "error",
              message:
                messages[errorCode] ||
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
    return json(
      "Error de configuración del servidor. Revisa los secretos de Supabase.",
      500,
    );
  }
}
