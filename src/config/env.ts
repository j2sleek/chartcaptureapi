import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/**
 * A comma-separated list turned into a trimmed, non-empty string array.
 * Accepts an empty value (returns []).
 */
const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  /**
   * Number of Chromium instances to launch. One process hosting several pages
   * is the most memory-efficient layout; add browsers only when you have RAM
   * to spare (each Chromium base costs ~120-180 MB before any pages).
   */
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(16).default(1),

  /**
   * Total pre-warmed chart pages kept ready across all browsers. Default 3 is
   * tuned for a 1 GB instance (~1 browser + 3 warm Coinalyze pages ≈ 650-820
   * MB RSS). Drop to 1 for 512 MB; raise on larger plans.
   */
  PAGE_POOL_SIZE: z.coerce.number().int().min(1).max(64).default(3),

  /** Max capture jobs executed at once (should be <= PAGE_POOL_SIZE). */
  CAPTURE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(3),

  /** Recycle a warm page after this many captures to avoid memory creep. */
  PAGE_MAX_USES: z.coerce.number().int().min(1).max(10000).default(200),

  /** Overall per-capture budget in ms (queue wait + execution). */
  CAPTURE_TIMEOUT: z.coerce.number().int().min(1000).max(120000).default(30000),

  /** Page navigation timeout in ms (cold load past the anti-bot gate). */
  NAV_TIMEOUT: z.coerce.number().int().min(1000).max(120000).default(60000),

  /** Time to wait for the TradingView widget/chart to become ready, ms. */
  WIDGET_TIMEOUT: z.coerce.number().int().min(1000).max(60000).default(40000),

  /** Settle time after mutations before screenshotting, ms. */
  RENDER_SETTLE_MS: z.coerce.number().int().min(0).max(10000).default(1200),

  /** Max items allowed in a single POST /capture/batch request. */
  MAX_BATCH: z.coerce.number().int().min(1).max(100).default(20),

  /**
   * Comma-separated API keys. When empty, auth is DISABLED (dev convenience).
   * In production supply at least one key.
   */
  API_KEYS: csv,

  /** Requests allowed per window, per key/IP. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  /** Rate-limit window, e.g. "1 minute", "10 seconds". */
  RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),

  /** Comma-separated allowed CORS origins. Empty => reflect all origins. */
  CORS_ORIGINS: csv,

  /** Base URL for Coinalyze pages. */
  COINALYZE_BASE: z.string().url().default("https://coinalyze.net"),

  /** Coinalyze path used to warm a page (any page exposing chartWidget). */
  WARMUP_PATH: z.string().min(1).default("/bitcoin/open-interest/"),

  /** Browser fingerprint used to pass the anti-bot challenge. */
  USER_AGENT: z
    .string()
    .min(1)
    .default(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ),
  LOCALE: z.string().min(1).default("en-US"),
  TIMEZONE: z.string().min(1).default("America/New_York"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  const value = parsed.data;

  // Cross-field sanity: never run more jobs than we have warm pages.
  if (value.CAPTURE_CONCURRENCY > value.PAGE_POOL_SIZE) {
    // eslint-disable-next-line no-console
    console.warn(
      `CAPTURE_CONCURRENCY (${value.CAPTURE_CONCURRENCY}) > PAGE_POOL_SIZE ` +
        `(${value.PAGE_POOL_SIZE}); clamping concurrency to ${value.PAGE_POOL_SIZE}.`,
    );
    value.CAPTURE_CONCURRENCY = value.PAGE_POOL_SIZE;
  }

  return value;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const authEnabled = env.API_KEYS.length > 0;
