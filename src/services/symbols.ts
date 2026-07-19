import { UnknownResourceError } from "../utils/errors.js";

/**
 * Maps user-facing inputs onto the two things a capture needs:
 *   1. a Coinalyze metric page path (which chart universe to load), and
 *   2. a TradingView widget symbol (what the chart displays).
 *
 * Coinalyze symbols follow the "<TICKER>_AVGPRICE" convention (verified for
 * BTC and ETH). Friendly slugs are mapped to tickers; anything already in
 * widget-symbol form (contains "_") is passed through untouched.
 */

const SLUG_TO_TICKER: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  ripple: "XRP",
  xrp: "XRP",
  dogecoin: "DOGE",
  doge: "DOGE",
  cardano: "ADA",
  ada: "ADA",
  binancecoin: "BNB",
  bnb: "BNB",
  litecoin: "LTC",
  ltc: "LTC",
  "avalanche": "AVAX",
  avax: "AVAX",
  chainlink: "LINK",
  link: "LINK",
};

/** Coinalyze slug used in the page URL, keyed by ticker. */
const TICKER_TO_PAGE_SLUG: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  BNB: "binancecoin",
  LTC: "litecoin",
  AVAX: "avalanche",
  LINK: "chainlink",
};

/**
 * Metric segments Coinalyze renders with the TradingView widget we screenshot.
 * Verified live (2026-07-19). Two deliberate exclusions:
 *   - "predicted-funding-rate": not a page at all — a data point on the
 *     funding-rate page; the path 404s.
 *   - "basis": exists (HTTP 200) but is a Highcharts-only page with NO
 *     TradingView widget (no window.chartWidget), so widget capture can never
 *     succeed there and would just time out.
 */
const KNOWN_METRICS = new Set([
  "open-interest",
  "funding-rate",
  "liquidations",
  "long-short-ratio",
]);

export interface ResolvedTarget {
  /** e.g. "/bitcoin/open-interest/" */
  metricPath: string;
  /** e.g. "BTC_AVGPRICE" */
  widgetSymbol: string;
  ticker: string;
}

function normalizeMetric(metric: string): string {
  const cleaned = metric.trim().toLowerCase().replace(/\s+/g, "-");
  if (!KNOWN_METRICS.has(cleaned)) {
    throw new UnknownResourceError(
      `Unknown metric "${metric}". Known metrics: ${[...KNOWN_METRICS].join(", ")}`,
    );
  }
  return cleaned;
}

export function resolveTarget(symbol: string, metric: string): ResolvedTarget {
  const metricSlug = normalizeMetric(metric);
  const raw = symbol.trim();

  // Already a widget symbol (e.g. "BTC_AVGPRICE") — derive ticker for the page.
  if (raw.includes("_")) {
    const ticker = raw.split("_")[0]!.toUpperCase();
    const pageSlug = TICKER_TO_PAGE_SLUG[ticker];
    if (!pageSlug) {
      throw new UnknownResourceError(
        `Unsupported symbol "${symbol}"; add its page slug to symbols.ts`,
      );
    }
    return {
      metricPath: `/${pageSlug}/${metricSlug}/`,
      widgetSymbol: `${ticker}_AVGPRICE`,
      ticker,
    };
  }

  const ticker = SLUG_TO_TICKER[raw.toLowerCase()];
  if (!ticker) {
    throw new UnknownResourceError(
      `Unknown symbol "${symbol}". Known: ${Object.keys(SLUG_TO_TICKER).join(", ")}`,
    );
  }
  const pageSlug = TICKER_TO_PAGE_SLUG[ticker]!;
  return {
    metricPath: `/${pageSlug}/${metricSlug}/`,
    widgetSymbol: `${ticker}_AVGPRICE`,
    ticker,
  };
}

export const SUPPORTED_SYMBOLS = Object.keys(SLUG_TO_TICKER);
export const SUPPORTED_METRICS = [...KNOWN_METRICS];
