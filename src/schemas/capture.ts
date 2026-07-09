import { z } from "zod";

export const CaptureSchema = z.object({
  url: z.string().url(),

  width: z.number().min(320).max(4000).default(1920),

  height: z.number().min(200).max(4000).default(1080),

  format: z.enum([
    "png",
    "jpeg",
    "webp"
  ]).default("png"),

  fullPage: z.boolean().default(false)
});

export type CaptureRequest = z.infer<typeof CaptureSchema>;
