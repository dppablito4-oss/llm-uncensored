import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "../../lib/supabase";
import { save, change } from "../../services/data";
import { streamChat } from "../../services/chat";
import { download } from "../../lib/utils";
import { useData } from "../../hooks/useData";
import { Button } from "../../components/ui/button";
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
export function Chat() {
  const { id } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
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
    [text, setText] = useState(""),
    [draft, setDraft] = useState(""),
    [pendingUser, setPendingUser] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const abort = useRef<AbortController | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const selectedModel =
      model ||
      current?.model_id ||
      profile?.default_model ||
      models[0]?.id ||
      "",
    selectedPreset =
      preset === "none"
        ? ""
        : preset ||
          current?.preset_id ||
          (!id ? profile?.default_preset_id : "") ||
          "";
  const query = useQuery({
    queryKey: ["messages", id],
    enabled: !!id,
    queryFn: async () => {
      const all: Message[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", id!)
          .order("seq")
          .range(offset, offset + 499);
        if (error) throw error;
        all.push(...(data as Message[]));
        if (data.length < 500) break;
      }
      return all;
    },
  });
  const messages = query.data || [];
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [draft, messages.length, pendingUser]);
  async function send(
    action: "send" | "edit" | "regenerate" = "send",
    target?: Message,
    edited?: string,
  ) {
    if (busy) return;
    const content = edited ?? text;
    if (action !== "regenerate" && (!content.trim() || content.length > 12000))
      return;
    setNotice("");
    setBusy(true);
    setDraft("");
    setPendingUser(action === "regenerate" ? "" : content);
    setText("");
    follow.current = true;
    const controller = new AbortController();
    abort.current = controller;
    try {
      let cid = id;
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
          if (event.type === "delta") setDraft((v) => v + (event.text || ""));
        },
      );
      if (!id) navigate("/chat/" + cid);
    } catch (error) {
      setNotice(
        controller.signal.aborted
          ? "Generación detenida. El servidor guardará el texto disponible como parcial. Actualiza el historial en unos segundos."
          : error instanceof Error
            ? error.message
            : "No se pudo generar la respuesta.",
      );
    } finally {
      setBusy(false);
      setPendingUser("");
      setDraft("");
      abort.current = null;
      await client.invalidateQueries();
    }
  }
  async function selectPreset(value: string) {
    setPreset(value || "none");
    const p = presets.find((p) => p.id === value);
    if (p) setModel(p.model_id);
    if (current) {
      try {
        await change("conversations", current.id, {
          preset_id: value || null,
          ...(p ? { model_id: p.model_id } : {}),
        });
        await client.invalidateQueries({ queryKey: ["conversations"] });
      } catch {
        setNotice("No se pudo aplicar el preset");
      }
    }
  }
  const presetValue = selectedPreset === "none" ? "" : selectedPreset;
  function exportConversation(format: "json" | "md") {
    download(
      `conversacion.${format}`,
      format === "json"
        ? { conversation: current, messages }
        : `# ${current?.title || "Conversación"}

` +
            messages
              .map(
                (
                  m,
                ) => `## ${m.role === "user" ? "Tú" : "Forma"}${m.status === "partial" ? " (parcial)" : ""}

${m.content}`,
              )
              .join("\n\n"),
    );
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
            disabled={busy}
            onChange={async (e) => {
              setModel(e.target.value);
              if (current)
                try {
                  await change("conversations", current.id, {
                    model_id: e.target.value,
                  });
                } catch {
                  setNotice("No se pudo cambiar el modelo");
                }
            }}
          >
            {models.length ? (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            ) : (
              <option value="">Cargando modelos…</option>
            )}
          </select>
          <ChevronDown size={14} />
          <span className="badge">
            <span />
            ESPACIO PERSONAL
          </span>
        </div>
        <div className="row">
          {id && (
            <>
              <Button
                variant="ghost"
                aria-label="Exportar Markdown"
                onClick={() => exportConversation("md")}
              >
                <Download size={16} />
                <span className="desktop-label">Markdown</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => exportConversation("json")}
              >
                JSON
              </Button>
            </>
          )}
        </div>
      </header>
      <div
        className="chat-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {!id && !busy ? (
          <div className="welcome">
            <div className="orb">✳</div>
            <span className="eyebrow">
              UN POCO DE CURIOSIDAD LO CAMBIA TODO
            </span>
            <h1>
              ¿Qué tienes
              <br />
              <em>en mente hoy?</em>
            </h1>
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
                  <Markdown content={m.content} />
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
                        disabled={busy}
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
              <article className="message user">
                <div className="message-avatar">TÚ</div>
                <div className="message-body">
                  <strong>Tú</strong>
                  <p>{pendingUser}</p>
                </div>
              </article>
            )}
            {busy && (
              <article className="message assistant">
                <div className="message-avatar">✳</div>
                <div className="message-body">
                  <strong>Forma</strong>
                  {draft ? (
                    <Markdown content={draft} />
                  ) : (
                    <span className="thinking">
                      Pensando<span>•••</span>
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
      <div className="composer-wrap">
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
            aria-label="Mensaje"
            placeholder="Dale forma a tu próxima idea…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={12000}
            rows={2}
            disabled={busy}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
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
                disabled={busy}
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
                disabled={!text.trim() || !selectedModel}
              >
                <ArrowUp size={19} />
              </Button>
            )}
          </div>
        </form>
        <p className="composer-note">
          Forma puede equivocarse. Comprueba la información importante.
        </p>
      </div>
    </div>
  );
}
