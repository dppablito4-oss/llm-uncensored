import catalog from "./image-models.json" with { type: "json" };

export type ImageModel = {
  id: string;
  name: string;
  description: string;
  prices: Record<string, number>;
  resolutions: string[];
  max_prompt_characters: number;
};
export const imageModels = catalog.models as ImageModel[];
export const imageModel = (id: string) =>
  imageModels.find((model) => model.id === id);
export const imagePrice = (id: string, size: string) =>
  imageModel(id)?.prices[size] ?? null;
export const imagePriceLabel = (id: string, size: string) => {
  const cost = imagePrice(id, size);
  return cost === null
    ? "Precio sin publicar"
    : `USD ${cost.toFixed(4)} / imagen`;
};
export const imageBucket = "forma-images";
