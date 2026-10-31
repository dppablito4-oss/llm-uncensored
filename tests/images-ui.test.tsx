// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Images } from "../src/features/images/Images";
import { qwenImageId } from "../shared/images";

const mock = vi.hoisted(() => ({ generate: vi.fn(), list: vi.fn() }));
vi.mock("../src/services/images", () => ({
  generateImage: mock.generate,
  listImages: mock.list,
  downloadImage: vi.fn(),
  deleteImage: vi.fn(),
  imagePageSize: 24,
}));
beforeEach(() => {
  mock.generate.mockReset().mockResolvedValue("image-id");
  mock.list.mockReset().mockResolvedValue([]);
});
afterEach(() => cleanup());
it("Qwen es predeterminado, muestra USD 0,04 y envía solo sus controles", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Images />
    </QueryClientProvider>,
  );
  expect((screen.getByLabelText("Modelo") as HTMLSelectElement).value).toBe(
    qwenImageId,
  );
  expect(screen.getByText("USD 0.0400 / imagen")).toBeTruthy();
  expect(screen.queryByLabelText("Pasos")).toBeNull();
  expect(screen.queryByLabelText("CFG")).toBeNull();
  expect(screen.queryByLabelText("Semilla (opcional)")).toBeNull();
  await user.selectOptions(screen.getByLabelText("Resolución"), "2k");
  await user.selectOptions(screen.getByLabelText("Proporción"), "16:9");
  await user.type(
    screen.getByLabelText("Descripción de la imagen"),
    "Un gato naranja en una cocina",
  );
  await user.click(screen.getByRole("button", { name: "Generar imagen" }));
  await waitFor(() =>
    expect(mock.generate).toHaveBeenCalledWith({
      model_id: qwenImageId,
      prompt: "Un gato naranja en una cocina",
      size: "2k",
      aspect_ratio: "16:9",
      steps: null,
      cfg_scale: null,
      seed: null,
    }),
  );
  // Model switches must reset incompatible resolutions in both directions.
  await user.selectOptions(screen.getByLabelText("Modelo"), "hassaku-hentai");
  expect((screen.getByLabelText("Resolución") as HTMLSelectElement).value).toBe(
    "1024x1024",
  );
  await user.selectOptions(screen.getByLabelText("Modelo"), qwenImageId);
  expect((screen.getByLabelText("Resolución") as HTMLSelectElement).value).toBe(
    "1k",
  );
  expect((screen.getByLabelText("Proporción") as HTMLSelectElement).value).toBe(
    "1:1",
  );
});
it("selecciona Moxie, muestra el precio por resolución y envía parámetros", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Images />
    </QueryClientProvider>,
  );
  const generate = screen.getByRole("button", {
    name: "Generar imagen",
  }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText("Modelo"), "hassaku-hentai");
  await user.selectOptions(screen.getByLabelText("Resolución"), "512x512");
  expect(screen.getByText("USD 0.0034 / imagen")).toBeTruthy();
  await user.type(
    screen.getByLabelText("Descripción de la imagen"),
    "Un lago entre montañas",
  );
  await user.type(screen.getByLabelText("Semilla (opcional)"), "42");
  await user.click(generate);
  await waitFor(() =>
    expect(mock.generate).toHaveBeenCalledWith({
      model_id: "hassaku-hentai",
      prompt: "Un lago entre montañas",
      size: "512x512",
      steps: 12,
      cfg_scale: 7.5,
      seed: 42,
    }),
  );
  expect(
    await screen.findByText("Imagen guardada en tu galería privada."),
  ).toBeTruthy();
});
