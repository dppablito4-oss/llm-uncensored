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
