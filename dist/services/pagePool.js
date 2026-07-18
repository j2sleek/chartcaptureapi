import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { BotBlockedError, PoolUnavailableError, UnknownResourceError, } from "../utils/errors.js";
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
function warmupUrl(metricPath) {
    return `${env.COINALYZE_BASE}${metricPath}`;
}
/**
 * Navigate a page to a Coinalyze metric URL and assert we actually landed on
 * the chart page. Distinguishes three failure modes so logs are unambiguous
 * instead of all surfacing as a widget timeout:
 *   - 404 → the metric path doesn't exist upstream (deterministic;
 *     {@link UnknownResourceError}, not retried).
 *   - other 4xx/5xx or a challenge interstitial → an IP/anti-bot block
 *     ({@link BotBlockedError}).
 */
async function navigateToMetric(page, metricPath) {
    const url = warmupUrl(metricPath);
    const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: env.NAV_TIMEOUT,
    });
    const status = response?.status();
    if (status === 404) {
        throw new UnknownResourceError(`Coinalyze has no page at ${metricPath} (HTTP 404).`);
    }
    if (status !== undefined && status >= 400) {
        throw new BotBlockedError(`Upstream returned HTTP ${status} for ${metricPath} (likely an IP/anti-bot block).`, { status });
    }
    const title = (await page.title()).toLowerCase();
    if (CHALLENGE_MARKERS.some((marker) => title.includes(marker))) {
        throw new BotBlockedError(`Upstream served an anti-bot challenge for ${metricPath} (title: "${title}").`, status !== undefined ? { status } : undefined);
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
    idle = [];
    all = new Set();
    waiters = [];
    draining = false;
    ready = false;
    async initialize() {
        if (this.ready)
            return;
        const target = env.PAGE_POOL_SIZE;
        // Warm pages in parallel; tolerate partial failure but require at least one.
        const results = await Promise.allSettled(Array.from({ length: target }, () => this.createWarmPage()));
        for (const result of results) {
            if (result.status === "fulfilled") {
                this.all.add(result.value);
                this.idle.push(result.value);
            }
            else {
                log.error({ err: result.reason }, "Failed to warm a page during init.");
            }
        }
        if (this.idle.length === 0) {
            throw new Error("PagePool failed to warm any pages; cannot start (is the target site reachable?)");
        }
        this.ready = true;
        log.info(`PagePool ready with ${this.idle.length}/${target} warm page(s).`);
    }
    async createWarmPage() {
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
    async ensureMetric(slot, metricPath) {
        if (slot.loadedMetric === metricPath)
            return;
        await navigateToMetric(slot.page, metricPath);
        await waitForWidgetReady(slot.page);
        slot.loadedMetric = metricPath;
    }
    /** Check out a warm page, waiting up to CAPTURE_TIMEOUT for one to free up. */
    async acquire() {
        if (this.draining) {
            throw new PoolUnavailableError("Server is shutting down");
        }
        const slot = this.idle.pop();
        if (slot)
            return slot;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.waiters.findIndex((w) => w.timer === timer);
                if (idx !== -1)
                    this.waiters.splice(idx, 1);
                reject(new PoolUnavailableError("Timed out waiting for a free page"));
            }, env.CAPTURE_TIMEOUT);
            this.waiters.push({ resolve, reject, timer });
        });
    }
    /**
     * Return a page to the pool. If `healthy` is false the page is destroyed and
     * replaced. Recycles pages that have exceeded their use budget.
     */
    async release(slot, healthy) {
        slot.uses += 1;
        const shouldRecycle = !healthy || slot.uses >= env.PAGE_MAX_USES || slot.page.isClosed();
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
    handOff(slot) {
        const waiter = this.waiters.shift();
        if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve(slot);
        }
        else {
            this.idle.push(slot);
        }
    }
    async destroy(slot) {
        this.all.delete(slot);
        const idx = this.idle.indexOf(slot);
        if (idx !== -1)
            this.idle.splice(idx, 1);
        try {
            if (!slot.page.isClosed())
                await slot.page.close();
        }
        catch (error) {
            log.warn({ err: error }, "Error closing recycled page.");
        }
    }
    /** Warm a replacement page after one is destroyed. */
    async replenish() {
        try {
            const slot = await this.createWarmPage();
            this.all.add(slot);
            this.handOff(slot);
            log.debug("Replenished a warm page.");
        }
        catch (error) {
            log.error({ err: error }, "Failed to replenish a warm page.");
        }
    }
    get stats() {
        return {
            total: this.all.size,
            idle: this.idle.length,
            busy: this.all.size - this.idle.length,
            waiting: this.waiters.length,
            ready: this.ready,
        };
    }
    isReady() {
        return this.ready && this.all.size > 0;
    }
    async shutdown() {
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
//# sourceMappingURL=pagePool.js.map