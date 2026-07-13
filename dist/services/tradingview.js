import { env } from "../config/env.js";
import { CaptureFailedError, isTimeoutLike } from "../utils/errors.js";
/**
 * The ONLY module that talks to the Coinalyze TradingView widget
 * (`window.chartWidget`). If Coinalyze changes its embedding, this is the one
 * file to update. Every browser-side call is wrapped so failures surface as
 * typed {@link CaptureFailedError}s instead of raw Playwright errors.
 *
 * All widget methods used here were verified against the live site:
 *   onChartReady, activeChart, setSymbol, setResolution, getAllStudies,
 *   removeAllStudies, createStudy, takeClientScreenshot.
 */
const MIME_BY_FORMAT = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
};
function wrap(step, error) {
    if (isTimeoutLike(error)) {
        // Re-thrown as-is so the orchestrator can classify it as a timeout.
        throw error;
    }
    throw new CaptureFailedError(`TradingView step failed: ${step}`, {
        cause: error,
    });
}
/**
 * Resolves once `window.chartWidget` exists and its chart has fired
 * onChartReady. Safe to call repeatedly on an already-ready page.
 */
export async function waitForWidgetReady(page) {
    try {
        await page.waitForFunction(() => typeof window.chartWidget?.onChartReady === "function", undefined, { timeout: env.WIDGET_TIMEOUT });
        await page.evaluate((timeout) => new Promise((resolve, reject) => {
            const widget = window.chartWidget;
            if (!widget) {
                reject(new Error("chartWidget missing"));
                return;
            }
            const timer = setTimeout(() => reject(new Error("onChartReady timeout")), timeout);
            widget.onChartReady(() => {
                clearTimeout(timer);
                resolve();
            });
        }), env.WIDGET_TIMEOUT);
    }
    catch (error) {
        wrap("waitForWidgetReady", error);
    }
}
/** Remove every study/indicator currently on the chart. */
export async function removeAllStudies(page) {
    try {
        await page.evaluate(() => {
            window.chartWidget?.activeChart().removeAllStudies();
        });
    }
    catch (error) {
        wrap("removeAllStudies", error);
    }
}
/**
 * Switch the chart to a new symbol and wait for it to resolve. `symbol` is a
 * fully-formed widget symbol such as "BTC_AVGPRICE".
 */
export async function setSymbol(page, symbol) {
    try {
        await page.evaluate(({ sym, timeout }) => new Promise((resolve, reject) => {
            const chart = window.chartWidget?.activeChart();
            if (!chart) {
                reject(new Error("chart missing"));
                return;
            }
            if (chart.symbol() === sym) {
                resolve();
                return;
            }
            let done = false;
            const timer = setTimeout(() => {
                if (!done) {
                    done = true;
                    reject(new Error("setSymbol timeout"));
                }
            }, timeout);
            chart.setSymbol(sym, () => {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve();
                }
            });
        }), { sym: symbol, timeout: env.WIDGET_TIMEOUT });
    }
    catch (error) {
        wrap(`setSymbol(${symbol})`, error);
    }
}
/** Set the chart resolution/timeframe, e.g. "60", "1D", "1W". */
export async function setTimeframe(page, resolution) {
    try {
        await page.evaluate(({ res, timeout }) => new Promise((resolve, reject) => {
            const chart = window.chartWidget?.activeChart();
            if (!chart) {
                reject(new Error("chart missing"));
                return;
            }
            let settled = false;
            const finish = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const timer = setTimeout(finish, timeout);
            try {
                // setResolution's callback is optional and not always invoked;
                // resolve on callback OR after a short grace period.
                chart.setResolution(res, () => {
                    clearTimeout(timer);
                    finish();
                });
            }
            catch (err) {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        }), { res: resolution, timeout: 5000 });
    }
    catch (error) {
        wrap(`setTimeframe(${resolution})`, error);
    }
}
/**
 * Apply the given indicators in order. Returns the created study ids. A study
 * name the library rejects raises {@link CaptureFailedError}.
 */
export async function applyIndicators(page, indicators) {
    if (indicators.length === 0)
        return [];
    try {
        return await page.evaluate(async (specs) => {
            const chart = window.chartWidget?.activeChart();
            if (!chart)
                throw new Error("chart missing");
            const ids = [];
            for (const spec of specs) {
                const id = await chart.createStudy(spec.name, spec.overlay ?? false, false, spec.inputs ?? []);
                if (id)
                    ids.push(id);
            }
            return ids;
        }, indicators);
    }
    catch (error) {
        wrap("applyIndicators", error);
    }
}
/** List the study names currently applied (used by tests / diagnostics). */
export async function listStudies(page) {
    try {
        return await page.evaluate(() => window.chartWidget?.activeChart().getAllStudies().map((s) => s.name) ??
            []);
    }
    catch (error) {
        wrap("listStudies", error);
    }
}
/** Give the chart time to finish drawing after mutations. */
export async function waitForRender(page) {
    if (env.RENDER_SETTLE_MS > 0) {
        await page.waitForTimeout(env.RENDER_SETTLE_MS);
    }
}
/**
 * Capture the chart via the widget's own renderer (crisp, DPR-correct) and
 * encode it in the requested format. Falls back cleanly on any widget error.
 */
export async function takeChartScreenshot(page, format, quality) {
    try {
        const result = await page.evaluate(async ({ mime, q }) => {
            const widget = window.chartWidget;
            if (!widget)
                throw new Error("chartWidget missing");
            const canvas = await widget.takeClientScreenshot();
            const dataUrl = canvas.toDataURL(mime, q);
            return {
                dataUrl,
                width: canvas.width,
                height: canvas.height,
            };
        }, { mime: MIME_BY_FORMAT[format], q: quality / 100 });
        const base64 = result.dataUrl.slice(result.dataUrl.indexOf(",") + 1);
        return {
            buffer: Buffer.from(base64, "base64"),
            width: result.width,
            height: result.height,
        };
    }
    catch (error) {
        wrap("takeChartScreenshot", error);
    }
}
//# sourceMappingURL=tradingview.js.map