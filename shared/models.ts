import catalog from "./model-catalog.json" with { type: "json" };

export type CatalogModel = {
  id: string;
  name: string;
  description: string;
  context_length: number | null;
  max_output_tokens: number | null;
  pricing: {
    prompt?: number;
    completion?: number;
    cacheReadInputPer1kTokens?: number;
    currency?: string;
    unit?: string;
  } | null;
  capabilities: Record<string, boolean>;
  reasoning_efforts: string[];
};
export const modelCatalog = catalog.models as CatalogModel[];
export const defaultModel = catalog.default_model;
export const catalogDate = catalog.fetched_at;
export const catalogSource = catalog.source;
export const findModel = (id: string) =>
  modelCatalog.find((model) => model.id === id);
export const reasoningLevels = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export function modelReasoning(id: string, requested = "low") {
  const levels = findModel(id)?.reasoning_efforts || [];
  if (requested === "auto" || !levels.length) return undefined;
  return levels.includes(requested)
    ? requested
    : levels.includes("low")
      ? "low"
      : levels[0];
}
const price = (value: number | undefined) =>
  value === undefined
    ? "sin publicar"
    : new Intl.NumberFormat("es-PE", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(value);
export const modelPrice = (id: string) => {
  const model = findModel(id);
  return model
    ? `${price(model.pricing?.prompt)} entrada / ${price(model.pricing?.completion)} salida · 1M tokens`
    : "Precio sin publicar";
};
