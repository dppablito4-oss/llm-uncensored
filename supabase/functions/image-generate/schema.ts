import { z } from "npm:zod@4.6.7";
import { imageModel } from "../../../shared/images.ts";
export const deleteImageRequest = z
  .object({ action: z.literal("delete"), id: z.uuid() })
  .strict();

export const imageRequest = z
  .object({
    request_id: z.uuid(),
    model_id: z.string(),
    prompt: z.string().trim().min(1).max(3000),
    size: z.string(),
    steps: z.number().int().min(1).max(50).default(12),
    cfg_scale: z.number().min(0).max(20).default(7.5),
    seed: z.number().int().min(0).max(2147483647).nullable().default(null),
  })
  .strict()
  .refine(
    (input) =>
      Boolean(imageModel(input.model_id)?.resolutions.includes(input.size)),
    "Modelo o resolución no autorizados",
  );
