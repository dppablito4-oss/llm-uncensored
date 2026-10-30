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
  };
});
vi.mock("../src/lib/supabase", () => ({
  configured: true,
  supabase: {
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
        single = false;
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
        const rows = (mock.tables[table] || []).filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        );
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const builder = {
        select: () => builder,
        order: () => builder,
        range: () => builder,
        eq: (k: string, v: unknown) => {
          filters = { ...filters, [k]: v };
          return builder;
        },
        single: () => {
          single = true;
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
  window.location.hash = "/chat";
  for (const key of Object.keys(mock.tables)) delete mock.tables[key];
  mock.tables.models = [{ id: "model", name: "Dolphin test" }];
  mock.tables.profiles = [
    {
      id: "u1",
      default_model: "model",
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
    await screen.findByText("Hola desde el proveedor simulado");
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({
      content: "Hola mundo",
      model_id: "model",
    });
    expect(mock.sent[0]).not.toHaveProperty("messages");
    expect(mock.tables.conversations).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: /Nueva conversación/ }));
    await screen.findByRole("heading", { name: /¿Qué tienes/ });
    await user.click(screen.getByRole("link", { name: "Hola mundo" }));
    await screen.findByText("Hola desde el proveedor simulado");
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
});
