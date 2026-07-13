/**
 * Typed error hierarchy. Each error carries a stable machine-readable `code`
 * and an HTTP `statusCode` so the Fastify error handler can translate any
 * failure into a consistent JSON envelope without string matching.
 */
export class AppError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = new.target.name;
    }
}
/** Request failed validation (bad body/query). Maps to 400. */
export class ValidationError extends AppError {
    code = "VALIDATION_ERROR";
    statusCode = 400;
    details;
    constructor(message, details) {
        super(message);
        this.details = details;
    }
}
/** Missing or invalid API key. Maps to 401. */
export class UnauthorizedError extends AppError {
    code = "UNAUTHORIZED";
    statusCode = 401;
}
/** A capture step exceeded its time budget. Maps to 504. */
export class CaptureTimeoutError extends AppError {
    code = "CAPTURE_TIMEOUT";
    statusCode = 504;
}
/** The chart widget could not be interacted with as expected. Maps to 502. */
export class CaptureFailedError extends AppError {
    code = "CAPTURE_FAILED";
    statusCode = 502;
}
/** No warm page could be acquired (pool exhausted / shutting down). Maps to 503. */
export class PoolUnavailableError extends AppError {
    code = "POOL_UNAVAILABLE";
    statusCode = 503;
}
/** Requested an unknown indicator or symbol. Maps to 400. */
export class UnknownResourceError extends AppError {
    code = "UNKNOWN_RESOURCE";
    statusCode = 400;
}
export function isAppError(value) {
    return value instanceof AppError;
}
/** Narrow a Playwright TimeoutError (matched by name, cross-version safe). */
export function isTimeoutLike(value) {
    return (value instanceof Error &&
        (value.name === "TimeoutError" || /timeout/i.test(value.message)));
}
//# sourceMappingURL=errors.js.map