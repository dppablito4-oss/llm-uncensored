import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Copy,
  Download,
  Trash2,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useData, useRefresh } from "../../hooks/useData";
import { save, remove } from "../../services/data";
import { download } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import type { Preset, Model } from "../../types";
import { ModelInfo } from "../../components/ModelInfo";
import { defaultModel, modelPrice } from "../../../shared/models";
import { useWatch } from "react-hook-form";
export const presetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400),
  system_prompt: z.string().max(8000),
  model_id: z.string().min(1),
  temperature: z.number().min(0).max(2),
  top_p: z.number().min(0).max(1),
  max_tokens: z.number().int().min(64).max(8192),
  memory_enabled: z.boolean(),
});
const initial = {
  name: "",
  description: "",
  system_prompt: "",
  model_id: defaultModel,
  temperature: 0.7,
  top_p: 1,
  max_tokens: 2048,
  memory_enabled: true,
};
export function Presets() {
  const { data = [], error } = useData<Preset>("presets");
  const { data: models = [] } = useData<Model>("models", "id");
  const refresh = useRefresh();
  const [editing, setEditing] = useState<Preset | null | undefined>();
  const [notice, setNotice] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof presetSchema>>({
    resolver: zodResolver(presetSchema),
    defaultValues: initial,
  });
  const selectedModel = useWatch({ control, name: "model_id" });
  function edit(p: Preset | null) {
    setEditing(p);
    reset(p || initial);
  }
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
      setNotice("Guardado");
      return true;
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "No se pudo guardar. Si el preset está en uso, cambia sus conversaciones y el predeterminado antes de eliminarlo.",
      );
      return false;
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERSONALIZA TU IA</span>
          <h1>Una voz para cada idea.</h1>
          <p className="muted">Define cómo piensa y responde tu asistente.</p>
        </div>
        <Button onClick={() => edit(null)}>
          <Plus size={16} />
          Nuevo preset
        </Button>
      </div>
      <div className="row">
        <label className="button outline">
          <Upload size={16} />
          Importar JSON
          <input
            hidden
            type="file"
            accept="application/json"
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 20000)
                  throw new Error("Archivo demasiado grande");
                const parsed = presetSchema.parse(
                  JSON.parse(await file.text()),
                );
                await run(() => save("presets", parsed));
              } catch {
                setNotice("JSON inválido: revisa los campos y los límites.");
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p role="status">{notice || error?.message}</p>
      <div className="card-grid">
        {data.map((p) => (
          <article className="preset-card" key={p.id}>
            <div className="preset-icon">
              <SlidersHorizontal size={22} />
            </div>
            <h2>{p.name}</h2>
            <p className="muted">
              {p.description || "Tu asistente personalizado"}
            </p>
            <div className="chips">
              <span>{p.max_tokens.toLocaleString()} tokens</span>
              <span>{p.memory_enabled ? "Memoria activa" : "Sin memoria"}</span>
            </div>
            <div className="card-actions">
              <Button variant="outline" onClick={() => edit(p)}>
                Editar
              </Button>
              <Button
                variant="ghost"
                aria-label={`Duplicar ${p.name}`}
                onClick={() =>
                  void run(() =>
                    save("presets", {
                      ...presetSchema.parse(p),
                      name: (p.name + " · copia").slice(0, 80),
                    }),
                  )
                }
              >
                <Copy size={16} />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Exportar ${p.name}`}
                onClick={() => download("preset.json", presetSchema.parse(p))}
              >
                <Download size={16} />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Eliminar ${p.name}`}
                onClick={() => {
                  if (confirm("¿Eliminar este preset?"))
                    void run(() => remove("presets", p.id));
                }}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Modal
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        title="Configurar preset"
      >
        <form
          className="form-grid"
          onSubmit={handleSubmit(async (values) => {
            if (
              await run(() =>
                save("presets", {
                  ...values,
                  ...(editing ? { id: editing.id } : {}),
                }),
              )
            )
              setEditing(undefined);
          })}
        >
          <label>
            Nombre
            <input {...register("name")} />
          </label>
          <label>
            Descripción
            <input {...register("description")} />
          </label>
          <label className="wide">
            Instrucciones del sistema
            <textarea rows={5} {...register("system_prompt")} />
          </label>
          <label className="wide">
            Modelo
            <select {...register("model_id")}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {modelPrice(m.id)}
                </option>
              ))}
            </select>
          </label>
          <div className="wide">
            <ModelInfo id={selectedModel} />
          </div>
          <label>
            Temperatura
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              {...register("temperature", { valueAsNumber: true })}
            />
          </label>
          <label>
            Top P
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              {...register("top_p", { valueAsNumber: true })}
            />
          </label>
          <label>
            Máximo de tokens
            <input
              type="number"
              {...register("max_tokens", { valueAsNumber: true })}
            />
          </label>
          <label className="check">
            <input type="checkbox" {...register("memory_enabled")} />
            Usar memoria
          </label>
          {Object.keys(errors).length > 0 && (
            <p role="alert">
              Revisa los campos: temperatura 0–2, Top P 0–1 y tokens 64–8192.
            </p>
          )}
          <Button disabled={isSubmitting}>Guardar preset</Button>
        </form>
      </Modal>
    </section>
  );
}
