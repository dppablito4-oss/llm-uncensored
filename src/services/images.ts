import { supabase } from "../lib/supabase";
import { imageBucket } from "../../shared/images";

export type ImageGeneration = {
  id: string;
  model_id: string;
  prompt: string;
  size: string;
  steps: number;
  cfg_scale: number;
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
  steps: number;
  cfg_scale: number;
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
export async function listImages(): Promise<ImageGeneration[]> {
  const { data, error } = await supabase
    .from("image_generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
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
