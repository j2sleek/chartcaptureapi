import type { FastifyInstance } from "fastify";
import { browserManager } from "../services/browserManager.js";
import { pagePool } from "../services/pagePool.js";

/**
 * Liveness (`/health`) and readiness (`/health/ready`) probes.
 * Liveness is always 200 while the process is up; readiness reflects whether
 * the browser pool is actually able to serve captures.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness probe",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
              timestamp: { type: "number" },
            },
          },
        },
      },
    },
    async () => ({
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
    }),
  );

  app.get(
    "/health/ready",
    { schema: { tags: ["system"], summary: "Readiness probe" } },
    async (_request, reply) => {
      const ready = pagePool.isReady() && browserManager.isHealthy();
      return reply.status(ready ? 200 : 503).send({
        status: ready ? "ready" : "not-ready",
        pool: pagePool.stats,
        browsers: browserManager.browserCount,
      });
    },
  );
}
