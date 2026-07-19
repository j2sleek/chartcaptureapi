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
    .transform((value) => value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0));
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
    /**
     * Time to wait for the TradingView widget/chart to become ready, ms. Kept
     * WELL UNDER half of CAPTURE_TIMEOUT so a stuck/blocked attempt gives up in
     * time for the automatic retry to also run within the request budget — a
     * warm page normally readies in ~5s. If this exceeds CAPTURE_TIMEOUT the
     * first attempt alone blows the budget and the retry runs orphaned after the
     * client already 504s (guarded in loadEnv()).
     */
    WIDGET_TIMEOUT: z.coerce.number().int().min(1000).max(60000).default(15000),
    /** Settle time after mutations before screenshotting, ms. */
    RENDER_SETTLE_MS: z.coerce.number().int().min(0).max(10000).default(1200),
    /**
     * Max items allowed in a single batch request. The buffered /capture/batch
     * should stay modest (it returns nothing until every item finishes), but the
     * streaming endpoint emits results incrementally and has no idle-timeout
     * pressure, so larger sets are fine there. Default raised to 60.
     */
    MAX_BATCH: z.coerce.number().int().min(1).max(200).default(60),
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
        .default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
    LOCALE: z.string().min(1).default("en-US"),
    TIMEZONE: z.string().min(1).default("America/New_York"),
    /**
     * Optional outbound proxy for the headless browser. Set this to route
     * Coinalyze traffic through a residential/ISP proxy when datacenter-IP
     * reputation triggers the anti-bot block. Empty (default) => direct egress.
     *
     * Accepts a full URL, optionally with inline credentials:
     *   http://user:pass@host:port  |  http://host:port  |  socks5://host:port
     * Credentials may instead be supplied via PROXY_USERNAME / PROXY_PASSWORD.
     */
    PROXY_SERVER: z
        .string()
        .trim()
        .default("")
        .refine((value) => value === "" || /^(https?|socks[45]?):\/\//i.test(value), { message: "PROXY_SERVER must be an http(s):// or socks:// URL" }),
    PROXY_USERNAME: z.string().default(""),
    PROXY_PASSWORD: z.string().default(""),
    /** Comma-separated hosts that bypass the proxy, e.g. "localhost,127.0.0.1". */
    PROXY_BYPASS: z.string().default(""),
});
function loadEnv() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("\n");
        // eslint-disable-next-line no-console
        console.error(`Invalid environment configuration:\n${issues}`);
        process.exit(1);
    }
    const value = parsed.data;
    // Cross-field sanity: never run more jobs than we have warm pages.
    if (value.CAPTURE_CONCURRENCY > value.PAGE_POOL_SIZE) {
        // eslint-disable-next-line no-console
        console.warn(`CAPTURE_CONCURRENCY (${value.CAPTURE_CONCURRENCY}) > PAGE_POOL_SIZE ` +
            `(${value.PAGE_POOL_SIZE}); clamping concurrency to ${value.PAGE_POOL_SIZE}.`);
        value.CAPTURE_CONCURRENCY = value.PAGE_POOL_SIZE;
    }
    // Cross-field sanity: the widget wait must leave room for the automatic
    // retry inside one request budget. If WIDGET_TIMEOUT is too large the first
    // attempt alone overruns CAPTURE_TIMEOUT and the retry runs orphaned after
    // the client 504s — the exact failure seen in prod. Clamp to half-budget.
    const maxWidgetTimeout = Math.floor(value.CAPTURE_TIMEOUT / 2);
    if (value.WIDGET_TIMEOUT > maxWidgetTimeout) {
        // eslint-disable-next-line no-console
        console.warn(`WIDGET_TIMEOUT (${value.WIDGET_TIMEOUT}) > half of CAPTURE_TIMEOUT ` +
            `(${value.CAPTURE_TIMEOUT}); clamping to ${maxWidgetTimeout} so the ` +
            `retry can run within budget.`);
        value.WIDGET_TIMEOUT = maxWidgetTimeout;
    }
    return value;
}
export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
export const authEnabled = env.API_KEYS.length > 0;
/**
 * Resolve the configured proxy into Playwright's proxy option, or `undefined`
 * when no proxy is set (direct egress). Inline URL credentials are honoured;
 * PROXY_USERNAME/PROXY_PASSWORD override them when both are present.
 */
export function resolveProxy() {
    if (!env.PROXY_SERVER)
        return undefined;
    // Playwright wants the server URL WITHOUT credentials and the creds in
    // separate fields, so always split them out. Explicit PROXY_USERNAME/
    // PROXY_PASSWORD take precedence over anything embedded in the URL.
    let server = env.PROXY_SERVER;
    let inlineUser = "";
    let inlinePass = "";
    try {
        const url = new URL(env.PROXY_SERVER);
        inlineUser = url.username ? decodeURIComponent(url.username) : "";
        inlinePass = url.password ? decodeURIComponent(url.password) : "";
        if (url.username || url.password) {
            url.username = "";
            url.password = "";
            server = url.toString();
        }
    }
    catch {
        /* refine() already validated the scheme; ignore parse edge cases */
    }
    const config = { server };
    const username = env.PROXY_USERNAME || inlineUser;
    const password = env.PROXY_PASSWORD || inlinePass;
    if (username)
        config.username = username;
    if (password)
        config.password = password;
    if (env.PROXY_BYPASS)
        config.bypass = env.PROXY_BYPASS;
    return config;
}
export const proxyConfig = resolveProxy();
//# sourceMappingURL=env.js.map