import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  imageHandler,
  decodeImage,
  providerImage,
} from "../supabase/functions/image-generate/handler";
import { imageRequest } from "../supabase/functions/image-generate/schema";
import { imageModels, imagePrice, qwenImageId } from "../shared/images";

const uid = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const env = (name: string) =>
  ({
    SUPABASE_URL: "https://backend.test",
    SUPABASE_ANON_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "PRIVATE_SERVICE_SECRET",
    LLM_UNC_API_KEY: "PRIVATE_IMAGE_SECRET",
    FORMA_ALLOWED_ORIGINS: "https://allowed.test",
  })[name];
const input = () => ({
  request_id: crypto.randomUUID(),
  model_id: "nsfw-gen-illustrious",
  prompt: "An alpine lake",
  size: "1024x1024",
  steps: 12,
  cfg_scale: 7.5,
  seed: null,
});
const request = (data: unknown = input(), origin = "https://allowed.test") =>
  new Request("https://backend.test/functions/v1/image-generate", {
    method: "POST",
    headers: {
      origin,
      authorization: "Bearer user-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
const json = (value: unknown, status = 200) => Response.json(value, { status });
let authenticated = true,
  providerStatus = 200,
  reserveError = false,
  deleteOwner = true,
  deleteRunning = false,
  removed = 0;
let finished: Record<string, unknown> | undefined,
  body: Record<string, unknown> | undefined;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
beforeEach(() => {
  authenticated = true;
  providerStatus = 200;
  reserveError = false;
  deleteOwner = true;
  deleteRunning = false;
  removed = 0;
  finished = undefined;
  body = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/auth/v1/user"))
        return authenticated
          ? json({ id: uid })
          : json({ message: "invalid" }, 401);
      if (path.includes("/rpc/begin_image_generation"))
        return reserveError ? json({ message: "DAILY_LIMIT" }, 400) : json(id);
      if (path === "https://nano-gpt.com/api/v1/images/generations") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer PRIVATE_IMAGE_SECRET",
        );
        body = JSON.parse(String(init?.body));
        return providerStatus === 200
          ? json({ data: [{ b64_json: png }], cost: 0.0051 })
          : json(
              { message: "PRIVATE_IMAGE_SECRET upstream debug" },
              providerStatus,
            );
      }
      if (path.includes("/storage/v1/object/forma-images/"))
        return json({ Key: "stored" });
      if (
        path.endsWith("/storage/v1/object/forma-images") &&
        init?.method === "DELETE"
      ) {
        removed++;
        return json([]);
      }
      if (path.includes("/rest/v1/image_generations")) {
        if (!init?.method || init.method === "GET") {
          expect(new URL(path).searchParams.get("user_id")).toBe(`eq.${uid}`);
          return json(
            deleteOwner
              ? {
                  id,
                  object_path: `${uid}/${id}.png`,
                  status: deleteRunning ? "running" : "complete",
                  created_at: new Date().toISOString(),
                }
              : null,
          );
        }
        finished = JSON.parse(String(init?.body));
        return json(null);
      }
      throw new Error("Unexpected URL " + path);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Imagen NanoGPT, validación y frontera de secretos", () => {
  it("elimina archivo y prompt propios manteniendo el evento de consumo", async () => {
    const response = await imageHandler(request({ action: "delete", id }), env);
    expect(response.status).toBe(200);
    expect(removed).toBe(1);
    expect(body).toBeUndefined();
    expect(finished).toMatchObject({
      object_path: null,
      prompt: "[Imagen eliminada]",
    });
    expect(finished?.deleted_at).toBeTruthy();
    expect(finished).not.toHaveProperty("cost_usd");
  });
  it("no elimina archivos ajenos ni generaciones todavía activas", async () => {
    deleteOwner = false;
    expect(
      (await imageHandler(request({ action: "delete", id }), env)).status,
    ).toBe(404);
    expect(removed).toBe(0);
    deleteOwner = true;
    deleteRunning = true;
    expect(
      (await imageHandler(request({ action: "delete", id }), env)).status,
    ).toBe(409);
    expect(removed).toBe(0);
    expect(finished).toBeUndefined();
  });
  it("envía el ID real y parámetros, guarda el archivo y registra el costo", async () => {
    const response = await imageHandler(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id });
    expect(body).toMatchObject({
      model: "nsfw-gen-illustrious",
      n: 1,
      response_format: "b64_json",
      num_inference_steps: 12,
      guidance_scale: 7.5,
    });
    expect(finished).toMatchObject({
      status: "complete",
      cost_usd: 0.0051,
      object_path: `${uid}/${id}.png`,
    });
  });
  it("rechaza origen ajeno antes de consultar Auth", async () => {
    expect(
      (await imageHandler(request(input(), "https://evil.test"), env)).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("exige autenticación antes de gastar", async () => {
    authenticated = false;
    expect((await imageHandler(request(), env)).status).toBe(401);
    expect(body).toBeUndefined();
  });
  it("respeta la reserva de cuota sin llamar al proveedor", async () => {
    reserveError = true;
    expect((await imageHandler(request(), env)).status).toBe(429);
    expect(body).toBeUndefined();
  });
  it("registra el error sin filtrar el cuerpo privado del proveedor", async () => {
    providerStatus = 402;
    const response = await imageHandler(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("PRIVATE_");
    expect(finished).toMatchObject({
      status: "error",
      error_code: "PROVIDER_402",
    });
  });
  it("solo acepta los modelos, resoluciones y controles permitidos", () => {
    expect(imageModels.map((model) => model.name)).toEqual([
      "Qwen Image 3 Uncensored",
      "Animagine XL 4.0",
      "Moxie Diffusion XL",
    ]);
    expect(imagePrice("nsfw-gen-illustrious", "512x512")).toBe(0.0034);
    for (const patch of [
      { model_id: "invented" },
      { size: "9999x9999" },
      { steps: 1000 },
      { prompt: " " },
      { prompt: "x".repeat(3001) },
      { n: 20 },
      { cfg_scale: 100 },
    ])
      expect(imageRequest.safeParse({ ...input(), ...patch }).success).toBe(
        false,
      );
  });
  it("envía a Qwen resolución y proporción sin controles de difusión", async () => {
    const response = await imageHandler(
      request({
        request_id: crypto.randomUUID(),
        model_id: qwenImageId,
        prompt: "Una cámara roja sobre una mesa",
        size: "2k",
        aspect_ratio: "16:9",
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      model: qwenImageId,
      size: "2k",
      aspect_ratio: "16:9",
      n: 1,
    });
    expect(body).not.toHaveProperty("num_inference_steps");
    expect(body).not.toHaveProperty("guidance_scale");
    expect(body).not.toHaveProperty("seed");
  });
  it("valida límites y parámetros específicos de Qwen", () => {
    const qwen = {
      request_id: crypto.randomUUID(),
      model_id: qwenImageId,
      prompt: "x".repeat(10000),
      size: "1k",
      aspect_ratio: "4:5",
    };
    expect(imageRequest.safeParse(qwen).success).toBe(true);
    expect(imagePrice(qwenImageId, "2k")).toBe(0.04);
    for (const patch of [
      { size: "1024x1024" },
      { aspect_ratio: "7:3" },
      { steps: 12 },
      { cfg_scale: 7.5 },
      { seed: 42 },
      { prompt: "x".repeat(10001) },
    ])
      expect(imageRequest.safeParse({ ...qwen, ...patch }).success).toBe(false);
    expect(imageRequest.safeParse({ ...input(), size: "1k" }).success).toBe(
      false,
    );
  });
  it("rechaza archivos que no sean PNG, JPEG o WebP", () => {
    expect(decodeImage(png).mime).toBe("image/png");
    expect(() => decodeImage(btoa("<script>alert(1)</script>"))).toThrow(
      "INVALID_IMAGE",
    );
  });
  it("descarga la imagen firmada devuelta por el proveedor sin enviar credenciales", async () => {
    const download = vi.fn(
      async () =>
        new Response(Uint8Array.from(atob(png), (char) => char.charCodeAt(0))),
    );
    vi.stubGlobal("fetch", download);
    const image = await providerImage({
      url: "https://media.provider.test/image.png?signature=private",
    });
    expect(image.mime).toBe("image/png");
    expect(download).toHaveBeenCalledWith(
      "https://media.provider.test/image.png?signature=private",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(download.mock.calls[0]).toHaveLength(2);
    await expect(
      providerImage({ url: "http://media.provider.test/image.png" }),
    ).rejects.toThrow("INVALID_IMAGE_URL");
    await expect(
      providerImage({ url: "https://127.0.0.1/image.png" }),
    ).rejects.toThrow("INVALID_IMAGE_URL");
    await expect(
      providerImage({ url: "https://localhost/image.png" }),
    ).rejects.toThrow("INVALID_IMAGE_URL");
    expect(download).toHaveBeenCalledTimes(1);
  });
});
