import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { browserManager } from "./services/browserManager.js";
import { pagePool } from "./services/pagePool.js";
let app;
let shuttingDown = false;
async function start() {
    logger.info("Starting ChartCapture API…");
    // Bring browsers up first, then warm the page pool (past the anti-bot gate).
    await browserManager.initialize();
    await pagePool.initialize();
    app = await buildApp();
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, `ChartCapture API listening on http://${env.HOST}:${env.PORT} (docs at /docs)`);
}
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down…");
    const timer = setTimeout(() => {
        logger.error("Graceful shutdown timed out; forcing exit.");
        process.exit(1);
    }, 15000);
    timer.unref();
    try {
        if (app)
            await app.close();
        await pagePool.shutdown();
        await browserManager.shutdown();
        clearTimeout(timer);
        logger.info("Shutdown complete.");
        process.exit(0);
    }
    catch (error) {
        logger.error({ err: error }, "Error during shutdown.");
        process.exit(1);
    }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection.");
});
process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception; exiting.");
    void shutdown("uncaughtException");
});
start().catch((error) => {
    logger.fatal({ err: error }, "Failed to start server.");
    process.exit(1);
});
//# sourceMappingURL=server.js.map