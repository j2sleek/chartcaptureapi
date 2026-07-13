import type { FastifyInstance } from "fastify";
import { browserManager } from "../services/browserManager.js";
import { pagePool } from "../services/pagePool.js";
import { captureQueueStats } from "../services/capture.js";

/** Lightweight operational metrics as JSON (no external Prometheus dep). */
// eslint-disable-next-line @typescript-eslint/require-await
export default async function metricsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/metrics",
    { schema: { tags: ["system"], summary: "Operational metrics" } },
    async () => {
      const mem = process.memoryUsage();
      return {
        uptime: process.uptime(),
        browsers: browserManager.browserCount,
        pool: pagePool.stats,
        queue: captureQueueStats(),
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
      };
    },
  );
}
