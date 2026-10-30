import { z } from "npm:zod@4.6.7";
export const requestSchema = z
  .object({
    conversation_id: z.uuid(),
    request_id: z.uuid(),
    content: z.string().trim().max(12000).default(""),
    model_id: z.string().max(150),
    preset_id: z.uuid().nullable().default(null),
    action: z.enum(["send", "edit", "regenerate"]).default("send"),
    target_id: z.uuid().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.action !== "regenerate" && !v.content)
      c.addIssue({ code: "custom", message: "Mensaje vacío" });
    if (v.action !== "send" && !v.target_id)
      c.addIssue({ code: "custom", message: "Falta mensaje original" });
  });
