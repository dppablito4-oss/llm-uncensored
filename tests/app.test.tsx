// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "../src/app/App";
import { defaultModel, modelCatalog, modelPrice } from "../shared/models";
const mock = vi.hoisted(() => {
  const tables: Record<string, Record<string, unknown>[]> = {};
  let session: unknown = null;
  const listeners: ((e: string, s: unknown) => void)[] = [];
  return {
    tables,
    getSession: () => session,
    setSession: (s: unknown) => {
      session = s;
    },
    clearAuth: () => {
      listeners.length = 0;
    },
    setOnAuth: (f: (e: string, s: unknown) => void) => {
      listeners.push(f);
    },
    event: (e: string, s: unknown) => listeners.forEach((f) => f(e, s)),
    sent: [] as Record<string, unknown>[],
    failFetch: false,
  };
});
vi.mock("../src/lib/supabase", () => ({
  configured: true,
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: mock.getSession() } }),
      onAuthStateChange: (callback: (e: string, s: unknown) => void) => {
        mock.setOnAuth(callback);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      signInWithPassword: async () => {
        const session = {
          access_token: "user-token",
          user: { id: "u1", email: "test@example.com" },
        };
        mock.setSession(session);
        mock.event("SIGNED_IN", session);
        return { data: { session }, error: null };
      },
      signUp: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      signOut: async () => {
        mock.setSession(null);
        mock.event("SIGNED_OUT", null);
      },
    },
    from: (table: string) => {
      let filters: Record<string, unknown> = {},
        upsert: Record<string, unknown> | undefined,
        patch: Record<string, unknown> | undefined,
        single = false,
        descending = false,
        maxRows = Infinity,
        before: { key: string; value: number } | undefined;
      const result = () => {
        if (upsert) {
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...upsert,
          };
          mock.tables[table] ??= [];
          mock.tables[table].push(row);
          return { data: row, error: null };
        }
        let rows = (mock.tables[table] || []).filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        );
        if (patch) {
          rows.forEach((row) => Object.assign(row, patch));
          return { data: null, error: null };
        }
        if (before)
          rows = rows.filter((r) => Number(r[before!.key]) < before!.value);
        if (table === "messages")
          rows = rows
            .slice()
            .sort((a, b) =>
              descending
                ? Number(b.seq) - Number(a.seq)
                : Number(a.seq) - Number(b.seq),
            );
        rows = rows.slice(0, maxRows);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const builder = {
        select: () => builder,
        order: (_key: string, options?: { ascending?: boolean }) => {
          descending = options?.ascending === false;
          return builder;
        },
        limit: (value: number) => {
          maxRows = value;
          return builder;
        },
        lt: (key: string, value: number) => {
          before = { key, value };
          return builder;
        },
        range: () => builder,
        eq: (k: string, v: unknown) => {
          filters = { ...filters, [k]: v };
          return builder;
        },
        single: () => {
          single = true;
          return builder;
        },
        update: (v: Record<string, unknown>) => {
          patch = v;
          return builder;
        },
        upsert: (v: Record<string, unknown>) => {
          upsert = v;
          return builder;
        },
        then: (resolve: (v: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  },
}));
beforeEach(() => {
  mock.clearAuth();
  mock.setSession(null);
  mock.sent = [];
  mock.failFetch = false;
  window.location.hash = "/chat";
  for (const key of Object.keys(mock.tables)) delete mock.tables[key];
  mock.tables.models = modelCatalog.slice(0, 2);
  mock.tables.profiles = [
    {
      id: "u1",
      default_model: defaultModel,
      default_preset_id: null,
      memory_enabled: true,
    },
  ];
  mock.tables.presets = [];
  mock.tables.conversations = [];
  mock.tables.messages = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (mock.failFetch) throw new Error("Sin conexión");
      const body = JSON.parse(String(init.body));
      mock.sent.push(body);
      mock.tables.messages.push(
        {
          id: crypto.randomUUID(),
          conversation_id: body.conversation_id,
          role: "user",
          content: body.content,
          status: "complete",
          seq: 1,
        },
        {
          id: crypto.randomUUID(),
          conversation_id: body.conversation_id,
          role: "assistant",
          content: "Hola desde el proveedor simulado",
          status: "complete",
          seq: 2,
        },
      );
      return new Response(
        'data: {"type":"delta","text":"Hola desde "}\n\ndata: {"type":"delta","text":"el proveedor simulado"}\n\ndata: {"type":"done","status":"complete"}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>,
  );
  return client;
}
describe("Flujo UI completo con proveedor simulado", () => {
  it("permite cambiar de modelo y muestra su tarifa antes de enviarlo", async () => {
    const user = userEvent.setup();
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mount();
    const selector = await screen.findByRole("combobox", { name: "Modelo" });
    const alternate = modelCatalog[1];
    await waitFor(() =>
      expect(
        Array.from(
          (selector as HTMLSelectElement).options,
          (option) => option.value,
        ),
      ).toContain(alternate.id),
    );
    await user.selectOptions(selector, alternate.id);
    expect((selector as HTMLSelectElement).value).toBe(alternate.id);
    expect(
      document.querySelector(".model-info summary")?.textContent,
    ).toContain(modelPrice(alternate.id));
    await user.type(screen.getByRole("textbox", { name: "Mensaje" }), "Hola");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(mock.sent[0]?.model_id).toBe(alternate.id));
  });
  it("conserva la última selección en chats antiguos, nuevos y tras volver a entrar; el preset no la cambia", async () => {
    const user = userEvent.setup();
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mock.tables.conversations = [
      {
        id: "old",
        title: "Chat antiguo",
        model_id: defaultModel,
        user_id: "u1",
      },
    ];
    mock.tables.presets = [
      { id: "preset", name: "Otro preset", model_id: defaultModel },
    ];
    mount();
    const alternate = modelCatalog[1].id;
    const selector = await screen.findByRole("combobox", { name: "Modelo" });
    await waitFor(() =>
      expect((selector as HTMLSelectElement).options.length).toBeGreaterThan(1),
    );
    await user.selectOptions(selector, alternate);
    await waitFor(() =>
      expect(mock.tables.profiles[0].default_model).toBe(alternate),
    );
    await user.click(screen.getByRole("link", { name: "Chat antiguo" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Modelo" }) as HTMLSelectElement)
          .value,
      ).toBe(alternate),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Preset activo" }),
      "preset",
    );
    expect(
      (screen.getByRole("combobox", { name: "Modelo" }) as HTMLSelectElement)
        .value,
    ).toBe(alternate);
    await user.click(screen.getByRole("link", { name: /Nueva conversación/ }));
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Modelo" }) as HTMLSelectElement)
          .value,
      ).toBe(alternate),
    );
    cleanup();
    mount();
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Modelo" }) as HTMLSelectElement)
          .value,
      ).toBe(alternate),
    );
  });
  it.each([false, true])(
    "Enter respeta teclado móvil=%s y Shift+Enter siempre inserta una línea",
    async (mobile) => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: mobile }),
      });
      mock.setSession({
        access_token: "user-token",
        user: { id: "u1", email: "test@example.com" },
      });
      const user = userEvent.setup();
      mount();
      const editor = await screen.findByRole("textbox", { name: "Mensaje" });
      await user.type(editor, "primera{Shift>}{Enter}{/Shift}segunda");
      expect((editor as HTMLTextAreaElement).value).toBe("primera\nsegunda");
      expect(mock.sent).toHaveLength(0);
      await user.keyboard("{Enter}");
      if (mobile) {
        expect(mock.sent).toHaveLength(0);
        expect((editor as HTMLTextAreaElement).value).toBe(
          "primera\nsegunda\n",
        );
        await user.click(
          screen.getByRole("button", { name: "Enviar mensaje" }),
        );
      }
      await waitFor(() => expect(mock.sent).toHaveLength(1));
      expect(mock.sent[0].content).toBe(
        mobile ? "primera\nsegunda\n" : "primera\nsegunda",
      );
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: undefined,
      });
    },
  );
  it("protege rutas, inicia sesión, envía, muestra SSE y recupera conversación", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Bienvenido de nuevo");
    await user.type(
      screen.getByLabelText("Correo electrónico"),
      "test@example.com",
    );
    await user.type(screen.getByLabelText("Contraseña"), "password-123");
    await user.click(
      screen.getByRole("button", { name: "Entrar a mi espacio" }),
    );
    await screen.findByRole("heading", { name: /¿Qué tienes/ });
    await user.type(
      screen.getByRole("textbox", { name: "Mensaje" }),
      "Hola mundo",
    );
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    // Streaming completion navigates and reloads history asynchronously.
    await screen.findByText(
      "Hola desde el proveedor simulado",
      {},
      { timeout: 5000 },
    );
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({
      content: "Hola mundo",
      model_id: defaultModel,
    });
    expect(mock.sent[0]).not.toHaveProperty("messages");
    expect(mock.tables.conversations).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: /Nueva conversación/ }));
    await screen.findByRole("heading", { name: /¿Qué tienes/ });
    await user.click(screen.getByRole("link", { name: "Hola mundo" }));
    await screen.findByText(
      "Hola desde el proveedor simulado",
      {},
      { timeout: 5000 },
    );
  });
  it("registra y pide revisar correo", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Crear cuenta" }),
    );
    await user.type(
      screen.getByLabelText("Correo electrónico"),
      "new@example.com",
    );
    await user.type(screen.getByLabelText("Contraseña"), "password-123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText("Revisa tu correo para confirmar tu cuenta.");
  });
  it("recupera contraseña sin exigir introducir una contraseña", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Olvidé mi contraseña" }),
    );
    await user.type(
      screen.getByLabelText("Correo electrónico"),
      "test@example.com",
    );
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText("Si la cuenta existe, recibirás un enlace.");
  });
  it("un formulario inválido no dispara generación", async () => {
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mount();
    const send = await screen.findByRole("button", { name: "Enviar mensaje" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(send.closest("form")!);
    await waitFor(() => expect(mock.sent).toHaveLength(0));
  });
  it("conserva el mensaje cuando falla la red y permite recuperarlo sin crear otro chat", async () => {
    const user = userEvent.setup();
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mock.failFetch = true;
    const client = mount();
    let releaseCache!: () => void;
    const cacheReady = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    const originalInvalidate = client.invalidateQueries.bind(client);
    vi.spyOn(client, "invalidateQueries").mockImplementation(
      async (filters, options) => {
        await cacheReady;
        await originalInvalidate(filters, options);
      },
    );
    const editor = await screen.findByRole("textbox", { name: "Mensaje" });
    await user.type(editor, "Este mensaje no debe perderse");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await screen.findByText(/Tu mensaje sigue en el editor/);
    expect(
      (screen.getByRole("textbox", { name: "Mensaje" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Este mensaje no debe perderse");
    expect(mock.tables.conversations).toHaveLength(1);
    // A retry must wait until the newly-created conversation is on screen.
    // Otherwise it can start on /chat and create a second conversation.
    expect(screen.queryByRole("button", { name: "Enviar mensaje" })).toBeNull();
    releaseCache();
    const retry = await screen.findByRole("button", { name: "Enviar mensaje" });
    await waitFor(() =>
      expect((retry as HTMLButtonElement).disabled).toBe(false),
    );
    expect(window.location.hash).toBe(
      "#/chat/" + mock.tables.conversations[0].id,
    );
    mock.failFetch = false;
    await user.click(retry);
    await screen.findByText(
      "Hola desde el proveedor simulado",
      {},
      { timeout: 5000 },
    );
    expect(mock.tables.conversations).toHaveLength(1);
    expect(mock.sent).toHaveLength(1);
    cleanup();
    mount();
    const recovered = await screen.findByRole("textbox", { name: "Mensaje" });
    expect((recovered as HTMLTextAreaElement).value).toBe("");
  });
  it("carga primero mensajes recientes y permite recuperar los anteriores en orden", async () => {
    const user = userEvent.setup();
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mock.tables.conversations = [
      { id: "old-chat", title: "Historial largo", model_id: defaultModel },
    ];
    mock.tables.messages = Array.from({ length: 60 }, (_, i) => ({
      id: `m-${i + 1}`,
      conversation_id: "old-chat",
      role: i % 2 ? "assistant" : "user",
      content: `Mensaje histórico ${i + 1}`,
      status: "complete",
      seq: i + 1,
    }));
    window.location.hash = "/chat/old-chat";
    mount();
    await screen.findByText("Mensaje histórico 60");
    expect(screen.queryByText("Mensaje histórico 1")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Cargar mensajes anteriores" }),
    );
    await screen.findByText("Mensaje histórico 1");
    expect(document.querySelectorAll(".message")).toHaveLength(60);
    expect(document.querySelector(".message")?.textContent).toContain(
      "Mensaje histórico 1",
    );
  });
  it("recupera el resumen al reabrir un chat y muestra su contenido como texto", async () => {
    mock.setSession({
      access_token: "user-token",
      user: { id: "u1", email: "test@example.com" },
    });
    mock.tables.conversations = [
      { id: "summarized-chat", title: "Proyecto", model_id: defaultModel },
    ];
    mock.tables.conversation_summaries = [
      {
        conversation_id: "summarized-chat",
        source_count: 12,
        through_seq: 12,
        content: "La tienda se llama Forma. <script>alert('x')</script>",
      },
    ];
    window.location.hash = "/chat/summarized-chat";
    mount();
    await screen.findByText("Resumen de este chat · 12 mensajes");
    expect(
      screen.getByText("La tienda se llama Forma. <script>alert('x')</script>"),
    ).toBeTruthy();
    expect(document.querySelector(".composer-wrap script")).toBeNull();
  });
});
