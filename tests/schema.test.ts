import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaptureSchema,
  BatchSchema,
  TIMEFRAME_ALIASES,
  TIMEFRAMES,
} from "../src/schemas/capture.js";

test("CaptureSchema applies sensible defaults for an empty object", () => {
  const parsed = CaptureSchema.parse({});
  assert.equal(parsed.symbol, "bitcoin");
  assert.equal(parsed.metric, "open-interest");
  assert.equal(parsed.timeframe, "1D");
  assert.deepEqual(parsed.indicators, []);
  assert.equal(parsed.width, 1280);
  assert.equal(parsed.height, 800);
  assert.equal(parsed.format, "png");
  assert.equal(parsed.quality, 90);
  assert.equal(parsed.json, false);
});

test("timeframe aliases resolve to widget resolutions", () => {
  for (const [alias, resolution] of Object.entries(TIMEFRAME_ALIASES)) {
    const parsed = CaptureSchema.parse({ timeframe: alias });
    assert.equal(
      parsed.timeframe,
      resolution,
      `alias "${alias}" should map to "${resolution}"`,
    );
  }
});

test("timeframe aliases are case-insensitive", () => {
  assert.equal(CaptureSchema.parse({ timeframe: "1H" }).timeframe, "60");
  assert.equal(CaptureSchema.parse({ timeframe: "Daily" }).timeframe, "1D");
});

test("raw widget resolutions are accepted unchanged", () => {
  for (const tf of TIMEFRAMES) {
    assert.equal(CaptureSchema.parse({ timeframe: tf }).timeframe, tf);
  }
});

test("unknown timeframe is rejected", () => {
  assert.throws(() => CaptureSchema.parse({ timeframe: "3h" }));
  assert.throws(() => CaptureSchema.parse({ timeframe: "banana" }));
});

test("indicator defaults are applied per item", () => {
  const parsed = CaptureSchema.parse({
    indicators: [{ name: "Moving Average" }],
  });
  assert.equal(parsed.indicators.length, 1);
  assert.deepEqual(parsed.indicators[0]!.inputs, []);
  assert.equal(parsed.indicators[0]!.overlay, false);
});

test("indicator name must be non-empty", () => {
  assert.throws(() => CaptureSchema.parse({ indicators: [{ name: "" }] }));
});

test("width/height bounds are enforced", () => {
  assert.throws(() => CaptureSchema.parse({ width: 100 })); // below 320
  assert.throws(() => CaptureSchema.parse({ height: 5000 })); // above 2160
});

test("numeric string dimensions are coerced", () => {
  const parsed = CaptureSchema.parse({ width: "1920", height: "1080" });
  assert.equal(parsed.width, 1920);
  assert.equal(parsed.height, 1080);
});

test("format is restricted to the known image types", () => {
  assert.equal(CaptureSchema.parse({ format: "jpeg" }).format, "jpeg");
  assert.throws(() => CaptureSchema.parse({ format: "gif" }));
});

test("more than 10 indicators is rejected", () => {
  const indicators = Array.from({ length: 11 }, () => ({ name: "RSI" }));
  assert.throws(() => CaptureSchema.parse({ indicators }));
});

test("BatchSchema requires at least one item", () => {
  assert.throws(() => BatchSchema.parse({ items: [] }));
});

test("BatchSchema parses a valid multi-item batch", () => {
  const parsed = BatchSchema.parse({
    items: [{ symbol: "bitcoin" }, { symbol: "ethereum", timeframe: "4h" }],
  });
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1]!.timeframe, "240");
});
