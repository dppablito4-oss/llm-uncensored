import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { handler } from "../supabase/functions/chat-stream/handler";
import { defaultModel } from "../shared/models";
import type { ConversationSummary, HistoryTurn } from "../shared/summary";
const uid = "11111111-1111-4111-8111-111111111111",
  cid = "22222222-2222-4222-8222-222222222222",
  eid = "33333333-3333-4333-8333-333333333333";
const env = (name: string) =>
  ({
    SUPABASE_URL: "https://backend.test",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "PRIVATE_SERVICE_SECRET",
    LLM_UNC_API_KEY: "PRIVATE_NANOGPT_SECRET",
    FORMA_ALLOWED_ORIGINS: "https://allowed.test",
  })[name];
let providerStatus = 200,
  authenticated = true,
  owner = true,
  finish: Record<string, unknown> | undefined,
  providerBody: Record<string, unknown> | undefined,
  reserveCount = 0,
  prepareFails = false,
  contextTooLarge = false;
let chatHistory: HistoryTurn[] | undefined,
  savedSummary: ConversationSummary | null = null,
  autoSummary = true,
  summaryFailure = "",
  summaryCalls = 0,
  summarySaves = 0;
let summaryText =
  "El usuario prepara una tienda. Prefiere respuestas breves. Falta decidir el presupuesto.";
let summaryBody: Record<string, unknown> | undefined;
let preparations: Record<string, number>[] = [];
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function req(payload: unknown = {}, headers: Record<string, string> = {}) {
  return new Request("https://backend.test/functions/v1/chat-stream", {
    method: "POST",
    headers: {
      origin: "https://allowed.test",
      authorization: "Bearer user-jwt",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}
const input = () => ({
  conversation_id: cid,
  request_id: crypto.randomUUID(),
  content: "hola",
  model_id: defaultModel,
});
beforeEach(() => {
  providerStatus = 200;
  authenticated = true;
  owner = true;
  finish = undefined;
  providerBody = undefined;
  reserveCount = 0;
  prepareFails = false;
  contextTooLarge = false;
  chatHistory = undefined;
  savedSummary = null;
  autoSummary = true;
  summaryFailure = "";
  summaryCalls = summarySaves = 0;
  preparations = [];
  summaryText =
    "El usuario prepara una tienda. Prefiere respuestas breves. Falta decidir el presupuesto.";
  summaryBody = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user"))
        return authenticated
          ? json({ id: uid, email: "a@example.com" })
          : json({ message: "invalid jwt" }, 401);
      if (u.includes("/rest/v1/profiles"))
        return json({
          id: uid,
          memory_enabled: true,
          max_tokens: 1000,
          context_tokens: 12000,
          memory_tokens: 1000,
          temperature: 0.7,
          top_p: 1,
          auto_summary: autoSummary,
        });
      if (u.includes("/rest/v1/models")) return json({ id: defaultModel });
      if (u.includes("/rest/v1/conversations"))
        return json(owner ? { id: cid } : null);
      if (u.includes("/rest/v1/memories"))
        return json([{ content: "User likes concise answers" }]);
      if (u.includes("/rest/v1/conversation_summaries"))
        return json(savedSummary);
      if (u.includes("/rest/v1/messages") && chatHistory) {
        const params = new URL(u).searchParams;
        expect(params.get("conversation_id")).toBe("eq." + cid);
        const after = Number(params.get("seq")?.replace("gt.", "") || 0);
        const filtered = chatHistory.filter((m) => m.seq > after);
        return json(
          (params.get("order")?.includes("desc")
            ? filtered.reverse()
            : filtered
          ).slice(0, 60),
        );
      }
      if (u.includes("/rest/v1/messages"))
        return json([
          {
            role: "user",
            content: contextTooLarge ? "x".repeat(12000) : "hola",
            status: "complete",
            seq: 1,
          },
        ]);
      if (u.includes("/rpc/begin_generation")) {
        reserveCount++;
        return json(eid);
      }
      if (u.includes("/rpc/finish_generation")) {
        finish = JSON.parse(String(init?.body));
        return json(null);
      }
      if (u.includes("/rpc/save_conversation_summary")) {
        summarySaves++;
        if (summaryFailure === "save")
          return json({ message: "private DB error" }, 400);
        const body = JSON.parse(String(init?.body));
        savedSummary = {
          content: body.p_content,
          through_seq: body.p_through_seq,
          source_count: body.p_source_count,
        };
        return json(null);
      }
      if (u.includes("/rpc/prepare_generation")) {
        const body = JSON.parse(String(init?.body));
        preparations.push(body);
        return prepareFails ||
          (summaryFailure === "quota" && body.p_spent === 13000) ||
          (summaryFailure === "answer-quota" && summaryCalls > 0)
          ? json({ message: "TOKEN_LIMIT" }, 400)
          : json(null);
      }
      if (u === "https://nano-gpt.com/api/v1/chat/completions") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer PRIVATE_NANOGPT_SECRET",
        );
        providerBody = JSON.parse(String(init?.body));
        const body = providerBody as { messages: { content: string }[] };
        if (body.messages[0].content.startsWith("Maintain a concise")) {
          summaryCalls++;
          summaryBody = providerBody;
          if (summaryFailure === "rate")
            return json({ error: "private provider error" }, 429);
          if (summaryFailure === "timeout") throw new Error("SUMMARY_TIMEOUT");
          return new Response(
            `data: ${JSON.stringify({ choices: [{ delta: { content: summaryText } }] })}\n\n` +
              (summaryFailure === "usage"
                ? ""
                : 'data: {"usage":{"prompt_tokens":20,"completion_tokens":3,"cost":0.002}}\n\n') +
              (summaryFailure === "length"
                ? 'data: {"choices":[{"finish_reason":"length"}]}\n\n'
                : "") +
              "data: [DONE]\n\n",
          );
        }
        if (providerStatus !== 200)
          return json(
            { error: { message: "PRIVATE_NANOGPT_SECRET provider debug" } },
            providerStatus,
          );
        return new Response(
          'data: {"choices":[{"delta":{"content":"respuesta"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.001}}\n\ndata: [DONE]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      throw new Error("Unexpected URL " + u);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Edge handler con proveedor simulado y SDK Supabase real", () => {
  const longHistory = () =>
    Array.from({ length: 13 }, (_, i) => ({
      seq: i + 1,
      role: i % 2 ? "assistant" : "user",
      status: "complete",
      content: `mensaje ${i} ` + "x".repeat(1200),
    }));
  it("resume antes de perder contexto, persiste y reutiliza sin otra llamada", async () => {
    chatHistory = longHistory();
    const first = await (await handler(req(input()), env)).text();
    expect(first).toContain('"type":"done"');
    expect(first).toContain("Resumiendo");
    expect(summaryCalls).toBe(1);
    expect(summarySaves).toBe(1);
    expect(savedSummary).toMatchObject({ through_seq: 8, source_count: 8 });
    expect(JSON.stringify(providerBody)).toContain("prepara una tienda");
    expect(JSON.stringify(providerBody)).toContain("mensaje 12");
    expect(JSON.stringify(providerBody)).not.toContain("mensaje 0 ");
    expect(finish).toMatchObject({
      p_input: 30,
      p_output: 5,
      p_cost: 0.003,
      p_usage_reported: true,
      p_provider_started: true,
    });
    expect(preparations[0].p_spent).toBe(13000);
    expect(preparations[1].p_spent).toBe(23);
    expect(chatHistory).toHaveLength(13);
    await (await handler(req(input()), env)).text();
    expect(summaryCalls).toBe(1);
    expect(finish?.p_input).toBe(10);
  });
  it.each(["length", "save"])(
    "un resumen fallido (%s) conserva el cursor y permite responder",
    async (failure) => {
      chatHistory = longHistory();
      summaryFailure = failure;
      const text = await (await handler(req(input()), env)).text();
      expect(text).toContain('"type":"done"');
      expect(text).toContain("No se pudo actualizar el resumen");
      expect(text).not.toContain("private DB error");
      expect(savedSummary).toBeNull();
      expect(summaryCalls).toBe(1);
      expect(finish).toMatchObject({
        p_input: 30,
        p_output: 5,
        p_usage_reported: true,
      });
    },
  );
  it("actualiza un resumen de 129 mensajes aunque supere el objetivo blando", async () => {
    chatHistory = Array.from({ length: 143 }, (_, i) => ({
      seq: i + 1,
      role: i % 2 ? "assistant" : "user",
      status: "complete",
      content: "dato ".repeat(240),
    }));
    savedSummary = {
      content: "Resumen anterior",
      through_seq: 129,
      source_count: 129,
    };
    summaryText = "Preferencias y decisiones confirmadas. ".repeat(90);
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain('"type":"done"');
    expect(text).not.toContain("No se pudo actualizar");
    expect(summaryCalls).toBe(1);
    expect(summarySaves).toBe(1);
    expect(savedSummary!.source_count).toBeGreaterThan(129);
    expect(savedSummary!.content).toBe(summaryText.trim());
    expect(summaryBody!.max_tokens).toBe(4096);
  });
  it.each([
    ["rate", "PROVIDER_RATE_LIMIT", "NanoGPT está limitando"],
    ["timeout", "SUMMARY_TIMEOUT", "tardó demasiado"],
    ["save", "SUMMARY_SAVE", "Supabase no pudo guardar"],
  ])(
    "distingue el fallo de resumen %s sin bloquear la respuesta",
    async (failure, code, message) => {
      chatHistory = longHistory();
      summaryFailure = failure;
      const text = await (await handler(req(input()), env)).text();
      expect(text).toContain('"type":"done"');
      expect(text).toContain(code);
      expect(text).toContain(message);
      expect(text).not.toContain("private");
      expect(summaryCalls).toBe(1);
      expect(savedSummary).toBeNull();
    },
  );
  it("no guarda ni avanza el cursor si el resumen supera los 6000 bytes", async () => {
    chatHistory = longHistory();
    summaryText = "🦊".repeat(1501);
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain("SUMMARY_SIZE");
    expect(text).toContain('"type":"done"');
    expect(summarySaves).toBe(0);
  });
  it("si no alcanza la cuota para resumir reserva solo la respuesta", async () => {
    chatHistory = longHistory();
    summaryFailure = "quota";
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain('"type":"done"');
    expect(summaryCalls).toBe(0);
    expect(finish?.p_input).toBe(10);
    expect(preparations.at(-1)?.p_spent).toBe(0);
  });
  it("mantiene la reserva del resumen si su proveedor no reporta uso", async () => {
    chatHistory = longHistory();
    summaryFailure = "usage";
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain('"type":"done"');
    expect(finish?.p_usage_reported).toBe(false);
    expect(preparations[1].p_spent).toBe(
      preparations[0].p_input + preparations[0].p_max_output,
    );
    expect(summarySaves).toBe(1);
  });
  it("cobra solo el resumen completado si la respuesta no llega a iniciarse", async () => {
    chatHistory = longHistory();
    summaryFailure = "answer-quota";
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain("TOKEN_LIMIT");
    expect(finish).toMatchObject({
      p_input: 20,
      p_output: 3,
      p_usage_reported: true,
      p_provider_started: true,
    });
    expect(savedSummary).not.toBeNull();
  });
  it("respeta resumen desactivado y nunca envía un resumen guardado", async () => {
    chatHistory = longHistory();
    autoSummary = false;
    savedSummary = {
      content: "PRIVATE_OLD_SUMMARY",
      through_seq: 8,
      source_count: 8,
    };
    await (await handler(req(input()), env)).text();
    expect(summaryCalls).toBe(0);
    expect(JSON.stringify(providerBody)).not.toContain("PRIVATE_OLD_SUMMARY");
  });
  it("flujo completo: JWT, propiedad, reserva, contexto, SSE y confirmación persistida", async () => {
    const response = await handler(req(input()), env);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("respuesta");
    expect(text).toContain('"type":"done"');
    expect(finish).toMatchObject({
      p_event: eid,
      p_content: "respuesta",
      p_status: "complete",
      p_input: 10,
      p_output: 2,
      p_usage_reported: true,
      p_provider_started: true,
    });
    expect(providerBody).toMatchObject({
      model: defaultModel,
      stream: true,
    });
    expect(JSON.stringify(providerBody)).toContain(
      "User likes concise answers",
    );
    expect(text).not.toContain("PRIVATE_");
    expect(reserveCount).toBe(1);
  });
  it("un contexto imposible no llama al proveedor y libera su reserva", async () => {
    contextTooLarge = true;
    const response = await handler(req(input()), env);
    const text = await response.text();
    expect(text).toContain("CONTEXT_LIMIT");
    expect(text).toContain('"type":"accepted"');
    expect(providerBody).toBeUndefined();
    expect(finish).toMatchObject({
      p_status: "error",
      p_provider_started: false,
      p_usage_reported: false,
    });
  });
  it("valida la reserva real antes de generar y distingue la cuota diaria", async () => {
    prepareFails = true;
    const text = await (await handler(req(input()), env)).text();
    expect(text).toContain("TOKEN_LIMIT");
    expect(providerBody).toBeUndefined();
    expect(finish?.p_provider_started).toBe(false);
  });
  it("rechaza origen ajeno antes de acceso al proveedor", async () => {
    expect(
      (await handler(req(input(), { origin: "https://evil.test" }), env))
        .status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rechaza JWT inválido", async () => {
    authenticated = false;
    expect((await handler(req(input()), env)).status).toBe(401);
    expect(reserveCount).toBe(0);
  });
  it("comprueba propiedad de conversación", async () => {
    owner = false;
    expect((await handler(req(input()), env)).status).toBe(404);
    expect(reserveCount).toBe(0);
  });
  it("rechaza historial y costos enviados por cliente", async () => {
    expect(
      (await handler(req({ ...input(), messages: [], price: 0 }), env)).status,
    ).toBe(400);
    expect(reserveCount).toBe(0);
  });
  it("no filtra cuerpos privados de errores del proveedor", async () => {
    providerStatus = 429;
    const response = await handler(req(input()), env);
    const text = await response.text();
    expect(text).toContain("limitando");
    expect(text).not.toContain("PRIVATE_");
    expect(finish?.p_status).toBe("error");
    expect(finish?.p_error).toBe("PROVIDER_RATE_LIMIT");
  });
  it("cancela al desconectar y finaliza sin confirmar éxito", async () => {
    const controller = new AbortController();
    const original = req(input());
    const request = new Request(original, { signal: controller.signal });
    controller.abort();
    const response = await handler(request, env);
    const text = await response.text();
    expect(text).not.toContain('"type":"done"');
    expect(finish?.p_status).not.toBe("complete");
  });
});
