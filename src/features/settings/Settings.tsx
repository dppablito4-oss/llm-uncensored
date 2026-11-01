import { useState } from "react";
import { Download, Trash2, Moon, Sun } from "lucide-react";
import { useData, useRefresh } from "../../hooks/useData";
import { useUsage } from "../../hooks/useUsage";
import { change, list, remove } from "../../services/data";
import { useUI } from "../../stores/ui";
import { download } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { ModelInfo } from "../../components/ModelInfo";
import { modelPrice, reasoningLevels, findModel } from "../../../shared/models";
import type { Profile, Preset, Model, Conversation } from "../../types";
export function Settings() {
  const { data: profiles = [], error } = useData<Profile>("profiles");
  const { data: models = [] } = useData<Model>("models", "id");
  const { data: presets = [] } = useData<Preset>("presets");
  const { data: usage, error: usageError } = useUsage();
  const profile = profiles[0],
    refresh = useRefresh();
  const { theme, setTheme } = useUI();
  const [notice, setNotice] = useState("");
  async function patch(values: Record<string, unknown>) {
    if (!profile) return;
    try {
      await change("profiles", profile.id, values);
      await refresh();
      setNotice("Preferencias guardadas");
    } catch {
      setNotice("No se pudo guardar. Revisa los límites.");
    }
  }
  async function exportData() {
    try {
      const tables = [
        "profiles",
        "conversations",
        "messages",
        "presets",
        "memories",
        "conversation_summaries",
        "usage_events",
        "image_generations",
      ];
      const data = await Promise.all(
        tables.map((t) =>
          t === "conversation_summaries"
            ? list(t, "updated_at", "conversation_id")
            : list(t),
        ),
      );
      download(
        "forma-datos.json",
        Object.fromEntries(tables.map((t, i) => [t, data[i]])),
      );
      setNotice("Exportación descargada");
    } catch {
      setNotice("No se pudieron exportar los datos");
    }
  }
  return (
    <section className="page settings">
      <span className="eyebrow">A TU MANERA</span>
      <h1>Tu espacio, tus reglas.</h1>
      <p className="muted">
        Ajusta los pequeños detalles que hacen la diferencia.
      </p>
      <p role="status">{notice || error?.message}</p>
      <article className="settings-card">
        <h2>Apariencia</h2>
        <div className="row">
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            onClick={() => setTheme("dark")}
          >
            <Moon size={16} />
            Oscuro
          </Button>
          <Button
            variant={theme === "light" ? "default" : "outline"}
            onClick={() => setTheme("light")}
          >
            <Sun size={16} />
            Claro
          </Button>
        </div>
      </article>
      {profile && (
        <article className="settings-card">
          <h2>Generación predeterminada</h2>
          <div className="form-grid">
            <label>
              Modelo
              <select
                value={profile.default_model}
                onChange={(e) => void patch({ default_model: e.target.value })}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {modelPrice(m.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Preset
              <select
                value={profile.default_preset_id || ""}
                onChange={(e) =>
                  void patch({ default_preset_id: e.target.value || null })
                }
              >
                <option value="">Sin preset</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                {
                  key: "temperature",
                  label: "Temperatura",
                  min: 0,
                  max: 2,
                  step: 0.1,
                },
                { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.05 },
                {
                  key: "max_tokens",
                  label: "Tokens de respuesta",
                  min: 64,
                  max: 8192,
                  step: 1,
                },
                {
                  key: "context_tokens",
                  label: "Presupuesto de contexto",
                  min: 2000,
                  max: 24000,
                  step: 100,
                },
                {
                  key: "memory_tokens",
                  label: "Presupuesto de memoria",
                  min: 0,
                  max: 4000,
                  step: 100,
                },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  key={String(profile[f.key])}
                  type="number"
                  defaultValue={profile[f.key]}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (
                      value !== profile[f.key] &&
                      value >= f.min &&
                      value <= f.max
                    )
                      void patch({ [f.key]: value });
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            Razonamiento predeterminado
            <select
              value={profile.reasoning_effort}
              onChange={(e) => void patch({ reasoning_effort: e.target.value })}
            >
              {reasoningLevels.map((level) => (
                <option
                  key={level}
                  value={level}
                  disabled={
                    level !== "auto" &&
                    !(
                      findModel(profile.default_model)?.reasoning_efforts || []
                    ).includes(level)
                  }
                >
                  {level === "auto" ? "Predeterminado del proveedor" : level}
                </option>
              ))}
            </select>
          </label>
          <ModelInfo id={profile.default_model} />
          <label className="row">
            <input
              type="checkbox"
              checked={profile.auto_summary !== false}
              onChange={(e) => void patch({ auto_summary: e.target.checked })}
            />
            Resumir automáticamente los chats largos
          </label>
          <p className="muted">
            El resumen conserva objetivos, decisiones y preferencias solo dentro
            de cada chat. Se reutiliza junto a los mensajes recientes y no
            elimina el historial. Al actualizarlo se hace como máximo una
            llamada adicional por envío a GLM Flash, con hasta 2048 tokens de
            salida. Su consumo se incluye en las estadísticas y en el costo
            reportado del chat.
          </p>
          <p className="muted">
            Los parámetros del preset tienen prioridad. El contexto usa un
            cálculo conservador por bytes UTF-8, con hasta 60 mensajes
            recientes. Los tokens de respuesta incluyen el razonamiento interno.
            El nivel bajo ayuda a dejar espacio para la respuesta visible; el
            preset activo tiene prioridad.
          </p>
        </article>
      )}
      <article className="settings-card">
        <h2>Uso del chat</h2>
        {usageError && (
          <p role="alert">
            No se pudo consultar el consumo. Actualiza para reintentar.
          </p>
        )}
        {usage && (
          <>
            <p>
              Hoy: {usage.requests_today} solicitudes
              {usage.daily_requests !== null &&
                ` de ${usage.daily_requests}`} ·{" "}
              {usage.tokens_today.toLocaleString()} tokens
              {usage.daily_tokens !== null &&
                ` de ${usage.daily_tokens.toLocaleString()}`}
              .
            </p>
            <p className="muted">
              {usage.daily_tokens === null && usage.daily_requests === null
                ? "Sin cuota diaria de chat en esta app. "
                : `La cuota se reinicia el ${new Date(usage.resets_at).toLocaleString()}. `}
              {usage.reserved_today > 0
                ? `${usage.reserved_today.toLocaleString()} tokens están reservados para solicitudes activas o con consumo sin confirmar.`
                : "Las reservas se liberan al confirmar el consumo del proveedor."}
            </p>
          </>
        )}
        <div className="stats">
          <div>
            <strong>{usage?.requests_total ?? "—"}</strong>
            <span>Solicitudes</span>
          </div>
          <div>
            <strong>{usage?.tokens_total.toLocaleString() ?? "—"}</strong>
            <span>Tokens estimados / reportados</span>
          </div>
          <div>
            <strong>${Number(usage?.cost_total ?? 0).toFixed(4)}</strong>
            <span>Costo reportado disponible</span>
          </div>
        </div>
        <p className="muted">
          Las respuestas sin uso reportado se estiman por bytes. Si no hay costo
          disponible, se omite de la suma. La factura real se consulta en
          NanoGPT.
        </p>
      </article>
      <article className="settings-card">
        <h2>Tus datos</h2>
        <p className="muted small">
          La exportación incluye los metadatos de tus imágenes. Descarga los
          archivos desde la galería.
        </p>
        <div className="row">
          <Button variant="outline" onClick={() => void exportData()}>
            <Download size={16} />
            Exportar todos los datos
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (
                !confirm(
                  "¿Eliminar todas tus conversaciones y mensajes? Esta acción no se puede deshacer.",
                )
              )
                return;
              try {
                const conversations = await list<Conversation>("conversations");
                for (const c of conversations)
                  await remove("conversations", c.id);
                await refresh();
                setNotice("Conversaciones eliminadas");
              } catch {
                setNotice("No se pudieron eliminar todas las conversaciones");
              }
            }}
          >
            <Trash2 size={16} />
            Eliminar conversaciones
          </Button>
        </div>
      </article>
    </section>
  );
}
