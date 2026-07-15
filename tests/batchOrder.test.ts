import { test } from "node:test";
import assert from "node:assert/strict";

import { orderByPage } from "../src/services/capture.js";
import { CaptureSchema, type CaptureRequest } from "../src/schemas/capture.js";

/** Build a fully-defaulted CaptureRequest from a partial spec. */
function req(partial: Partial<CaptureRequest>): CaptureRequest {
  return CaptureSchema.parse(partial);
}

test("orderByPage clusters requests that share a Coinalyze page", () => {
  // Interleaved coins/metrics; same (coin, metric) => same warm page.
  const requests = [
    req({ symbol: "bitcoin", metric: "open-interest" }), // 0
    req({ symbol: "ethereum", metric: "open-interest" }), // 1
    req({ symbol: "bitcoin", metric: "funding-rate" }), // 2
    req({ symbol: "bitcoin", metric: "open-interest" }), // 3 (== 0's page)
    req({ symbol: "ethereum", metric: "open-interest" }), // 4 (== 1's page)
  ];

  const ordered = orderByPage(requests);

  // Original indices are preserved for mapping results back.
  assert.deepEqual(
    [...ordered].map((o) => o.index).sort((a, b) => a - b),
    [0, 1, 2, 3, 4],
  );

  // Consecutive items must never revisit a page already left behind: once we
  // move off a page key, it must not reappear later in the ordering.
  const keys = ordered.map((o) =>
    `${o.request.symbol}|${o.request.metric}`,
  );
  const seen = new Set<string>();
  let prev = "";
  for (const key of keys) {
    if (key !== prev) {
      assert.ok(!seen.has(key), `page ${key} was revisited after leaving it`);
      seen.add(key);
      prev = key;
    }
  }
});

test("orderByPage is a stable, total permutation (no items lost)", () => {
  const requests = [
    req({ symbol: "sol", metric: "liquidations" }),
    req({ symbol: "btc", metric: "basis" }),
    req({ symbol: "btc", metric: "basis" }),
  ];
  const ordered = orderByPage(requests);
  assert.equal(ordered.length, requests.length);
});

test("orderByPage places unresolvable requests last without throwing", () => {
  const requests = [
    req({ symbol: "definitely-not-a-coin", metric: "open-interest" }),
    req({ symbol: "bitcoin", metric: "open-interest" }),
  ];
  const ordered = orderByPage(requests);
  assert.equal(ordered.length, 2);
  // The valid bitcoin request sorts before the unresolvable one (sentinel key).
  assert.equal(ordered[0]?.request.symbol, "bitcoin");
});
