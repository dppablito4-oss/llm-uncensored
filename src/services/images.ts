import { supabase } from "../lib/supabase";
import { imageBucket } from "../../shared/images";

export type ImageGeneration = {
  id: string;
  model_id: string;
  prompt: string;
  size: string;
  steps: number | null;
  cfg_scale: number | null;
  aspect_ratio: string;
  seed: number | null;
  status: "running" | "complete" | "error";
  object_path: string | null;
  cost_usd: number | null;
  created_at: string;
  url?: string;
};
export type ImageInput = {
  model_id: string;
  prompt: string;
  size: string;
  steps: number | null;
  cfg_scale: number | null;
  aspect_ratio?: string;
  seed: number | null;
};
export async function generateImage(input: ImageInput) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Inicia sesión de nuevo");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-generate`,
    {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...input, request_id: crypto.randomUUID() }),
      signal: AbortSignal.timeout(125000),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "No se pudo generar la imagen");
  return result.id as string;
}
export const imagePageSize = 24;
export async function listImages(page = 0): Promise<ImageGeneration[]> {
  const { data, error } = await supabase
    .from("image_generations")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page * imagePageSize, (page + 1) * imagePageSize - 1);
  if (error) throw error;
  return Promise.all(
    (data as ImageGeneration[]).map(async (row) => {
      if (!row.object_path || row.status !== "complete") return row;
      const signed = await supabase.storage
        .from(imageBucket)
        .createSignedUrl(row.object_path, 3600);
      return { ...row, url: signed.data?.signedUrl };
    }),
  );
}
export async function deleteImage(id: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Inicia sesión de nuevo");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-generate`,
    {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "delete", id }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(
      (await response.json()).error || "No se pudo eliminar la imagen",
    );
}
export async function downloadImage(row: ImageGeneration) {
  if (!row.object_path) return;
  const { data, error } = await supabase.storage
    .from(imageBucket)
    .download(row.object_path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `forma-${row.id}.${row.object_path.split(".").at(-1)}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
