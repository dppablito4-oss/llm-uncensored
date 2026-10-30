import {
  findModel,
  modelPrice,
  catalogDate,
  catalogSource,
} from "../../shared/models";

export function ModelInfo({ id }: { id: string }) {
  const model = findModel(id);
  if (!model) return null;
  return (
    <details className="model-info">
      <summary>
        {model.name} · {modelPrice(id)}
      </summary>
      <p>{model.description}</p>
      <dl>
        <div>
          <dt>Contexto del modelo</dt>
          <dd>
            {model.context_length?.toLocaleString("es-PE") ?? "Sin publicar"}{" "}
            tokens
          </dd>
        </div>
        <div>
          <dt>Salida máxima del modelo</dt>
          <dd>
            {model.max_output_tokens?.toLocaleString("es-PE") ?? "Sin publicar"}
          </dd>
        </div>
        <div>
          <dt>Razonamiento</dt>
          <dd>
            {model.capabilities.reasoning ? "Sí" : "No"}
            {model.reasoning_efforts.length
              ? ` · ${model.reasoning_efforts.join(", ")}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Capacidades del proveedor</dt>
          <dd>
            {[
              model.capabilities.vision && "Visión",
              model.capabilities.tool_calling && "Herramientas",
              model.capabilities.structured_output && "JSON estructurado",
            ]
              .filter(Boolean)
              .join(" · ") || "Chat de texto"}
          </dd>
        </div>
      </dl>
      <p>
        Este chat envía texto. Ajusta temperatura (0–2), Top P (0–1) y máximo de
        salida en Configuración o en tu preset. Límites de esta app: hasta 24
        000 tokens de contexto y 8 192 de salida, sujetos al máximo del modelo.
      </p>
      <small>
        Tarifas de lista en USD por millón de tokens; pueden cambiar.{" "}
        <a href={catalogSource} target="_blank" rel="noreferrer">
          Catálogo
        </a>{" "}
        consultado el{" "}
        {new Date(catalogDate).toLocaleDateString("es-PE", {
          timeZone: "America/Lima",
        })}
        .
      </small>
    </details>
  );
}
