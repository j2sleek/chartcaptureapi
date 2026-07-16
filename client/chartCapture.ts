/**
 * ChartCapture streaming client.
 *
 * Talks to POST /capture/batch/stream, which responds with newline-delimited
 * JSON (application/x-ndjson): a `meta` line first, one `result` line per chart
 * as it finishes (in completion order — NOT request order), then a `done`
 * summary. Results are mapped back to their tile via each line's `index`.
 *
 * Copy this file into the Replit app (e.g. src/lib/chartCapture.ts).
 */

const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ??
  "https://chartcapture-api-production.up.railway.app";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

// ─── Chart layout definitions ───────────────────────────────────────────────

export type ChartSlot =
  | "tv_1w" | "coinalyze_1w"
  | "tv_1d" | "coinalyze_1d"
  | "tv_4h" | "coinalyze_4h"
  | "tv_1h" | "coinalyze_1h"
  | "tv_15m" | "coinalyze_15m"
  | "funding_rate" | "long_short_ratio";

export interface SlotDef {
  slot: ChartSlot;
  metric: string;
  timeframe: string;
  label: string;
}

export const SLOT_DEFS: SlotDef[] = [
  { slot: "tv_1w",            metric: "liquidations",     timeframe: "1W",  label: "1W Liq"    },
  { slot: "coinalyze_1w",     metric: "open-interest",    timeframe: "1W",  label: "1W OI"     },
  { slot: "tv_1d",            metric: "liquidations",     timeframe: "1D",  label: "1D Liq"    },
  { slot: "coinalyze_1d",     metric: "open-interest",    timeframe: "1D",  label: "1D OI"     },
  { slot: "tv_4h",            metric: "liquidations",     timeframe: "240", label: "4H Liq"    },
  { slot: "coinalyze_4h",     metric: "open-interest",    timeframe: "240", label: "4H OI"     },
  { slot: "tv_1h",            metric: "open-interest",    timeframe: "60",  label: "1H OI"     },
  { slot: "coinalyze_1h",     metric: "liquidations",     timeframe: "60",  label: "1H Liq"    },
  { slot: "tv_15m",           metric: "open-interest",    timeframe: "15",  label: "15M OI"    },
  { slot: "coinalyze_15m",    metric: "liquidations",     timeframe: "15",  label: "15M Liq"   },
  { slot: "funding_rate",     metric: "funding-rate",     timeframe: "1D",  label: "Funding"   },
  { slot: "long_short_ratio", metric: "long-short-ratio", timeframe: "1D",  label: "L/S Ratio" },
];

export const COINS = [
  { id: "bitcoin",  name: "Bitcoin",  symbol: "BTC", decimals: 2 },
  { id: "ripple",   name: "XRP",      symbol: "XRP", decimals: 4 },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", decimals: 2 },
  { id: "solana",   name: "Solana",   symbol: "SOL", decimals: 2 },
] as const;

export type CoinConfig = (typeof COINS)[number];

export interface CaptureItem {
  symbol: string;
  metric: string;
  timeframe: string;
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp";
  json: true;
}

/**
 * Flat item array: COINS.length × SLOT_DEFS.length entries, coin-major.
 * Item at index i  →  coin COINS[floor(i / SLOT_DEFS.length)]
 *                     slot SLOT_DEFS[i % SLOT_DEFS.length]
 * Use itemAddress(i) to decode — do NOT index SLOT_DEFS with the raw index.
 */
export function buildAllItems(): CaptureItem[] {
  return COINS.flatMap((coin) =>
    SLOT_DEFS.map(
      (def): CaptureItem => ({
        symbol: coin.id,
        metric: def.metric,
        timeframe: def.timeframe,
        width: 1280,
        height: 800,
        format: "png",
        json: true,
      }),
    ),
  );
}

/** Decode a flat stream `index` back to its coin + slot. */
export function itemAddress(index: number): { coin: CoinConfig; slot: SlotDef } {
  return {
    coin: COINS[Math.floor(index / SLOT_DEFS.length)]!,
    slot: SLOT_DEFS[index % SLOT_DEFS.length]!,
  };
}

// ─── Stream message types ────────────────────────────────────────────────────

export interface StreamMeta   { type: "meta"; total: number; timestamp: number }
export interface StreamResult {
  type: "result";
  index: number;
  success: boolean;
  data?: {
    image: string;
    format: string;
    width: number;
    height: number;
    durationMs: number;
    symbol: string;
    timeframe: string;
  };
  error?: { code: string; message: string };
}
export interface StreamDone  { type: "done"; total: number; succeeded: number; failed: number; timestamp: number }
export interface StreamError { type: "error"; message: string }
export type StreamMessage = StreamMeta | StreamResult | StreamDone | StreamError;

export interface StreamCallbacks {
  onMeta?:   (msg: StreamMeta)   => void;
  onResult?: (msg: StreamResult) => void;
  onDone?:   (msg: StreamDone)   => void;
  onError?:  (err: Error)        => void;
}

// ─── The streaming fetch ─────────────────────────────────────────────────────

/**
 * POST `items` to /capture/batch/stream and invoke callbacks per line.
 *
 * Notes that matter:
 *  - NO client timeout. A 48-chart batch legitimately runs for minutes; the
 *    connection stays alive because the server emits bytes continuously.
 *    Cancellation is user-driven via `signal` only.
 *  - Results arrive out of request order (the server reorders for warm-page
 *    reuse). Map each result back with itemAddress(msg.index).
 *  - Never calls res.json(); reads res.text() on error so a proxy HTML page
 *    surfaces as a readable status, not "Unexpected token '<'".
 */
export async function streamBatch(
  items: CaptureItem[],
  signal: AbortSignal,
  cbs: StreamCallbacks,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  let res: Response;
  try {
    res = await fetch(`${BASE}/capture/batch/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items }),
      signal,
    });
  } catch (err) {
    // "Failed to fetch" lands here: DNS/TLS/CORS/offline — never an HTTP status.
    if ((err as Error).name === "AbortError") return;
    throw new Error(
      `Network error reaching ${BASE}/capture/batch/stream — ` +
        `check the URL, that the server is up, and CORS. (${(err as Error).message})`,
    );
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`ChartCapture ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: StreamMessage;
    try {
      msg = JSON.parse(trimmed) as StreamMessage;
    } catch {
      return; // ignore a partial/garbled line rather than aborting the stream
    }
    if      (msg.type === "meta")   cbs.onMeta?.(msg);
    else if (msg.type === "result") cbs.onResult?.(msg);
    else if (msg.type === "done")   cbs.onDone?.(msg);
    else if (msg.type === "error")  cbs.onError?.(new Error(msg.message));
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        flushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    // Flush any trailing bytes (last line may arrive without a newline).
    buffer += decoder.decode();
    flushLine(buffer);
  } catch (err) {
    if ((err as Error).name === "AbortError") return; // user cancelled — normal
    throw err;
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ─── Optional: connectivity probe for debugging "Failed to fetch" ────────────

/** Quick sanity check the API is reachable + CORS is open. Returns null on ok. */
export async function diagnoseConnection(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/health/ready`, { method: "GET" });
    if (!res.ok && res.status !== 503) return `Health check returned ${res.status}`;
    return null;
  } catch (err) {
    return (
      `Cannot reach ${BASE}. Likely causes: wrong VITE_API_BASE_URL, server ` +
      `asleep/redeploying, or CORS. Raw: ${(err as Error).message}`
    );
  }
}
