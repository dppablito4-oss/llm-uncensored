import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  NavLink,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  MessageSquare,
  SlidersHorizontal,
  Brain,
  Settings as SettingsIcon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Archive,
  Trash2,
  Pencil,
  ArrowUpRight,
  Image as ImageIcon,
} from "lucide-react";
import { supabase, configured } from "../lib/supabase";
import { Auth } from "../features/auth/Auth";
import { Chat } from "../features/chat/Chat";
import { Presets } from "../features/presets/Presets";
import { Memory } from "../features/memory/Memory";
import { Settings } from "../features/settings/Settings";
import { Images } from "../features/images/Images";
import { useUI } from "../stores/ui";
import { useData } from "../hooks/useData";
import { change, remove } from "../services/data";
import { Button } from "../components/ui/button";
import type { Conversation } from "../types";
function Workspace({ session }: { session: Session }) {
  const { sidebar, toggle } = useUI(),
    client = useQueryClient(),
    navigate = useNavigate();
  const { data = [], error } = useData<Conversation>(
    "conversations",
    "updated_at",
  );
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [notice, setNotice] = useState("");
  async function mutate(fn: () => Promise<unknown>) {
    try {
      await fn();
      await client.invalidateQueries();
    } catch {
      setNotice("No se pudo guardar el cambio");
    }
  }
  return (
    <div className={`workspace ${sidebar ? "" : "collapsed"}`}>
      <aside
        className="sidebar"
        onClick={(event) => {
          if (
            window.innerWidth <= 700 &&
            sidebar &&
            (event.target as HTMLElement).closest("a")
          )
            toggle();
        }}
      >
        <div className="brand">
          ✳ forma<span>AI WORKSPACE</span>
        </div>
        <Button className="new-chat" variant="outline" asChild>
          <NavLink to="/chat">
            <Plus size={17} />
            Nueva conversación<span>↗</span>
          </NavLink>
        </Button>
        <nav className="main-nav">
          <NavLink to="/chat">
            <MessageSquare size={17} />
            Conversaciones
          </NavLink>
          <NavLink to="/presets">
            <SlidersHorizontal size={17} />
            Mis presets
          </NavLink>
          <NavLink to="/memory">
            <Brain size={17} />
            Memoria
          </NavLink>
          <NavLink to="/images">
            <ImageIcon size={17} />
            Imágenes
          </NavLink>
        </nav>
        <div className="history-title">
          <span>{archived ? "ARCHIVADAS" : "RECIENTES"}</span>
          <button
            aria-label="Mostrar archivadas"
            onClick={() => setArchived(!archived)}
          >
            <Archive size={14} />
          </button>
        </div>
        <div className="search">
          <Search size={14} />
          <input
            aria-label="Buscar conversaciones"
            placeholder="Buscar conversación"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="history">
          {data
            .filter(
              (c) =>
                Boolean(c.archived_at) === archived &&
                c.title.toLowerCase().includes(search.toLowerCase()),
            )
            .map((c) => (
              <div className="history-item" key={c.id}>
                <NavLink to={"/chat/" + c.id}>{c.title}</NavLink>
                <div className="history-actions">
                  <button
                    aria-label="Renombrar conversación"
                    onClick={() => {
                      const title = prompt(
                        "Nombre de la conversación",
                        c.title,
                      );
                      if (title?.trim())
                        void mutate(() =>
                          change("conversations", c.id, {
                            title: title.trim().slice(0, 160),
                          }),
                        );
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    aria-label={
                      archived
                        ? "Recuperar conversación"
                        : "Archivar conversación"
                    }
                    onClick={() =>
                      void mutate(() =>
                        change("conversations", c.id, {
                          archived_at: archived
                            ? null
                            : new Date().toISOString(),
                        }),
                      )
                    }
                  >
                    <Archive size={12} />
                  </button>
                  <button
                    aria-label="Eliminar conversación"
                    onClick={() => {
                      if (
                        confirm("¿Eliminar esta conversación y sus mensajes?")
                      )
                        void mutate(async () => {
                          await remove("conversations", c.id);
                          navigate("/chat");
                        });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          {data.length === 0 && (
            <p className="muted small">Tus conversaciones aparecerán aquí.</p>
          )}
          {(notice || error) && <p role="alert">{notice || error?.message}</p>}
        </div>
        <div className="sidebar-tip">
          <span>UN ESPACIO QUE TE CONOCE</span>
          <p>
            Guarda lo importante.
            <br />
            Continúa desde ahí.
          </p>
          <NavLink to="/memory">
            Explorar memoria <ArrowUpRight size={14} />
          </NavLink>
        </div>
        <div className="account">
          <div className="avatar">{session.user.email?.[0]?.toUpperCase()}</div>
          <div>
            <strong>Mi espacio</strong>
            <small>{session.user.email}</small>
          </div>
          <Button
            variant="ghost"
            aria-label="Cerrar sesión"
            onClick={() => void supabase.auth.signOut()}
          >
            <LogOut size={16} />
          </Button>
        </div>
        <NavLink className="settings-link" to="/settings">
          <SettingsIcon size={16} />
          Configuración
        </NavLink>
      </aside>
      {sidebar && (
        <button
          className="mobile-shade"
          aria-label="Cerrar menú"
          onClick={toggle}
        />
      )}
      <main>
        <button
          className="toggle-sidebar"
          onClick={toggle}
          aria-label="Alternar menú"
        >
          {sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <Routes>
          <Route
            path="/chat"
            element={<Chat key="new" userId={session.user.id} />}
          />
          <Route
            path="/chat/:id"
            element={<ChatRoute userId={session.user.id} />}
          />
          <Route path="/presets" element={<Presets />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/images" element={<Images />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  );
}
function ChatRoute({ userId }: { userId: string }) {
  // Remount on conversation navigation to abort any active request.
  const location = useLocation().pathname;
  return <Chat key={location} userId={userId} />;
}
export function App() {
  const { theme } = useUI(),
    client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [readyUser, setReadyUser] = useState<string | null>(null),
    [setupError, setSetupError] = useState(""),
    [recovery, setRecovery] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
      if (event === "SIGNED_OUT") client.clear();
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    let active = true;
    if (!session) return;
    void supabase.rpc("ensure_workspace").then(({ error }) => {
      if (!active) return;
      if (error)
        setSetupError(
          "No se pudo preparar tu espacio. Recarga para reintentar.",
        );
      else {
        setSetupError("");
        setReadyUser(session.user.id);
      }
    });
    return () => {
      active = false;
    };
  }, [session]);
  if (!configured)
    return (
      <div className="setup">
        <div className="brand">
          ✳ forma<span>AI WORKSPACE</span>
        </div>
        <h1>
          Tu próximo espacio
          <br />
          empieza aquí.
        </h1>
        <p>El proyecto está listo para conectar con tu backend.</p>
        <ol>
          <li>
            Copia <code>.env.example</code> a <code>.env</code>.
          </li>
          <li>Configura la URL y la clave pública de Supabase.</li>
          <li>
            Aplica las migraciones y despliega <code>chat-stream</code>.
          </li>
          <li>Guarda la clave de NanoGPT como secreto del backend.</li>
        </ol>
        <p className="muted">
          Consulta README.md para los pasos completos. No se simulan respuestas
          de IA.
        </p>
      </div>
    );
  if (loading) return <div className="loading">Cargando tu espacio…</div>;
  if (session && readyUser !== session.user.id && !recovery)
    return (
      <div className="loading" role={setupError ? "alert" : "status"}>
        {setupError || "Preparando tu espacio…"}
      </div>
    );
  return session && !recovery ? (
    <Workspace key={session.user.id} session={session} />
  ) : (
    <Auth recovery={recovery} />
  );
}
