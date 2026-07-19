# ChartCapture API

Production-grade screenshot API for **Coinalyze** crypto charts (which embed the
TradingView Charting Library). Render any supported market with a custom
timeframe and a stack of indicators, and get back a PNG/JPEG/WebP image — or a
JSON envelope with a base64 image — in a couple of seconds.

Built on **Fastify 5**, **Playwright** (Chromium), **Zod 4** and **pino**, with a
pre-warmed page pool so captures stay fast under concurrency.

---

## How it works

Cold-loading a chart page past the anti-bot challenge takes ~15–30s, far too slow
per request. Instead, on startup the service launches a small pool of Chromium
instances and **pre-warms a set of chart pages** that have already passed the
challenge and have the TradingView widget ready. Each capture borrows a warm
page, mutates it (symbol, timeframe, indicators), screenshots the chart canvas,
and returns the page to the pool. Warm captures land in ~2–6s.

```
request ─▶ p-queue (concurrency gate) ─▶ acquire warm page
                                          ├─ set symbol / timeframe
                                          ├─ apply indicators
                                          ├─ wait for render
                                          └─ screenshot canvas ─▶ image / JSON
```

Pages are recycled after `PAGE_MAX_USES` captures to bound memory, and a page
that errors mid-capture is marked unhealthy and replaced.

---

## Requirements

- **Node.js ≥ 20.11** (developed on 24.x)
- Chromium via Playwright — installed automatically by the `postinstall` hook
  (`playwright install chromium`), or provided by the Docker base image.

## Getting started

```bash
npm install                # installs deps + Chromium
cp .env.example .env        # adjust as needed
npm run build               # compile TypeScript → dist/
npm start                   # node dist/server.js
# dev with reload:
npm run dev
```

The server listens on `http://HOST:PORT` (default `0.0.0.0:3000`) and serves
interactive API docs at **`/docs`** (OpenAPI spec at `/docs/json`).

---

## Configuration

All configuration is via environment variables (validated at boot; the process
exits with a clear message if anything is invalid). See `.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address |
| `LOG_LEVEL` | `info` | pino level (`pino-pretty` in dev) |
| `BROWSER_POOL_SIZE` | `2` | Chromium instances to launch |
| `PAGE_POOL_SIZE` | `4` | Pre-warmed chart pages kept ready |
| `CAPTURE_CONCURRENCY` | `4` | Max simultaneous captures (clamped to `PAGE_POOL_SIZE`) |
| `PAGE_MAX_USES` | `200` | Recycle a page after this many captures |
| `CAPTURE_TIMEOUT` | `30000` | Per-capture budget (ms) |
| `NAV_TIMEOUT` | `60000` | Cold page-load timeout (ms) |
| `WIDGET_TIMEOUT` | `15000` | Wait for widget/chart readiness (ms). Auto-clamped to ≤ half of `CAPTURE_TIMEOUT` so the retry fits in budget |
| `RENDER_SETTLE_MS` | `1200` | Settle time after mutations before screenshot (ms) |
| `MAX_BATCH` | `20` | Max items per batch request |
| `API_KEYS` | _(empty)_ | Comma-separated keys. **Empty ⇒ auth disabled** |
| `RATE_LIMIT_MAX` | `60` | Requests per window per key/IP |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window |
| `CORS_ORIGINS` | _(empty)_ | Comma-separated origins; empty reflects all |
| `COINALYZE_BASE` | `https://coinalyze.net` | Base URL |
| `WARMUP_PATH` | `/bitcoin/open-interest/` | Page used to warm the pool |
| `USER_AGENT` / `LOCALE` / `TIMEZONE` | _(realistic defaults)_ | Browser fingerprint |
| `PROXY_SERVER` | _(empty)_ | Outbound proxy URL for the browser, e.g. `http://user:pass@host:port` or `socks5://host:port`. Empty ⇒ direct egress. Use a residential/ISP proxy if Coinalyze's anti-bot blocks the datacenter IP |
| `PROXY_USERNAME` / `PROXY_PASSWORD` | _(empty)_ | Proxy credentials (override any embedded in `PROXY_SERVER`) |
| `PROXY_BYPASS` | _(empty)_ | Comma-separated hosts that skip the proxy |

---

## Authentication

When `API_KEYS` is set (comma-separated), every request except `/health*` and
`/docs*` must present a key via either header:

```
X-API-Key: <key>
Authorization: Bearer <key>
```

When `API_KEYS` is empty, auth is **disabled** and a warning is logged at
startup — convenient for local dev, but set keys in production.

---

## API

### `POST /capture`

Render one chart. Returns the raw image by default (`Content-Type` matches the
`format`), or a JSON envelope when `json: true`.

Request body (all fields optional; defaults shown):

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `symbol` | string | `bitcoin` | Friendly slug (`bitcoin`, `btc`, `ethereum`, …) or a raw widget symbol (`BTC_AVGPRICE`) |
| `metric` | string | `open-interest` | `open-interest`, `funding-rate`, `liquidations`, `long-short-ratio` |
| `timeframe` | string | `1D` | `1,5,15,30,60,120,240,360,720,1D,1W,1M` or aliases `1m,5m,15m,30m,1h,2h,4h,6h,12h,1d,daily,1w,weekly,1mo,monthly` |
| `indicators` | array | `[]` | Up to 10; each `{ name, inputs?, overlay? }` |
| `width` / `height` | int | `1280` / `800` | 320–3840 / 200–2160 |
| `format` | string | `png` | `png` \| `jpeg` \| `webp` |
| `quality` | int | `90` | 1–100 (ignored for png) |
| `json` | bool | `false` | Return JSON envelope instead of raw image |

Indicators use TradingView study names, e.g. `Moving Average`,
`Relative Strength Index`, `Bollinger Bands`, `MACD`, `Volume`. `inputs` are the
study's parameters (e.g. `[21]` for an MA length) and `overlay` controls whether
it draws on the price pane.

**Example — image to file:**

```bash
curl -X POST http://127.0.0.1:3000/capture \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "symbol": "bitcoin",
    "metric": "open-interest",
    "timeframe": "1d",
    "indicators": [
      { "name": "Moving Average", "inputs": [21], "overlay": true },
      { "name": "Relative Strength Index", "inputs": [14] }
    ],
    "format": "png",
    "width": 1280,
    "height": 800
  }' \
  --output chart.png
```

Response headers on the image include `X-Capture-Duration-Ms` and
`X-Capture-Symbol`.

**Example — JSON envelope:**

```bash
curl -X POST http://127.0.0.1:3000/capture \
  -H "Content-Type: application/json" \
  -d '{ "symbol": "ethereum", "timeframe": "4h", "json": true }'
```

```json
{
  "success": true,
  "image": "<base64>",
  "format": "png",
  "width": 721,
  "height": 664,
  "durationMs": 1366,
  "symbol": "ETH_AVGPRICE",
  "timeframe": "240"
}
```

### `POST /capture/batch`

Render many charts in one request (bounded by `MAX_BATCH` and the concurrency
queue). One failing item never fails the batch — each result carries its own
`success`/`error`.

```bash
curl -X POST http://127.0.0.1:3000/capture/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "symbol": "bitcoin",  "timeframe": "1d" },
      { "symbol": "ethereum", "timeframe": "1h", "format": "jpeg",
        "indicators": [{ "name": "Relative Strength Index", "inputs": [14] }] }
    ]
  }'
```

```json
{
  "success": true,
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "results": [
    { "index": 0, "success": true,
      "data": { "image": "<base64>", "format": "png", "width": 1201, "height": 664,
                "durationMs": 2154, "symbol": "BTC_AVGPRICE", "timeframe": "1D" } },
    { "index": 1, "success": true, "data": { "…": "…" } }
  ]
}
```

### `GET /capture/options`

Lists supported symbols, metrics, timeframes and formats.

### System endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Liveness (always 200 while the process is up) |
| `GET /health/ready` | Readiness — 503 until the page pool is warm |
| `GET /metrics` | Uptime, browser/pool/queue stats, memory |
| `GET /docs` | Swagger UI (spec at `/docs/json`) |

---

## Error format

All errors share one envelope:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body failed schema validation (`details` lists issues) |
| `UNKNOWN_RESOURCE` | 400 | Unknown symbol or metric |
| `UNAUTHORIZED` | 401 | Missing/invalid API key |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `CAPTURE_FAILED` | 502 | Chart could not be rendered |
| `POOL_UNAVAILABLE` | 503 | No warm page available |
| `CAPTURE_TIMEOUT` | 504 | Capture exceeded its time budget |
| `NOT_FOUND` | 404 | Unknown route |

---

## Docker

The image builds on the official Playwright image (Chromium + system libs
included) and runs as the non-root `pwuser`.

```bash
docker build -t chartcapture-api .
docker run --rm -p 3000:3000 \
  -e API_KEYS=your-secret-key \
  -e PAGE_POOL_SIZE=4 \
  chartcapture-api
```

A `HEALTHCHECK` polls `/health`. Give the container ~40s to warm the pool before
readiness (`/health/ready`) flips to 200.

### Deploy to Render

A `render.yaml` Blueprint is included (Docker runtime).

1. Push this repo to GitHub.
2. In Render: **New +** → **Blueprint** → select the repo. It reads `render.yaml`.
3. Set the `API_KEYS` secret in the dashboard (it's `sync: false`, so it is
   never committed). Use one or more comma-separated keys.
4. Deploy. The health check is `/health` (liveness); the first request or two
   right after a deploy may return `503 POOL_UNAVAILABLE` for a few seconds
   while the page pool warms — this self-corrects.

The blueprint targets the **Starter (512 MB)** plan, tuned to 1 browser / 1 warm
page / concurrency 1. Chromium is memory-hungry: under real load expect
occasional OOM restarts on 512 MB — bump `plan` to `standard` (2 GB) and raise
`PAGE_POOL_SIZE`/`CAPTURE_CONCURRENCY` if that happens.

---

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test — env, schema, symbols, errors (no network)
npm run build       # compile to dist/
```

The test suite is offline: it covers env validation/clamping, schema defaults &
timeframe-alias resolution, symbol/metric mapping, and the error hierarchy. Live
chart capture is exercised manually against Coinalyze (see the curl examples).

## Project layout

```
src/
  config/env.ts            Zod-validated environment (fail-fast)
  utils/                   logger, typed error hierarchy
  services/
    browserManager.ts      launches/relaunches stealth Chromium
    pagePool.ts            pre-warmed page pool (acquire/release/recycle)
    tradingview.ts         the ONLY chartWidget interface
    symbols.ts             symbol/metric → page path + widget symbol
    capture.ts             orchestration, retries, concurrency, batch
  schemas/capture.ts       request schemas + timeframe aliases
  plugins/                 auth, swagger
  routes/                  capture, health, metrics
  controllers/             request handlers
  app.ts / server.ts       Fastify wiring + lifecycle
```

## Notes & limits

- Charts and data belong to Coinalyze/TradingView. Use responsibly and within
  their terms; this tool automates a real browser session.
- Symbols use Coinalyze's `<TICKER>_AVGPRICE` convention. Add new markets in
  `src/services/symbols.ts`.
