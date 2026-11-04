import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Square,
  Copy,
  RotateCcw,
  Pencil,
  Download,
  ChevronDown,
  Sparkles,
  Code2,
  Feather,
  ArrowUpRight,
  Brain,
} from "lucide-react";
import {
  allMessages,
  messagePage,
  messagePageSize,
} from "../../services/messages";
import { save, change } from "../../services/data";
import { streamChat, getConversationSummary } from "../../services/chat";
import { download } from "../../lib/utils";
import { usesMobileKeyboard } from "../../lib/chat-input";
import { useData } from "../../hooks/useData";
import { useUsage } from "../../hooks/useUsage";
import { Button } from "../../components/ui/button";
import { ModelInfo } from "../../components/ModelInfo";
import { modelPrice } from "../../../shared/models";
import type {
  Conversation,
  Message,
  Model,
  Preset,
  Profile,
} from "../../types";
function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => (
          <div className="code-block">
            <button
              aria-label="Copiar código"
              onClick={(e) =>
                void navigator.clipboard.writeText(
                  e.currentTarget.nextElementSibling?.textContent || "",
                )
              }
            >
              Copiar
            </button>
            <pre>{children}</pre>
          </div>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
export function Chat({ userId }: { userId: string }) {
  const { id } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
  const location = useLocation();
  const recoveryState = (location.state || {}) as {
    draftText?: string;
    chatNotice?: string;
    ownerId?: string;
    scrollTop?: number;
  };
  const initial = recoveryState.ownerId === userId ? recoveryState : {};
  const { data: usage } = useUsage();
  const { data: conversations = [] } = useData<Conversation>(
    "conversations",
    "updated_at",
  );
  const { data: presets = [] } = useData<Preset>("presets");
  const { data: models = [] } = useData<Model>("models", "id");
  const { data: profiles = [] } = useData<Profile>("profiles");
  const current = conversations.find((c) => c.id === id),
    profile = profiles[0];
  const [model, setModel] = useState(""),
    [preset, setPreset] = useState(""),
    [text, setText] = useState(initial.draftText || ""),
    [draft, setDraft] = useState(""),
    [streamMessages, setStreamMessages] = useState<Message[] | null>(null),
    [pendingUser, setPendingUser] = useState(""),
    [busy, setBusy] = useState(false),
    [savingModel, setSavingModel] = useState(false),
    [phase, setPhase] = useState("Pensando"),
    [contextNotice, setContextNotice] = useState(""),
    [summaryWarning, setSummaryWarning] = useState(""),
    [notice, setNotice] = useState(initial.chatNotice || "");
  const mobileKeyboard = usesMobileKeyboard();
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editor.current) {
      editor.current.style.height = "0px";
      editor.current.style.height = `${Math.min(180, Math.max(52, editor.current.scrollHeight))}px`;
    }
  }, [text]);
  const abort = useRef<AbortController | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    positioned = useRef(false),
    mounted = useRef(true),
    previousHeight = useRef<number | null>(null);
  const selectedModel = model || profile?.default_model || models[0]?.id || "",
    selectedPreset =
      preset === "none"
        ? ""
        : preset ||
          current?.preset_id ||
          (!id ? profile?.default_preset_id : "") ||
          "";
  const query = useInfiniteQuery({
    queryKey: ["messages", id],
    enabled: !!id,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => messagePage(id!, pageParam),
    getNextPageParam: (page) =>
      page.length === messagePageSize ? page.at(-1)!.seq : undefined,
  });
  const messages =
    streamMessages ?? (query.data?.pages.flat() || []).slice().reverse();
  const summaryQuery = useQuery({
    queryKey: ["conversation-summary", id],
    enabled: !!id,
    queryFn: () => getConversationSummary(id!),
  });
  useEffect(() => {
    // Recovery data is consumed once so a later reload cannot resurrect an
    // already-sent draft, and another signed-in user never sees it.
    if (location.state)
      navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    if (previousHeight.current !== null) {
      el.scrollTop += el.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (!positioned.current && messages.length) {
      el.scrollTop = initial.scrollTop ?? el.scrollHeight;
      positioned.current = true;
    } else if (pendingUser) {
      // Position the new question once. Streaming never moves the viewport.
      const question = el.querySelector<HTMLElement>("[data-pending-question]");
      if (question) el.scrollTop = question.offsetTop - el.offsetTop;
    }
  }, [messages.length, pendingUser, initial.scrollTop]);
  async function send(
    action: "send" | "edit" | "regenerate" = "send",
    target?: Message,
    edited?: string,
  ) {
    if (busy || savingModel || !profile || abort.current) return;
    const content = edited ?? text;
    if (action !== "regenerate" && (!content.trim() || content.length > 12000))
      return;
    setNotice("");
    setBusy(true);
    setDraft("");
    setPhase("Pensando");
    setContextNotice("");
    setSummaryWarning("");
    setPendingUser(action === "regenerate" ? "" : content);
    setStreamMessages(messages);
    const controller = new AbortController();
    abort.current = controller;
    let cid = id,
      accepted = false,
      failureNotice = "";
    try {
      if (!cid) {
        const created = await save("conversations", {
          title: content.slice(0, 80) || "Nueva conversación",
          model_id: selectedModel,
          preset_id: selectedPreset || null,
        });
        cid = created.id; // Preserve this component until streaming completes; navigate after confirmation.
      }
      await streamChat(
        {
          conversation_id: cid,
          request_id: crypto.randomUUID(),
          content: action === "regenerate" ? "" : content,
          model_id: selectedModel,
          preset_id: selectedPreset || null,
          action,
          ...(target ? { target_id: target.id } : {}),
        },
        controller.signal,
        (event) => {
          if (event.type === "accepted") {
            accepted = true;
            if (action === "send") setText("");
          }
          if (event.type === "delta") setDraft((v) => v + (event.text || ""));
          if (event.type === "status") setPhase(event.message || "Pensando");
          if (event.type === "context") {
            if (
              event.code ||
              event.message?.startsWith("No se pudo actualizar el resumen")
            ) {
              setSummaryWarning(
                event.message || "No se pudo actualizar el resumen.",
              );
            } else if (!event.message?.startsWith("Resumen de ")) {
              setContextNotice((previous) =>
                [...new Set([previous, event.message].filter(Boolean))].join(
                  " ",
                ),
              );
            }
          }
        },
      );
      accepted = true;
      if (action === "send") setText("");
    } catch (error) {
      failureNotice = controller.signal.aborted
        ? "Generación detenida. El servidor guardará el texto disponible como parcial. Actualiza el historial en unos segundos."
        : error instanceof Error
          ? error.message
          : "No se pudo generar la respuesta.";
      if (!accepted && action === "send")
        failureNotice +=
          " Tu mensaje sigue en el editor. Revisa el historial antes de reenviarlo si hubo un corte de conexión.";
      setNotice(failureNotice);
    } finally {
      const readingPosition = scroll.current?.scrollTop ?? 0;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["messages", cid] }),
        client.invalidateQueries({ queryKey: ["conversations"] }),
        client.invalidateQueries({ queryKey: ["usage-summary"] }),
        client.invalidateQueries({ queryKey: ["conversation-summary", cid] }),
      ]);
      setPendingUser("");
      setDraft("");
      setStreamMessages(null);
      if (!id && cid && mounted.current)
        navigate("/chat/" + cid, {
          state: {
            ownerId: userId,
            scrollTop: readingPosition,
            chatNotice: failureNotice,
            draftText: !accepted && action === "send" ? content : "",
          },
        });
      else {
        abort.current = null;
        setBusy(false);
      }
    }
  }
  async function selectModel(value: string) {
    if (!profile || savingModel) return;
    const previous = selectedModel;
    setModel(value);
    setSavingModel(true);
    try {
      await change("profiles", profile.id, { default_model: value });
      await client.invalidateQueries({ queryKey: ["profiles"] });
      setModel("");
    } catch {
      setModel(previous);
      setNotice(
        "No se pudo guardar el modelo. Se conserva la selección anterior.",
      );
    } finally {
      setSavingModel(false);
    }
  }
  async function selectPreset(value: string) {
    setPreset(value || "none");
    if (current) {
      try {
        await change("conversations", current.id, {
          preset_id: value || null,
        });
        await client.invalidateQueries({ queryKey: ["conversations"] });
      } catch {
        setNotice("No se pudo aplicar el preset");
      }
    }
  }
  const presetValue = selectedPreset === "none" ? "" : selectedPreset;
  async function exportConversation(format: "json" | "md") {
    if (!id) return;
    try {
      const exported = await allMessages(id);
      download(
        `conversacion.${format}`,
        format === "json"
          ? { conversation: current, messages: exported }
          : `# ${current?.title || "Conversación"}

` +
              exported
                .map(
                  (
                    m,
                  ) => `## ${m.role === "user" ? "Tú" : "Forma"}${m.status === "partial" ? " (parcial)" : ""}

${m.content}`,
                )
                .join("\n\n"),
      );
    } catch {
      setNotice("No se pudo exportar la conversación completa. Reintenta.");
    }
  }
  return (
    <div className="chat-view">
      <header className="chat-header">
        <div className="row model-controls">
          <label className="sr-only" htmlFor="model">
            Modelo
          </label>
          <select
            id="model"
            value={selectedModel}
            disabled={busy || savingModel}
            onChange={(e) => void selectModel(e.target.value)}
          >
            {models.length ? (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {modelPrice(m.id)}
                </option>
              ))
            ) : (
              <option value="">Cargando modelos…</option>
            )}
          </select>
          <ChevronDown size={14} />
          {savingModel && (
            <span className="muted small" role="status">
              Guardando modelo…
            </span>
          )}
        </div>
        <div className="row">
          {id && (
            <>
              <Button
                variant="ghost"
                aria-label="Exportar Markdown"
                onClick={() => void exportConversation("md")}
              >
                <Download size={16} />
                <span className="desktop-label">Markdown</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => void exportConversation("json")}
              >
                JSON
              </Button>
            </>
          )}
        </div>
      </header>
      <ModelInfo id={selectedModel} />
      <div className="chat-scroll" ref={scroll}>
        {!id && !busy ? (
          <div className="welcome">
            <h1>¿En qué puedo ayudarte?</h1>
            <p>
              Una pregunta, una idea a medias o algo por descubrir.
              <br />
              Este espacio es tuyo.
            </p>
            <div className="suggestions">
              {[
                {
                  icon: Sparkles,
                  title: "Explora una idea",
                  text: "Ayúdame a convertir una idea en un plan práctico.",
                },
                {
                  icon: Code2,
                  title: "Construye algo",
                  text: "Ayúdame a diseñar una pequeña aplicación. Hazme preguntas para empezar.",
                },
                {
                  icon: Feather,
                  title: "Encuentra las palabras",
                  text: "Quiero escribir un texto. Ayúdame a definir la idea y el tono.",
                },
              ].map((s) => (
                <button key={s.title} onClick={() => setText(s.text)}>
                  <s.icon size={18} />
                  <span>{s.title}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {query.hasNextPage && (
              <Button
                variant="ghost"
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  previousHeight.current = scroll.current?.scrollHeight ?? null;
                  void query.fetchNextPage();
                }}
              >
                {query.isFetchingNextPage
                  ? "Cargando…"
                  : "Cargar mensajes anteriores"}
              </Button>
            )}
            {query.isLoading && (
              <p className="muted">Recuperando conversación…</p>
            )}
            {messages.map((m) => (
              <article key={m.id} className={`message ${m.role}`}>
                <div className="message-avatar">
                  {m.role === "user" ? "TÚ" : "✳"}
                </div>
                <div className="message-body">
                  <strong>{m.role === "user" ? "Tú" : "Forma"}</strong>
                  {m.role === "user" ? (
                    <div className="user-text">{m.content}</div>
                  ) : (
                    <Markdown content={m.content} />
                  )}
                  {m.status !== "complete" && (
                    <span className="partial">
                      Respuesta{" "}
                      {m.status === "partial" ? "parcial" : "con error"}
                    </span>
                  )}
                  <div className="message-actions">
                    <button
                      aria-label="Copiar mensaje"
                      onClick={() =>
                        void navigator.clipboard.writeText(m.content)
                      }
                    >
                      <Copy size={14} />
                    </button>
                    {m.role === "user" && (
                      <button
                        disabled={busy || savingModel}
                        aria-label="Editar y reenviar"
                        onClick={() => {
                          const edited = prompt(
                            "Edita el mensaje. Se descartarán los turnos posteriores.",
                            m.content,
                          );
                          if (edited?.trim()) void send("edit", m, edited);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {pendingUser && (
              <article className="message user" data-pending-question>
                <div className="message-avatar">TÚ</div>
                <div className="message-body">
                  <strong>Tú</strong>
                  <div className="user-text">{pendingUser}</div>
                </div>
              </article>
            )}
            {busy && (
              <article className="message assistant">
                <div className="message-avatar">✳</div>
                <div className="message-body">
                  <strong>Forma</strong>
                  {draft ? (
                    <>
                      <Markdown content={draft} />
                      {phase.startsWith("Actualizando resumen") && (
                        <p className="muted small" role="status">
                          {phase}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="thinking">
                      {phase}
                      <span>•••</span>
                    </span>
                  )}
                </div>
              </article>
            )}
            {!busy && messages.some((m) => m.role === "user") && (
              <Button
                variant="ghost"
                onClick={() =>
                  void send(
                    "regenerate",
                    [...messages].reverse().find((m) => m.role === "user"),
                  )
                }
              >
                <RotateCcw size={14} />
                Regenerar última respuesta
              </Button>
            )}
          </div>
        )}
      </div>
      {(messages.length > 0 || busy) && (
        <button
          className="jump-latest"
          aria-label="Ir al último mensaje"
          onClick={() =>
            scroll.current?.scrollTo({
              top: scroll.current.scrollHeight,
              behavior: "smooth",
            })
          }
        >
          <ChevronDown size={16} /> Ir al último mensaje
        </button>
      )}
      <div className="composer-wrap">
        {summaryQuery.data && (
          <details className="chat-summary muted small">
            <summary>
              Resumen de este chat · {summaryQuery.data.source_count} mensajes
              {profile?.auto_summary === false ? " · desactivado" : ""}
            </summary>
            <p style={{ whiteSpace: "pre-wrap" }}>
              {summaryQuery.data.content}
            </p>
            <p>
              Puede omitir detalles. Los mensajes originales siguen en el
              historial.
            </p>
          </details>
        )}
        {summaryWarning && (
          <details className="summary-warning small" role="status">
            <summary>
              {summaryQuery.data
                ? "El resumen anterior sigue activo"
                : "No se pudo crear el resumen"}{" "}
              · ver detalle
            </summary>
            <p>{summaryWarning}</p>
          </details>
        )}
        {contextNotice && (
          <p className="muted small" role="status">
            {contextNotice}
          </p>
        )}
        {(notice || query.error) && (
          <div className="notice" role="alert">
            {notice || query.error?.message}
            <Button
              variant="ghost"
              onClick={() => void client.invalidateQueries()}
            >
              Actualizar historial
            </Button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={editor}
            aria-label="Mensaje"
            aria-describedby="composer-help"
            enterKeyHint={mobileKeyboard ? "enter" : "send"}
            placeholder="Dale forma a tu próxima idea…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={12000}
            rows={2}
            disabled={busy || savingModel}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !mobileKeyboard &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-footer">
            <div className="row">
              <select
                aria-label="Preset activo"
                value={presetValue}
                disabled={busy || savingModel}
                onChange={(e) => void selectPreset(e.target.value)}
              >
                <option value="">Sin preset</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="memory-hint">
                <Brain size={13} />
                {profile?.memory_enabled &&
                (presets.find((p) => p.id === presetValue)?.memory_enabled ??
                  true)
                  ? "Memoria activa"
                  : "Sin memoria"}
              </span>
            </div>
            {busy ? (
              <Button
                type="button"
                aria-label="Detener respuesta"
                onClick={() => abort.current?.abort()}
              >
                <Square size={15} />
              </Button>
            ) : (
              <Button
                aria-label="Enviar mensaje"
                disabled={
                  savingModel || !profile || !text.trim() || !selectedModel
                }
              >
                <ArrowUp size={19} />
              </Button>
            )}
          </div>
        </form>
        <p id="composer-help" className="composer-help">
          <span>
            {mobileKeyboard
              ? "Enter: salto de línea · Toca ↑ para enviar"
              : "Enter: enviar · Shift+Enter: salto de línea"}
          </span>
          {text.length >= 10000 && (
            <span>{text.length.toLocaleString()} / 12 000</span>
          )}
        </p>
        <p className="composer-note">
          {usage
            ? `${usage.daily_tokens === null ? "Sin cuota diaria de tokens" : `${Math.max(0, usage.daily_tokens - usage.tokens_today).toLocaleString()} tokens disponibles hoy`} · ${usage.requests_today}${usage.daily_requests === null ? "" : `/${usage.daily_requests}`} solicitudes · `
            : ""}
          Forma puede equivocarse. Comprueba la información importante.
        </p>
      </div>
    </div>
  );
}
