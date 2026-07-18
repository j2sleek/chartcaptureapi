import type { Page } from "playwright";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { BotBlockedError, PoolUnavailableError } from "../utils/errors.js";
import { browserManager } from "./browserManager.js";
import { waitForWidgetReady } from "./tradingview.js";

const log = logger.child({ module: "pagePool" });

/**
 * Title/body markers of a Cloudflare (or similar) anti-bot interstitial. When
 * the upstream serves one of these, the chart bootstrap never runs and
 * `waitForWidgetReady` would otherwise time out with a misleading error — so we
 * detect it up front and fail fast with a {@link BotBlockedError}.
 */
const CHALLENGE_MARKERS = [
  "just a moment",
  "checking your browser",
  "cf-browser-verification",
  "challenge-platform",
  "attention required",
  "verify you are human",
];

/** A pooled, pre-warmed Coinalyze page that is already past the bot gate. */
interface PooledPage {
  page: Page;
  uses: number;
  /** Widget-symbol currently loaded, so we can skip redundant navigations. */
  loadedMetric: string;
}

interface Waiter {
  resolve: (slot: PooledPage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function warmupUrl(metricPath: string): string {
  return `${env.COINALYZE_BASE}${metricPath}`;
}

/**
 * Navigate a page to a Coinalyze metric URL and assert we actually landed on
 * the chart page (not an anti-bot block). Throws {@link BotBlockedError} on a
 * 4xx/5xx document response or a recognised challenge interstitial, so the
 * cause is unambiguous in logs instead of surfacing as a widget timeout.
 */
async function navigateToMetric(page: Page, metricPath: string): Promise<void> {
  const url = warmupUrl(metricPath);
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: env.NAV_TIMEOUT,
  });

  const status = response?.status();
  if (status !== undefined && status >= 400) {
    throw new BotBlockedError(
      `Upstream returned HTTP ${status} for ${metricPath} (likely an IP/anti-bot block).`,
      { status },
    );
  }

  const title = (await page.title()).toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => title.includes(marker))) {
    throw new BotBlockedError(
      `Upstream served an anti-bot challenge for ${metricPath} (title: "${title}").`,
      status !== undefined ? { status } : undefined,
    );
  }
}

/**
 * Maintains a fixed set of warm chart pages. Acquiring a page returns one that
 * has already loaded Coinalyze and fired onChartReady, so a capture only needs
 * to mutate the chart (fast path) instead of paying the ~15s cold-load cost.
 *
 * Pages are checked out exclusively; callers MUST release. Pages are recycled
 * after PAGE_MAX_USES or when marked unhealthy.
 */
export class PagePool {
  private idle: PooledPage[] = [];
  private readonly all = new Set<PooledPage>();
  private readonly waiters: Waiter[] = [];
  private draining = false;
  private ready = false;

  async initialize(): Promise<void> {
    if (this.ready) return;
    const target = env.PAGE_POOL_SIZE;

    // Warm pages in parallel; tolerate partial failure but require at least one.
    const results = await Promise.allSettled(
      Array.from({ length: target }, () => this.createWarmPage()),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.all.add(result.value);
        this.idle.push(result.value);
      } else {
        log.error({ err: result.reason }, "Failed to warm a page during init.");
      }
    }

    if (this.idle.length === 0) {
      throw new Error(
        "PagePool failed to warm any pages; cannot start (is the target site reachable?)",
      );
    }
    this.ready = true;
    log.info(
      `PagePool ready with ${this.idle.length}/${target} warm page(s).`,
    );
  }

  private async createWarmPage(): Promise<PooledPage> {
    const page = await browserManager.newPage();
    page.setDefaultNavigationTimeout(env.NAV_TIMEOUT);
    page.setDefaultTimeout(env.WIDGET_TIMEOUT);

    const metric = env.WARMUP_PATH;
    await navigateToMetric(page, metric);
    await waitForWidgetReady(page);

    return { page, uses: 0, loadedMetric: metric };
  }

  /**
   * Ensure the pooled page has the desired metric page loaded. Switching
   * metric pages requires a real navigation (different chart symbol universe);
   * same-metric reuse is the hot path and skips navigation entirely.
   */
  async ensureMetric(slot: PooledPage, metricPath: string): Promise<void> {
    if (slot.loadedMetric === metricPath) return;
    await navigateToMetric(slot.page, metricPath);
    await waitForWidgetReady(slot.page);
    slot.loadedMetric = metricPath;
  }

  /** Check out a warm page, waiting up to CAPTURE_TIMEOUT for one to free up. */
  async acquire(): Promise<PooledPage> {
    if (this.draining) {
      throw new PoolUnavailableError("Server is shutting down");
    }

    const slot = this.idle.pop();
    if (slot) return slot;

    return new Promise<PooledPage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new PoolUnavailableError("Timed out waiting for a free page"));
      }, env.CAPTURE_TIMEOUT);

      this.waiters.push({ resolve, reject, timer });
    });
  }

  /**
   * Return a page to the pool. If `healthy` is false the page is destroyed and
   * replaced. Recycles pages that have exceeded their use budget.
   */
  async release(slot: PooledPage, healthy: boolean): Promise<void> {
    slot.uses += 1;

    const shouldRecycle =
      !healthy || slot.uses >= env.PAGE_MAX_USES || slot.page.isClosed();

    if (shouldRecycle) {
      await this.destroy(slot);
      if (!this.draining) {
        void this.replenish();
      }
      return;
    }

    this.handOff(slot);
  }

  /** Give a freed page to the next waiter, or park it as idle. */
  private handOff(slot: PooledPage): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(slot);
    } else {
      this.idle.push(slot);
    }
  }

  private async destroy(slot: PooledPage): Promise<void> {
    this.all.delete(slot);
    const idx = this.idle.indexOf(slot);
    if (idx !== -1) this.idle.splice(idx, 1);
    try {
      if (!slot.page.isClosed()) await slot.page.close();
    } catch (error) {
      log.warn({ err: error }, "Error closing recycled page.");
    }
  }

  /** Warm a replacement page after one is destroyed. */
  private async replenish(): Promise<void> {
    try {
      const slot = await this.createWarmPage();
      this.all.add(slot);
      this.handOff(slot);
      log.debug("Replenished a warm page.");
    } catch (error) {
      log.error({ err: error }, "Failed to replenish a warm page.");
    }
  }

  get stats(): {
    total: number;
    idle: number;
    busy: number;
    waiting: number;
    ready: boolean;
  } {
    return {
      total: this.all.size,
      idle: this.idle.length,
      busy: this.all.size - this.idle.length,
      waiting: this.waiters.length,
      ready: this.ready,
    };
  }

  isReady(): boolean {
    return this.ready && this.all.size > 0;
  }

  async shutdown(): Promise<void> {
    this.draining = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new PoolUnavailableError("Server is shutting down"));
    }
    await Promise.allSettled([...this.all].map((slot) => this.destroy(slot)));
    this.ready = false;
  }
}

export const pagePool = new PagePool();
export type { PooledPage };
