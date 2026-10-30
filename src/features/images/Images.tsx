import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Download, RefreshCw } from "lucide-react";
import {
  imageModels,
  imageModel,
  imagePriceLabel,
} from "../../../shared/images";
import {
  generateImage,
  listImages,
  downloadImage,
  type ImageGeneration,
} from "../../services/images";
import { Button } from "../../components/ui/button";

export function Images() {
  const [model, setModel] = useState(imageModels[0].id);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [steps, setSteps] = useState(12);
  const [cfg, setCfg] = useState(7.5);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = imageModel(model)!;
  const gallery = useQuery({
    queryKey: ["image-generations"],
    queryFn: listImages,
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.status === "running") ? 5000 : 300000,
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setNotice("Generando tu imagen. Puedes tardar hasta dos minutos.");
    try {
      await generateImage({
        model_id: model,
        prompt: prompt.trim(),
        size,
        steps,
        cfg_scale: cfg,
        seed: seed === "" ? null : Number(seed),
      });
      setNotice("Imagen guardada en tu galería privada.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo generar. Actualiza la galería antes de reintentar.",
      );
    } finally {
      setBusy(false);
      await gallery.refetch();
    }
  }
  async function download(row: ImageGeneration) {
    try {
      await downloadImage(row);
    } catch {
      setNotice("No se pudo descargar. Actualiza la galería y reintenta.");
    }
  }
  return (
    <section className="page image-page">
      <span className="eyebrow">ESTUDIO DE IMÁGENES</span>
      <h1>Dale forma a una imagen.</h1>
      <p className="muted">Describe una escena, elige tu modelo y crea.</p>
      <form
        className="settings-card image-form"
        onSubmit={(event) => void submit(event)}
      >
        <div className="form-grid">
          <label>
            Modelo
            <select
              value={model}
              disabled={busy}
              onChange={(event) => setModel(event.target.value)}
            >
              {imageModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resolución
            <select
              value={size}
              disabled={busy}
              onChange={(event) => setSize(event.target.value)}
            >
              {selected.resolutions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Descripción de la imagen
            <textarea
              rows={4}
              required
              maxLength={3000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Una ciudad flotante al atardecer, estilo anime, luz cálida y detalles arquitectónicos…"
            />
          </label>
          <label>
            Pasos
            <input
              type="number"
              required
              min={1}
              max={50}
              value={steps}
              onChange={(event) => setSteps(Number(event.target.value))}
            />
          </label>
          <label>
            CFG
            <input
              type="number"
              required
              min={0}
              max={20}
              step={0.5}
              value={cfg}
              onChange={(event) => setCfg(Number(event.target.value))}
            />
          </label>
          <label>
            Semilla (opcional)
            <input
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="Aleatoria"
            />
          </label>
          <div className="image-price">
            <strong>{imagePriceLabel(model, size)}</strong>
            <small>Tarifa de lista aproximada · 1 imagen por solicitud</small>
          </div>
        </div>
        <p className="muted small">{selected.description}</p>
        <div className="row">
          <Button disabled={busy || !prompt.trim()}>
            <ImagePlus size={16} />
            {busy ? "Generando…" : "Generar imagen"}
          </Button>
          <small className="muted">
            La semilla no garantiza resultados idénticos. El costo real se
            guarda cuando el proveedor lo reporta.
          </small>
        </div>
      </form>
      <p role="status">{notice || gallery.error?.message}</p>
      <div className="page-heading">
        <div>
          <h2>Tu galería</h2>
          <p className="muted small">
            Las últimas 50 solicitudes. Solo tú puedes acceder a tus imágenes.
          </p>
        </div>
        <Button variant="outline" onClick={() => void gallery.refetch()}>
          <RefreshCw size={15} />
          Actualizar
        </Button>
      </div>
      {gallery.isPending && <p className="muted">Cargando galería…</p>}
      {!gallery.isPending && !gallery.data?.length && (
        <p className="muted">Tu primera imagen empieza con una idea.</p>
      )}
      <div className="image-gallery">
        {gallery.data?.map((row) => (
          <article key={row.id} className="image-result">
            {row.url ? (
              <img src={row.url} alt={row.prompt} loading="lazy" />
            ) : (
              <div className="image-placeholder">
                {row.status === "running"
                  ? "Generando… Actualiza en unos segundos."
                  : row.status === "error"
                    ? "No se completó la imagen"
                    : "Vista previa no disponible. Actualiza la galería."}
              </div>
            )}
            <div className="image-result-info">
              <strong>{imageModel(row.model_id)?.name || row.model_id}</strong>
              <p>{row.prompt}</p>
              <small className="muted">
                {row.size} · {row.steps} pasos · CFG {row.cfg_scale} ·{" "}
                {row.seed === null
                  ? "Semilla aleatoria"
                  : `Semilla ${row.seed}`}
              </small>
              <div className="row">
                <small>
                  {row.cost_usd === null
                    ? "Costo no reportado"
                    : `USD ${Number(row.cost_usd).toFixed(4)}`}
                </small>
                {row.status === "complete" && row.object_path && (
                  <Button variant="ghost" onClick={() => void download(row)}>
                    <Download size={14} />
                    Descargar
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
