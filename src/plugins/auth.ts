import type { FastifyInstance, FastifyRequest } from "fastify";
import { env, authEnabled } from "../config/env.js";
import { UnauthorizedError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ module: "auth" });

/** Paths that never require authentication. (/docs covers /docs/json|yaml.) */
const PUBLIC_PREFIXES = ["/health", "/docs"];

function isPublic(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function extractKey(request: FastifyRequest): string | undefined {
  const header = request.headers["x-api-key"];
  if (typeof header === "string" && header.length > 0) return header;

  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return undefined;
}

/**
 * API-key auth as an onRequest hook. When no keys are configured, auth is
 * disabled (a warning is logged once at startup). Public paths are exempt.
 */
export function registerAuth(app: FastifyInstance): void {
  if (!authEnabled) {
    log.warn(
      "API_KEYS is empty — authentication is DISABLED. Set API_KEYS in production.",
    );
    return;
  }

  const keys = new Set(env.API_KEYS);

  app.addHook("onRequest", async (request) => {
    if (isPublic(request.url)) return;

    const key = extractKey(request);
    if (!key || !keys.has(key)) {
      throw new UnauthorizedError(
        "Missing or invalid API key (send X-API-Key or Authorization: Bearer <key>)",
      );
    }
  });
}
