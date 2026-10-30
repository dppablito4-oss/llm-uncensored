import { useState } from "react";
import { z } from "zod";
import { Brain, Plus, Trash2, Pencil } from "lucide-react";
import { useData, useRefresh } from "../../hooks/useData";
import { save, remove, change } from "../../services/data";
import type { Memory as MemoryType, Profile } from "../../types";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
export const memorySchema = z.object({
  content: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
});
export function Memory() {
  const { data = [], error } = useData<MemoryType>("memories");
  const { data: profiles = [] } = useData<Profile>("profiles");
  const profile = profiles[0];
  const refresh = useRefresh();
  const [editing, setEditing] = useState<MemoryType | null | undefined>();
  const [content, setContent] = useState(""),
    [category, setCategory] = useState("general"),
    [notice, setNotice] = useState("");
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
      setNotice("Cambios guardados");
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo guardar");
      return false;
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONTINUIDAD, CON TU PERMISO</span>
          <h1>Lo que importa, permanece.</h1>
          <p className="muted">
            Tú decides qué recordar. Nunca se crean memorias automáticamente.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setContent("");
            setCategory("general");
          }}
        >
          <Plus size={16} />
          Añadir memoria
        </Button>
      </div>
      <div className="info-card">
        <Brain />
        <div>
          <strong>
            Tu memoria está {profile?.memory_enabled ? "activa" : "desactivada"}
          </strong>
          <p>
            Se incluyen las memorias activas más recientes, hasta el presupuesto
            configurado. El preset también puede desactivarlas.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!profile}
          onClick={() =>
            profile &&
            void run(() =>
              change("profiles", profile.id, {
                memory_enabled: !profile.memory_enabled,
              }),
            )
          }
        >
          {profile?.memory_enabled ? "Desactivar" : "Activar"}
        </Button>
      </div>
      <p role="status">{notice || error?.message}</p>
      {data.length === 0 && (
        <div className="empty">
          <Brain size={32} />
          <h2>Un espacio para lo esencial</h2>
          <p>
            Preferencias, proyectos o detalles que quieras aportar a tus
            conversaciones.
          </p>
        </div>
      )}
      <div className="memory-list">
        {data.map((m) => (
          <article className="memory-card" key={m.id}>
            <input
              aria-label="Activar memoria"
              type="checkbox"
              checked={m.enabled}
              onChange={() =>
                void run(() =>
                  change("memories", m.id, { enabled: !m.enabled }),
                )
              }
            />
            <div>
              <span className="eyebrow">{m.category}</span>
              <p>{m.content}</p>
            </div>
            <Button
              variant="ghost"
              aria-label="Editar memoria"
              onClick={() => {
                setEditing(m);
                setContent(m.content);
                setCategory(m.category);
              }}
            >
              <Pencil size={16} />
            </Button>
            <Button
              variant="ghost"
              aria-label="Eliminar memoria"
              onClick={() => {
                if (confirm("¿Eliminar esta memoria?"))
                  void run(() => remove("memories", m.id));
              }}
            >
              <Trash2 size={16} />
            </Button>
          </article>
        ))}
      </div>
      <Modal
        title="Memoria explícita"
        open={editing !== undefined}
        onOpenChange={(o) => {
          if (!o) setEditing(undefined);
        }}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = memorySchema.safeParse({
              content,
              category,
              enabled: editing?.enabled ?? true,
            });
            if (!parsed.success) {
              setNotice(
                "Escribe entre 1 y 2000 caracteres y una categoría de hasta 60.",
              );
              return;
            }
            if (
              await run(() =>
                save("memories", {
                  ...parsed.data,
                  ...(editing ? { id: editing.id } : {}),
                }),
              )
            )
              setEditing(undefined);
          }}
        >
          <label>
            Categoría
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={60}
            />
          </label>
          <label>
            Qué quieres recordar
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              maxLength={2000}
              required
            />
          </label>
          <p className="muted">
            Al activarla, autorizas enviar esta información al modelo elegido.
          </p>
          <Button>Guardar memoria</Button>
        </form>
      </Modal>
    </section>
  );
}
