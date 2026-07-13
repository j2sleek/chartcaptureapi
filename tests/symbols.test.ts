import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTarget,
  SUPPORTED_SYMBOLS,
  SUPPORTED_METRICS,
} from "../src/services/symbols.js";
import { isAppError } from "../src/utils/errors.js";

test("friendly slug resolves to page path and widget symbol", () => {
  const target = resolveTarget("bitcoin", "open-interest");
  assert.equal(target.ticker, "BTC");
  assert.equal(target.widgetSymbol, "BTC_AVGPRICE");
  assert.equal(target.metricPath, "/bitcoin/open-interest/");
});

test("ticker alias resolves the same as the long slug", () => {
  const a = resolveTarget("btc", "open-interest");
  const b = resolveTarget("bitcoin", "open-interest");
  assert.deepEqual(a, b);
});

test("a raw widget symbol is passed through and its page derived", () => {
  const target = resolveTarget("ETH_AVGPRICE", "funding-rate");
  assert.equal(target.ticker, "ETH");
  assert.equal(target.widgetSymbol, "ETH_AVGPRICE");
  assert.equal(target.metricPath, "/ethereum/funding-rate/");
});

test("metric is normalized (spaces, casing)", () => {
  const target = resolveTarget("bitcoin", "Funding Rate");
  assert.equal(target.metricPath, "/bitcoin/funding-rate/");
});

test("unknown symbol throws an UNKNOWN_RESOURCE AppError", () => {
  try {
    resolveTarget("notacoin", "open-interest");
    assert.fail("expected resolveTarget to throw");
  } catch (error) {
    assert.ok(isAppError(error));
    assert.equal(error.code, "UNKNOWN_RESOURCE");
  }
});

test("unknown metric throws an UNKNOWN_RESOURCE AppError", () => {
  try {
    resolveTarget("bitcoin", "made-up-metric");
    assert.fail("expected resolveTarget to throw");
  } catch (error) {
    assert.ok(isAppError(error));
    assert.equal(error.code, "UNKNOWN_RESOURCE");
  }
});

test("widget symbol with an unsupported ticker is rejected", () => {
  assert.throws(() => resolveTarget("ZZZ_AVGPRICE", "open-interest"));
});

test("every supported symbol resolves for every supported metric", () => {
  for (const symbol of SUPPORTED_SYMBOLS) {
    for (const metric of SUPPORTED_METRICS) {
      const target = resolveTarget(symbol, metric);
      assert.match(target.widgetSymbol, /^[A-Z]+_AVGPRICE$/);
      assert.match(target.metricPath, /^\/[a-z]+\/[a-z-]+\/$/);
    }
  }
});
