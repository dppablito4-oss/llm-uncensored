import { describe, it, expect } from "vitest";
import { sseData, encodeEvent } from "../shared/sse";
import { providerEvents } from "../shared/provider";
import { buildContext, tokenBound, rankMemories } from "../shared/context";
import { requestSchema } from "../supabase/functions/chat-stream/schema";
import { authSchema } from "../src/features/auth/Auth";
import { presetSchema } from "../src/features/presets/Presets";
import { memorySchema } from "../src/features/memory/Memory";
const collect = async <T>(source: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
};
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    }),
  );
}
describe("Streaming real del protocolo", () => {
  it("reconstruye Unicode y líneas SSE fragmentadas por byte", async () => {
    const r = response(
      ':keepalive\r\ndata: {"text":"¡Hola 🦊!"}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    expect(await collect(sseData(r.body!))).toEqual([
      '{"text":"¡Hola 🦊!"}',
      "[DONE]",
    ]);
  });
  it("procesa tokens, uso y confirmación", async () => {
    const r = response(
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.01}}\n\ndata: [DONE]\n\n',
    );
    expect(
      await collect(providerEvents(r, new AbortController().signal)),
    ).toEqual([
      { text: "Hola" },
      { usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.01 } },
      { done: true },
    ]);
  });
  it.each([
    [429, "PROVIDER_RATE_LIMIT"],
    [402, "PROVIDER_BALANCE"],
    [404, "MODEL_UNAVAILABLE"],
    [500, "PROVIDER_ERROR"],
  ])("maneja HTTP %i", async (code, message) => {
    await expect(
      collect(
        providerEvents(
          new Response("", { status: code }),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow(String(message));
  });
  it("no acepta un EOF como respuesta confirmada", async () => {
    await expect(
      collect(
        providerEvents(
          response('data: {"choices":[]}\n\n'),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow("INCOMPLETE_STREAM");
  });
  it("detecta error en mitad de SSE", async () => {
    await expect(
      collect(
        providerEvents(
          response('data: {"error":{"message":"secret upstream body"}}\n\n'),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow("PROVIDER_STREAM_ERROR");
  });
  it("marca límite de salida como parcial", async () => {
    await expect(
      collect(
        providerEvents(
          response('data: {"choices":[{"finish_reason":"length"}]}\n\n'),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow("OUTPUT_LIMIT");
  });
  it("conserva el uso que llega después del límite, incluyendo tokens de razonamiento", async () => {
    const items: unknown[] = [];
    await expect(
      (async () => {
        for await (const item of providerEvents(
          response(
            'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: {"usage":{"prompt_tokens":50,"completion_tokens":2048}}\n\ndata: [DONE]\n\n',
          ),
          new AbortController().signal,
        ))
          items.push(item);
      })(),
    ).rejects.toThrow("OUTPUT_LIMIT");
    expect(items).toEqual([
      { usage: { prompt_tokens: 50, completion_tokens: 2048 } },
    ]);
  });
  it("cancela un lector bloqueado al abortar", async () => {
    let cancelled = false;
    const c = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const pending = collect(sseData(body, c.signal));
    c.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });
  it("codifica eventos del backend sin exponer datos auxiliares", () => {
    expect(
      new TextDecoder().decode(
        encodeEvent({ type: "done", status: "complete" }),
      ),
    ).toBe('data: {"type":"done","status":"complete"}\n\n');
  });
});
describe("Validación y presupuesto", () => {
  const valid = {
    conversation_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    content: "Hola",
    model_id: "authorized",
  };
  it("valida envío y rechaza historial/precios del navegador", () => {
    expect(requestSchema.safeParse(valid).success).toBe(true);
    expect(
      requestSchema.safeParse({ ...valid, messages: [], price: 0 }).success,
    ).toBe(false);
  });
  it("rechaza tamaños, UUID y edición sin destino", () => {
    for (const v of [
      { ...valid, content: "x".repeat(12001) },
      { ...valid, conversation_id: "bad" },
      { ...valid, action: "edit" },
      { ...valid, content: "  " },
    ])
      expect(requestSchema.safeParse(v).success).toBe(false);
  });
  it("valida credenciales", () => {
    expect(
      authSchema.safeParse({ email: "bad", password: "short" }).success,
    ).toBe(false);
    expect(
      authSchema.safeParse({
        email: "test@example.com",
        password: "long-enough-123",
      }).success,
    ).toBe(true);
  });
  it("limita importación de presets y memorias", () => {
    const p = {
      name: "Dev",
      description: "",
      system_prompt: "Help",
      model_id: "m",
      temperature: 0.7,
      top_p: 1,
      max_tokens: 2048,
      memory_enabled: true,
    };
    expect(presetSchema.safeParse(p).success).toBe(true);
    expect(presetSchema.safeParse({ ...p, max_tokens: 999999 }).success).toBe(
      false,
    );
    expect(
      memorySchema.safeParse({
        content: "x".repeat(2001),
        category: "general",
        enabled: true,
      }).success,
    ).toBe(false);
  });
  it("incluye sistema, memoria y reciente sin enviar todo el historial", () => {
    const c = buildContext(
      "system",
      "preset",
      ["Preferencia"],
      [
        { role: "user", content: "x".repeat(500) },
        { role: "assistant", content: "old" },
        { role: "user", content: "nuevo" },
      ],
      220,
      30,
    );
    expect(c[0].content).toContain("Preferencia");
    expect(c.at(-1)?.content).toBe("nuevo");
    expect(c.some((m) => m.content.length === 500)).toBe(false);
  });
  it("respeta memoria desactivada y rechaza contexto insuficiente", () => {
    expect(
      buildContext("s", "", [], [{ role: "user", content: "hola" }], 100)[0]
        .content,
    ).not.toContain("reference memories");
    expect(() =>
      buildContext(
        "x".repeat(1000),
        "",
        [],
        [{ role: "user", content: "hola" }],
        100,
      ),
    ).toThrow();
    expect(tokenBound("🦊")).toBe(4);
  });
  it("prioriza el mensaje actual cuando memorias grandes compiten por contexto", () => {
    const current = "necesito ayuda ".repeat(25);
    const context = buildContext(
      "sistema",
      "preset",
      ["m".repeat(800)],
      [
        { role: "user", content: "antes" },
        { role: "assistant", content: "respuesta anterior" },
        { role: "user", content: current },
      ],
      600,
      1000,
    );
    expect(context.at(-1)?.content).toBe(current);
    expect(
      context.reduce((n, t) => n + tokenBound(t.content) + 32, 0),
    ).toBeLessThanOrEqual(600);
    expect(context[1].role).toBe("user");
    expect(context[0].content).not.toContain("m".repeat(800));
  });
  it("recorta historial largo por pares sin comenzar con una respuesta huérfana", () => {
    const history = Array.from({ length: 30 }, (_, i) => [
      { role: "user", content: `pregunta ${i}` },
      { role: "assistant", content: `respuesta ${i}` },
    ]).flat();
    history.push({ role: "user", content: "última pregunta" });
    const context = buildContext("sistema", "", [], history, 250);
    expect(context[1].role).toBe("user");
    expect(context.at(-1)?.content).toBe("última pregunta");
    expect(context.length).toBeLessThan(history.length);
    expect(
      context.reduce((n, t) => n + tokenBound(t.content) + 32, 0),
    ).toBeLessThanOrEqual(250);
  });
});

it("prioriza memorias por coincidencias sin descartar recencia empatada", () => {
  expect(
    rankMemories(
      ["Mi color es verde", "Trabajo con React", "Prefiero TypeScript"],
      "Ayuda con React y TypeScript",
    ),
  ).toEqual(["Trabajo con React", "Prefiero TypeScript", "Mi color es verde"]);
});
