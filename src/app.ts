import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { env, authEnabled } from "./config/env.js";
import { loggerOptions } from "./utils/logger.js";
import { isAppError } from "./utils/errors.js";
import { registerAuth } from "./plugins/auth.js";
import { registerSwagger } from "./plugins/swagger.js";
import healthRoutes from "./routes/health.js";
import metricsRoutes from "./routes/metrics.js";
import captureRoutes from "./routes/capture.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB (batch payloads)
  });

  // ── Security headers ──────────────────────────────────────────────────
  // Relax CSP so the Swagger UI assets load; API responses are images/JSON.
  await app.register(helmet, { contentSecurityPolicy: false });

  // ── CORS ──────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  });

  // ── Rate limiting (keyed by API key when present, else client IP) ──────
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => {
      const key = request.headers["x-api-key"];
      if (typeof key === "string" && key.length > 0) return key;
      return request.ip;
    },
    allowList: (request) => request.url.startsWith("/health"),
  });

  // ── OpenAPI docs ──────────────────────────────────────────────────────
  await registerSwagger(app);

  // ── Auth (no-op when API_KEYS empty) ──────────────────────────────────
  registerAuth(app);

  // ── Centralized error handler → consistent JSON envelope ──────────────
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Fastify's own rate-limit / validation errors carry a statusCode.
    if (isAppError(error)) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, error.code);
      } else {
        request.log.warn({ err: error }, error.code);
      }
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.name === "ValidationError" && "details" in error
            ? { details: (error as { details: unknown }).details }
            : {}),
        },
      });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, "Unhandled error");
    return reply.status(status).send({
      success: false,
      error: {
        code: status === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR",
        message:
          status >= 500 && env.NODE_ENV === "production"
            ? "Internal server error"
            : error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found` },
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(captureRoutes);

  app.log.info(
    { authEnabled, rateLimit: `${env.RATE_LIMIT_MAX}/${env.RATE_LIMIT_WINDOW}` },
    "Fastify app built.",
  );

  return app;
}
