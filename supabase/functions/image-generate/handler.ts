import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { imageRequest } from "./schema.ts";
import { imageBucket } from "../../../shared/images.ts";

async function limitedBody(
  response: Response | Request,
  max: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new Error("BODY_LIMIT");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function decodeImage(encoded: string) {
  if (encoded.length > 28_000_000) throw new Error("IMAGE_LIMIT");
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  if (bytes.length > 20 * 1024 * 1024) throw new Error("IMAGE_LIMIT");
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, i) => bytes[i] === value,
  );
  if (png) return { bytes, mime: "image/png", extension: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { bytes, mime: "image/jpeg", extension: "jpg" };
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return { bytes, mime: "image/webp", extension: "webp" };
  throw new Error("INVALID_IMAGE");
}

export async function imageHandler(
  req: Request,
  env: (name: string) => string | undefined,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const origins = (env("FORMA_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim());
  const headers = {
    "Access-Control-Allow-Origin":
      origin && origins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
  };
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  if (!origin || !origins.includes(origin))
    return json({ error: "Origen no autorizado" }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const required = (name: string) => {
    const value = env(name);
    if (!value) throw new Error("CONFIGURATION");
    return value;
  };
  try {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer "))
      return json({ error: "Inicia sesión" }, 401);
    const db = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_ANON_KEY"),
      { auth: { persistSession: false } },
    );
    const {
      data: { user },
      error,
    } = await db.auth.getUser(auth.slice(7));
    if (error || !user)
      return json({ error: "Sesión inválida o caducada" }, 401);
    let parsed;
    try {
      parsed = imageRequest.safeParse(
        JSON.parse(new TextDecoder().decode(await limitedBody(req, 24000))),
      );
    } catch {
      return json({ error: "Solicitud inválida o demasiado grande" }, 400);
    }
    if (!parsed.success)
      return json(
        { error: "Revisa el modelo, prompt, resolución y parámetros" },
        400,
      );
    const input = parsed.data;
    const key = required("LLM_UNC_API_KEY");
    const admin = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { db: { schema: "forma" }, auth: { persistSession: false } },
    );
    const { data: id, error: reserveError } = await admin.rpc(
      "begin_image_generation",
      {
        p_uid: user.id,
        p_request: input.request_id,
        p_model: input.model_id,
        p_prompt: input.prompt,
        p_size: input.size,
        p_steps: input.steps,
        p_cfg: input.cfg_scale,
        p_seed: input.seed,
      },
    );
    if (reserveError) {
      const message = reserveError.message;
      const limit = /RATE_LIMIT|DAILY_LIMIT/.test(message);
      return json(
        {
          error: limit
            ? "Alcanzaste el límite de imágenes. Espera o revisa tu cuota diaria."
            : "No se puede iniciar otra generación. Actualiza la galería antes de reintentar.",
        },
        limit ? 429 : 409,
      );
    }
    let cost: number | null = null;
    let objectPath: string | null = null;
    try {
      const response = await fetch(
        "https://nano-gpt.com/api/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model_id,
            prompt: input.prompt,
            size: input.size,
            n: 1,
            response_format: "b64_json",
            num_inference_steps: input.steps,
            guidance_scale: input.cfg_scale,
            ...(input.seed !== null ? { seed: input.seed } : {}),
          }),
          signal: AbortSignal.timeout(100000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`PROVIDER_${response.status}`);
      }
      const result = JSON.parse(
        new TextDecoder().decode(await limitedBody(response, 30_000_000)),
      );
      if (
        typeof result.cost === "number" &&
        Number.isFinite(result.cost) &&
        result.cost >= 0
      )
        cost = result.cost;
      const encoded = result.data?.[0]?.b64_json;
      if (typeof encoded !== "string") throw new Error("MISSING_IMAGE");
      const image = decodeImage(encoded);
      objectPath = `${user.id}/${id}.${image.extension}`;
      const { error: uploadError } = await admin.storage
        .from(imageBucket)
        .upload(objectPath, image.bytes, {
          contentType: image.mime,
          upsert: false,
        });
      if (uploadError) throw new Error("STORAGE_ERROR");
      const { error: saveError } = await admin
        .from("image_generations")
        .update({ status: "complete", object_path: objectPath, cost_usd: cost })
        .eq("id", id);
      if (saveError) throw new Error("PERSISTENCE_ERROR");
      return json({ id });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "GENERATION_ERROR";
      const code =
        /^(PROVIDER_\d{3}|STORAGE_ERROR|PERSISTENCE_ERROR|MISSING_IMAGE|INVALID_IMAGE|IMAGE_LIMIT)$/.test(
          raw,
        )
          ? raw
          : "GENERATION_ERROR";
      await admin
        .from("image_generations")
        .update({
          status: "error",
          error_code: code,
          cost_usd: cost,
          object_path: objectPath,
        })
        .eq("id", id);
      return json(
        {
          error:
            code === "PROVIDER_402"
              ? "NanoGPT no tiene saldo suficiente."
              : code === "PROVIDER_429"
                ? "NanoGPT está limitando solicitudes. Intenta más tarde."
                : "No se pudo completar la imagen. Revisa la galería antes de volver a generar.",
        },
        502,
      );
    }
  } catch {
    return json(
      { error: "Error de configuración del servidor de imágenes" },
      500,
    );
  }
}
