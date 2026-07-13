import { z } from "zod";
import { env } from "../config/env.js";

/** Timeframes the Coinalyze widget accepts (verified via getIntervals()). */
export const TIMEFRAMES = [
  "1",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "360",
  "720",
  "1D",
  "1W",
  "1M",
] as const;

export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/**
 * Human-friendly timeframe aliases mapped onto widget resolutions.
 * Both the raw resolution ("60") and the alias ("1h") are accepted.
 */
export const TIMEFRAME_ALIASES: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "1D",
  d: "1D",
  daily: "1D",
  "1w": "1W",
  w: "1W",
  weekly: "1W",
  "1mo": "1M",
  monthly: "1M",
};

const timeframeSchema = z
  .string()
  .trim()
  .default("1D")
  .transform((value) =>
    // Canonical resolutions are matched case-sensitively FIRST so monthly
    // ("1M") isn't captured by the lower-cased 1-minute alias ("1m").
    (TIMEFRAMES as readonly string[]).includes(value)
      ? value
      : (TIMEFRAME_ALIASES[value.toLowerCase()] ?? value),
  )
  .refine(
    (value): value is (typeof TIMEFRAMES)[number] =>
      (TIMEFRAMES as readonly string[]).includes(value),
    {
      message: `timeframe must be one of ${TIMEFRAMES.join(", ")} (or an alias like 1h, 4h, daily)`,
    },
  );

const indicatorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  inputs: z.array(z.union([z.string(), z.number(), z.boolean()])).max(20).default([]),
  overlay: z.boolean().default(false),
});

export const CaptureSchema = z.object({
  /**
   * Market to chart: a friendly slug ("bitcoin", "btc") or a raw widget
   * symbol ("BTC_AVGPRICE"). Resolved in services/symbols.ts.
   */
  symbol: z.string().trim().min(1).max(60).default("bitcoin"),

  /** Coinalyze metric page to load, e.g. "open-interest", "funding-rate". */
  metric: z.string().trim().min(1).max(60).default("open-interest"),

  timeframe: timeframeSchema,

  indicators: z.array(indicatorSchema).max(10).default([]),

  width: z.coerce.number().int().min(320).max(3840).default(1280),
  height: z.coerce.number().int().min(200).max(2160).default(800),

  format: z.enum(IMAGE_FORMATS).default("png"),
  /** JPEG/WebP quality 1-100 (ignored for png). */
  quality: z.coerce.number().int().min(1).max(100).default(90),

  /** When true the response is a JSON envelope with a base64 image. */
  json: z.boolean().default(false),
});

export type CaptureRequest = z.infer<typeof CaptureSchema>;
export type CaptureInput = z.input<typeof CaptureSchema>;

export const BatchSchema = z.object({
  items: z
    .array(CaptureSchema)
    .min(1)
    .max(env.MAX_BATCH, {
      message: `batch is limited to ${env.MAX_BATCH} items`,
    }),
});

export type BatchRequest = z.infer<typeof BatchSchema>;
