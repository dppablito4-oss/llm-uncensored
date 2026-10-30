import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { handler } from "../supabase/functions/chat-stream/handler";
const uid = "11111111-1111-4111-8111-111111111111",
  cid = "22222222-2222-4222-8222-222222222222",
  eid = "33333333-3333-4333-8333-333333333333";
const env = (name: string) =>
  ({
    SUPABASE_URL: "https://backend.test",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "PRIVATE_SERVICE_SECRET",
    OPENROUTER_API_KEY: "PRIVATE_OPENROUTER_SECRET",
    ALLOWED_ORIGINS: "https://allowed.test",
  })[name];
let providerStatus = 200,
  authenticated = true,
  owner = true,
  finish: Record<string, unknown> | undefined,
  providerBody: Record<string, unknown> | undefined,
  reserveCount = 0;
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
  model_id: "allowed-model",
});
beforeEach(() => {
  providerStatus = 200;
  authenticated = true;
  owner = true;
  finish = undefined;
  providerBody = undefined;
  reserveCount = 0;
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
        });
      if (u.includes("/rest/v1/models")) return json({ id: "allowed-model" });
      if (u.includes("/rest/v1/conversations"))
        return json(owner ? { id: cid } : null);
      if (u.includes("/rest/v1/memories"))
        return json([{ content: "User likes concise answers" }]);
      if (u.includes("/rest/v1/messages"))
        return json([
          { role: "user", content: "hola", status: "complete", seq: 1 },
        ]);
      if (u.includes("/rpc/begin_generation")) {
        reserveCount++;
        return json(eid);
      }
      if (u.includes("/rpc/finish_generation")) {
        finish = JSON.parse(String(init?.body));
        return json(null);
      }
      if (u === "https://openrouter.ai/api/v1/chat/completions") {
        providerBody = JSON.parse(String(init?.body));
        if (providerStatus !== 200)
          return json(
            { error: { message: "PRIVATE_OPENROUTER_SECRET provider debug" } },
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
    });
    expect(providerBody).toMatchObject({
      model: "allowed-model",
      stream: true,
    });
    expect(JSON.stringify(providerBody)).toContain(
      "User likes concise answers",
    );
    expect(text).not.toContain("PRIVATE_");
    expect(reserveCount).toBe(1);
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
