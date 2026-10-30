import { describe, it, expect } from "vitest";
import {
  modelCatalog,
  defaultModel,
  findModel,
  modelPrice,
} from "../shared/models";

describe("Catálogo NanoGPT", () => {
  it("incluye el modelo inicial, IDs únicos y precios en USD por millón", () => {
    expect(modelCatalog[0].id).toBe(defaultModel);
    expect(new Set(modelCatalog.map((model) => model.id)).size).toBe(
      modelCatalog.length,
    );
    expect(modelCatalog.length).toBeGreaterThan(1);
    for (const model of modelCatalog) {
      expect(model.description).not.toBe("");
      expect(model.pricing?.currency).toBe("USD");
      expect(model.pricing?.unit).toBe("per_million_tokens");
      expect(model.pricing?.prompt).toBeGreaterThanOrEqual(0);
      expect(model.pricing?.completion).toBeGreaterThanOrEqual(0);
      expect(model.context_length).toBeGreaterThan(0);
    }
  });
  it("no convierte una tarifa por millón en tarifa por token", () => {
    expect(findModel(defaultModel)?.pricing).toMatchObject({
      prompt: 0.2,
      completion: 0.8,
    });
    expect(modelPrice(defaultModel)).toContain("1M tokens");
    expect(findModel("invented-model")).toBeUndefined();
    expect(modelPrice("invented-model")).toBe("Precio sin publicar");
  });
});
