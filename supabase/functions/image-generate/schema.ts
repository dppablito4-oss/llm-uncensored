import { z } from "npm:zod@4.6.7";
import { imageModel, qwenImageId } from "../../../shared/images.ts";
export const deleteImageRequest = z
  .object({ action: z.literal("delete"), id: z.uuid() })
  .strict();

const legacyRequest = z
  .object({
    request_id: z.uuid(),
    model_id: z.enum(["nsfw-gen-illustrious", "hassaku-hentai"]),
    prompt: z.string().trim().min(1).max(3000),
    size: z.string(),
    steps: z.number().int().min(1).max(50).default(12),
    cfg_scale: z.number().min(0).max(20).default(7.5),
    seed: z.number().int().min(0).max(2147483647).nullable().default(null),
    aspect_ratio: z.literal("1:1").default("1:1"),
  })
  .strict()
  .refine(
    (input) =>
      Boolean(imageModel(input.model_id)?.resolutions.includes(input.size)),
    "Modelo o resolución no autorizados",
  );
const qwenRequest = z
  .object({
    request_id: z.uuid(),
    model_id: z.literal(qwenImageId),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .refine((text) => Array.from(text).length <= 10000),
    size: z.enum(["1k", "2k"]),
    aspect_ratio: z
      .enum(["1:1", "3:2", "16:9", "21:9", "9:16", "2:3", "3:4", "4:5"])
      .default("1:1"),
    steps: z.null().default(null),
    cfg_scale: z.null().default(null),
    seed: z.null().default(null),
  })
  .strict();
export const imageRequest = z.union([qwenRequest, legacyRequest]);
