import { chromium, } from "playwright";
import { env, proxyConfig } from "../config/env.js";
import { logger } from "../utils/logger.js";
const log = logger.child({ module: "browserManager" });
/**
 * Chromium launch flags tuned for headless server use. The
 * AutomationControlled toggle plus the stealth init script (below) are what
 * let us pass Coinalyze's Cloudflare bot challenge with a headless browser.
 */
const LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=IsolateOrigins,site-per-process",
    // ── Memory reduction (matters on small instances, e.g. Render Starter) ──
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--mute-audio",
    "--js-flags=--max-old-space-size=256",
];
/**
 * Injected into every page before any site script runs. Masks the most common
 * headless tells so the anti-bot challenge resolves automatically. Kept in one
 * function because addInitScript serialises it and runs it in the page context
 * (no closure over Node-side variables).
 */
function stealthInit() {
    // `navigator.webdriver` — the single strongest headless tell. Delete it from
    // the prototype so it reads as undefined and the property is truly absent.
    try {
        delete Navigator.prototype.webdriver;
    }
    catch {
        /* ignore */
    }
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
    });
    // Real Chrome exposes a populated plugins/mimeTypes array; headless is empty.
    const fakePlugins = [
        { name: "Chrome PDF Plugin" },
        { name: "Chrome PDF Viewer" },
        { name: "Native Client" },
    ];
    Object.defineProperty(navigator, "plugins", {
        get: () => fakePlugins,
    });
    Object.defineProperty(navigator, "mimeTypes", {
        get: () => [{ type: "application/pdf" }],
    });
    // Headed Chrome always has window.chrome; headless often lacks it.
    if (!window.chrome) {
        window.chrome = { runtime: {} };
    }
    // Notification permission query returns "denied" under headless with no
    // prompt UI — a known fingerprinting signal. Normalise it.
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
        window.navigator.permissions.query = ((parameters) => parameters.name === "notifications"
            ? Promise.resolve({
                state: Notification.permission,
            })
            : originalQuery.call(window.navigator.permissions, parameters));
    }
    // Spoof the WebGL vendor/renderer strings to a plausible consumer GPU
    // instead of the SwiftShader software renderer headless reports.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445)
            return "Intel Inc."; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446)
            return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, parameter);
    };
}
/**
 * Owns the Chromium processes and hands out fresh pages inside stealth
 * contexts. Browsers are auto-relaunched (with backoff) if they crash, unless
 * the manager is shutting down.
 */
export class BrowserManager {
    managed = [];
    roundRobin = 0;
    shuttingDown = false;
    initialized = false;
    async initialize() {
        if (this.initialized)
            return;
        this.initialized = true;
        if (proxyConfig) {
            // Log the proxy server only (never username/password).
            log.info({ proxy: proxyConfig.server }, "Egress proxy enabled.");
        }
        for (let i = 0; i < env.BROWSER_POOL_SIZE; i++) {
            this.managed.push(await this.spawn(i));
        }
        log.info(`Launched ${this.managed.length} Chromium instance(s).`);
    }
    async spawn(index) {
        const browser = await chromium.launch({
            headless: true,
            args: LAUNCH_ARGS,
        });
        const context = await this.newStealthContext(browser);
        const entry = { index, browser, context };
        browser.on("disconnected", () => {
            if (this.shuttingDown)
                return;
            log.warn({ index }, "Chromium disconnected; relaunching.");
            void this.relaunch(entry);
        });
        return entry;
    }
    async newStealthContext(browser) {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: env.USER_AGENT,
            locale: env.LOCALE,
            timezoneId: env.TIMEZONE,
            deviceScaleFactor: 1,
            // Optional residential/ISP proxy to escape datacenter-IP anti-bot blocks.
            // Omitted entirely when unset so egress stays direct.
            ...(proxyConfig ? { proxy: proxyConfig } : {}),
            // Client-hint headers consistent with the spoofed Chrome UA. A missing or
            // mismatched Sec-CH-UA against a Chrome UA is a cheap anti-bot tell.
            extraHTTPHeaders: {
                "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "accept-language": `${env.LOCALE},en;q=0.9`,
            },
        });
        await context.addInitScript(stealthInit);
        return context;
    }
    async relaunch(entry, attempt = 1) {
        if (this.shuttingDown)
            return;
        try {
            const fresh = await this.spawn(entry.index);
            entry.browser = fresh.browser;
            entry.context = fresh.context;
            log.info({ index: entry.index }, "Chromium relaunched.");
        }
        catch (error) {
            const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
            log.error({ index: entry.index, attempt, delay, err: error }, "Relaunch failed; retrying.");
            setTimeout(() => void this.relaunch(entry, attempt + 1), delay);
        }
    }
    /** Least-recently-used-ish selection via round robin across live browsers. */
    pick() {
        if (this.managed.length === 0) {
            throw new Error("BrowserManager not initialized");
        }
        const entry = this.managed[this.roundRobin % this.managed.length];
        this.roundRobin = (this.roundRobin + 1) % this.managed.length;
        return entry;
    }
    /** Open a fresh page inside a stealth context for the pool to warm up. */
    async newPage() {
        const entry = this.pick();
        return entry.context.newPage();
    }
    get browserCount() {
        return this.managed.length;
    }
    isHealthy() {
        return (this.initialized &&
            !this.shuttingDown &&
            this.managed.every((entry) => entry.browser.isConnected()));
    }
    async shutdown() {
        this.shuttingDown = true;
        await Promise.allSettled(this.managed.map((entry) => entry.browser.close()));
        this.managed = [];
        this.initialized = false;
        log.info("All Chromium instances closed.");
    }
}
export const browserManager = new BrowserManager();
//# sourceMappingURL=browserManager.js.map