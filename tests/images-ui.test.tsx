// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Images } from "../src/features/images/Images";
import { imageModels } from "../shared/images";

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
  await user.selectOptions(screen.getByLabelText("Modelo"), imageModels[1].id);
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
