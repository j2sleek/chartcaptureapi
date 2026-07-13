import PQueue from "p-queue";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { CaptureFailedError, CaptureTimeoutError, isAppError, isTimeoutLike, } from "../utils/errors.js";
import { pagePool } from "./pagePool.js";
import { resolveTarget } from "./symbols.js";
import { applyIndicators, removeAllStudies, setSymbol, setTimeframe, takeChartScreenshot, waitForRender, waitForWidgetReady, } from "./tradingview.js";
const log = logger.child({ module: "capture" });
/** Bounds how many captures touch the browser at once. */
const queue = new PQueue({ concurrency: env.CAPTURE_CONCURRENCY });
/** Run `fn` but reject with CaptureTimeoutError if it overruns the budget. */
function withTimeout(fn, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new CaptureTimeoutError(`Capture exceeded ${ms}ms`)), ms);
        fn().then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
/** The chart-mutation + screenshot sequence performed on one warm page. */
async function runOnPage(slot, request) {
    const target = resolveTarget(request.symbol, request.metric);
    await pagePool.ensureMetric(slot, target.metricPath);
    await waitForWidgetReady(slot.page);
    // Match the viewport to the requested output size for a correctly-scaled
    // widget render, then reset chart state from any previous tenant.
    await slot.page.setViewportSize({
        width: request.width,
        height: request.height,
    });
    await removeAllStudies(slot.page);
    await setSymbol(slot.page, target.widgetSymbol);
    await setTimeframe(slot.page, request.timeframe);
    if (request.indicators.length > 0) {
        await applyIndicators(slot.page, request.indicators.map((indicator) => ({
            name: indicator.name,
            inputs: indicator.inputs,
            overlay: indicator.overlay,
        })));
    }
    await waitForRender(slot.page);
    return takeChartScreenshot(slot.page, request.format, request.quality);
}
/**
 * Execute a single capture: acquire a warm page, run the workflow with one
 * automatic retry on transient failure, and always release the page. Retries
 * mark the page unhealthy so a fresh one is used on the second attempt.
 */
async function executeCapture(request) {
    const startedAt = Date.now();
    const maxAttempts = 2;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const slot = await pagePool.acquire();
        let healthy = true;
        try {
            const shot = await runOnPage(slot, request);
            const target = resolveTarget(request.symbol, request.metric);
            return {
                buffer: shot.buffer,
                format: request.format,
                width: shot.width,
                height: shot.height,
                durationMs: Date.now() - startedAt,
                symbol: target.widgetSymbol,
                timeframe: request.timeframe,
            };
        }
        catch (error) {
            lastError = error;
            healthy = false; // recycle the page; it may be in a bad state
            const timedOut = isTimeoutLike(error);
            log.warn({ attempt, err: error, timedOut, symbol: request.symbol }, "Capture attempt failed.");
            // Unknown symbol/metric etc. are deterministic — don't retry.
            if (isAppError(error) && error.code === "UNKNOWN_RESOURCE")
                throw error;
        }
        finally {
            await pagePool.release(slot, healthy);
        }
    }
    if (isTimeoutLike(lastError)) {
        throw new CaptureTimeoutError("Capture timed out", { cause: lastError });
    }
    if (isAppError(lastError))
        throw lastError;
    throw new CaptureFailedError("Capture failed after retries", {
        cause: lastError,
    });
}
/** Public entry point for a single capture, subject to the concurrency queue. */
export async function capture(request) {
    // We enforce the time budget ourselves via withTimeout, so p-queue is used
    // purely for concurrency gating. Its add() is typed as possibly-undefined
    // (for the timeout feature we don't use), hence the guard below.
    const result = await queue.add(() => withTimeout(() => executeCapture(request), env.CAPTURE_TIMEOUT));
    if (!result) {
        throw new CaptureFailedError("Capture was dropped from the queue");
    }
    return result;
}
/**
 * Process a batch concurrently (bounded by the same queue). One item failing
 * never fails the batch; each result carries its own success/error.
 */
export async function captureBatch(requests) {
    return Promise.all(requests.map(async (request, index) => {
        try {
            const result = await capture(request);
            return {
                index,
                success: true,
                data: {
                    image: result.buffer.toString("base64"),
                    format: result.format,
                    width: result.width,
                    height: result.height,
                    durationMs: result.durationMs,
                    symbol: result.symbol,
                    timeframe: result.timeframe,
                },
            };
        }
        catch (error) {
            const code = isAppError(error) ? error.code : "CAPTURE_FAILED";
            const message = error instanceof Error ? error.message : "Unknown error";
            return { index, success: false, error: { code, message } };
        }
    }));
}
export function captureQueueStats() {
    return { size: queue.size, pending: queue.pending };
}
//# sourceMappingURL=capture.js.map