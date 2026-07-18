/**
 * Typed error hierarchy. Each error carries a stable machine-readable `code`
 * and an HTTP `statusCode` so the Fastify error handler can translate any
 * failure into a consistent JSON envelope without string matching.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Request failed validation (bad body/query). Maps to 400. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

/** Missing or invalid API key. Maps to 401. */
export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";
  readonly statusCode = 401;
}

/** A capture step exceeded its time budget. Maps to 504. */
export class CaptureTimeoutError extends AppError {
  readonly code = "CAPTURE_TIMEOUT";
  readonly statusCode = 504;
}

/** The chart widget could not be interacted with as expected. Maps to 502. */
export class CaptureFailedError extends AppError {
  readonly code = "CAPTURE_FAILED";
  readonly statusCode = 502;
}

/** No warm page could be acquired (pool exhausted / shutting down). Maps to 503. */
export class PoolUnavailableError extends AppError {
  readonly code = "POOL_UNAVAILABLE";
  readonly statusCode = 503;
}

/**
 * The upstream site served an anti-bot block (HTTP 403 or a Cloudflare
 * challenge/interstitial) instead of the chart page. Distinct from a slow
 * load so logs make the cause unambiguous. Maps to 502.
 */
export class BotBlockedError extends AppError {
  readonly code = "BOT_BLOCKED";
  readonly statusCode = 502;
  readonly status: number | undefined;

  constructor(
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, options);
    this.status = options?.status;
  }
}

/** Requested an unknown indicator or symbol. Maps to 400. */
export class UnknownResourceError extends AppError {
  readonly code = "UNKNOWN_RESOURCE";
  readonly statusCode = 400;
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Narrow a Playwright TimeoutError (matched by name, cross-version safe). */
export function isTimeoutLike(value: unknown): boolean {
  return (
    value instanceof Error &&
    (value.name === "TimeoutError" || /timeout/i.test(value.message))
  );
}
