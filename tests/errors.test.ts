import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AppError,
  ValidationError,
  UnauthorizedError,
  CaptureTimeoutError,
  CaptureFailedError,
  PoolUnavailableError,
  UnknownResourceError,
  isAppError,
  isTimeoutLike,
} from "../src/utils/errors.js";

test("each AppError subclass carries its stable code and status", () => {
  const cases: Array<[AppError, string, number]> = [
    [new ValidationError("x"), "VALIDATION_ERROR", 400],
    [new UnauthorizedError("x"), "UNAUTHORIZED", 401],
    [new CaptureTimeoutError("x"), "CAPTURE_TIMEOUT", 504],
    [new CaptureFailedError("x"), "CAPTURE_FAILED", 502],
    [new PoolUnavailableError("x"), "POOL_UNAVAILABLE", 503],
    [new UnknownResourceError("x"), "UNKNOWN_RESOURCE", 400],
  ];
  for (const [error, code, status] of cases) {
    assert.equal(error.code, code);
    assert.equal(error.statusCode, status);
    assert.ok(isAppError(error));
    assert.equal(error.name, error.constructor.name);
  }
});

test("ValidationError preserves optional details", () => {
  const details = [{ path: "symbol", message: "required" }];
  const error = new ValidationError("bad", details);
  assert.deepEqual(error.details, details);
});

test("isAppError rejects plain errors and non-errors", () => {
  assert.equal(isAppError(new Error("plain")), false);
  assert.equal(isAppError("string"), false);
  assert.equal(isAppError(null), false);
});

test("isTimeoutLike matches by name or message, cross-version safe", () => {
  const named = new Error("boom");
  named.name = "TimeoutError";
  assert.equal(isTimeoutLike(named), true);
  assert.equal(isTimeoutLike(new Error("operation timeout exceeded")), true);
  assert.equal(isTimeoutLike(new Error("something else")), false);
  assert.equal(isTimeoutLike("timeout"), false);
});
