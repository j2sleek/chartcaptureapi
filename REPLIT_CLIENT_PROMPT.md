# Replit prompt — ChartCapture streaming client

Paste everything below into Replit's AI (Agent/Assistant) to rebuild the frontend.

---

Build/refactor the frontend for my **ChartCapture API** so it captures many crypto charts reliably and shows progress live. The old client sent one big batch request and called `res.json()` on it; it failed with `499 client closed request`, `The operation was aborted due to timeout`, and `Unexpected token '<', "<!DOCTYPE"...`. Those happened because the batch of 12 took longer than 60s, the request timed out, and a gateway HTML error page got parsed as JSON. The backend now supports **streaming**, so fix the client to use it.

## API

Base URL (env var `VITE_API_BASE_URL`): `https://chartcapture-api-production.up.railway.app`
If an API key is configured, send it as header `X-API-Key: <key>` (env `VITE_API_KEY`). If empty, send no auth header.

### Preferred endpoint — streaming NDJSON
`POST /capture/batch/stream`
Request body:
```json
{ "items": [ { "symbol": "bitcoin", "metric": "open-interest", "timeframe": "1D", "width": 1280, "height": 800, "format": "png", "json": true } ] }
```
- Each item's fields: `symbol` (slug like `bitcoin`/`eth` or widget symbol `BTC_AVGPRICE`), `metric` (`open-interest`, `funding-rate`, `liquidations`, `long-short-ratio`, `predicted-funding-rate`, `basis`), `timeframe` (`1`,`5`,`15`,`30`,`60`,`120`,`240`,`360`,`720`,`1D`,`1W`,`1M` or aliases `1h`,`4h`,`daily`,`weekly`), `width` (320–3840), `height` (200–2160), `format` (`png`|`jpeg`|`webp`), optional `quality` (1–100), optional `indicators` (array of `{ name, inputs?, overlay? }`).
- **Always set `json: true`** on stream items so images come back base64 in the JSON lines.

Response: `Content-Type: application/x-ndjson` — a stream of **newline-delimited JSON objects**, one per line, arriving progressively (NOT one big JSON array). Line types:
- `{ "type": "meta", "total": 12, "timestamp": 1699999999999 }` — sent immediately.
- `{ "type": "result", "index": 3, "success": true, "data": { "image": "<base64>", "format": "png", "width": 1280, "height": 800, "durationMs": 8123, "symbol": "BTC_AVGPRICE", "timeframe": "1D" } }` — one per chart, in **completion order** (not request order). Use `index` to map back to the request item.
- On a per-item failure: `{ "type": "result", "index": 5, "success": false, "error": { "code": "CAPTURE_TIMEOUT", "message": "..." } }` — show the error on that tile, keep the rest.
- `{ "type": "done", "total": 12, "succeeded": 11, "failed": 1, "timestamp": ... }` — final summary.
- `{ "type": "error", "message": "..." }` — only if the whole stream aborts.

### Other endpoints
- `GET /capture/options` → `{ symbols, metrics, timeframes, formats }` — use this to populate dropdowns instead of hardcoding.
- `POST /capture` → single capture. With `json:true` returns `{ success, image, format, width, height, durationMs, symbol, timeframe }`; otherwise returns the raw image bytes.
- `GET /health/ready` → 200 when the capture pool is warm, 503 while warming (~30s after deploy). Optionally check this before a large batch and show "warming up…".

## Client requirements

1. **Consume the stream incrementally** with `fetch` + a `ReadableStream` reader. Do NOT `await res.json()`. Parse line-by-line: read chunks, decode with `TextDecoder`, split on `\n`, keep the trailing partial line in a buffer, `JSON.parse` each complete line. Render each `result` the moment it arrives.

   Reference reader:
   ```js
   async function streamBatch(items, { onMeta, onResult, onDone, onError, signal }) {
     const res = await fetch(`${BASE}/capture/batch/stream`, {
       method: "POST",
       headers: { "Content-Type": "application/json", ...(KEY ? { "X-API-Key": KEY } : {}) },
       body: JSON.stringify({ items }),
       signal,
     });
     if (!res.ok || !res.body) {
       const text = await res.text().catch(() => "");
       throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
     }
     const reader = res.body.getReader();
     const decoder = new TextDecoder();
     let buffer = "";
     for (;;) {
       const { value, done } = await reader.read();
       if (done) break;
       buffer += decoder.decode(value, { stream: true });
       let nl;
       while ((nl = buffer.indexOf("\n")) !== -1) {
         const line = buffer.slice(0, nl).trim();
         buffer = buffer.slice(nl + 1);
         if (!line) continue;
         const msg = JSON.parse(line);
         if (msg.type === "meta") onMeta?.(msg);
         else if (msg.type === "result") onResult?.(msg);
         else if (msg.type === "done") onDone?.(msg);
         else if (msg.type === "error") onError?.(new Error(msg.message));
       }
     }
   }
   ```

2. **Guard every response.** Always check `res.ok` and read `res.text()` (never `.json()`) on failure so a gateway HTML page surfaces as a readable status, not `Unexpected token '<'`.

3. **No client-side abort mid-batch.** If you use `AbortController`, only trigger it from an explicit user "Cancel" button — do NOT set a short `AbortSignal.timeout`. The stream can legitimately run for minutes; it stays alive because bytes arrive continuously.

4. **Progressive UI:**
   - A responsive grid of chart tiles, one per requested item (render all tiles up front in a "queued" state using the request list).
   - On `meta`: show `0 / total` and a progress bar.
   - On each `result`: find the tile by `index`, swap it from spinner to the image (`data:image/<format>;base64,<data.image>`) or to an error state with the `error.code`/`message`; increment the completed counter and progress bar; optionally show `durationMs`.
   - On `done`: show a summary toast (`succeeded/failed`), stop the global spinner.
   - Keep partial success visible — one failed tile must not blank the others.

5. **Controls:** a form to build the batch — a symbol multi-select (or add-row UI), metric dropdown, timeframe dropdown, format + dimensions, and a "Capture N charts" button. Populate dropdowns from `GET /capture/options`. A "Cancel" button that aborts the in-flight stream. Let users download each image and a "Download all" (zip) option.

6. **Tech:** React + Vite + TypeScript, Tailwind for styling. Put the API base URL and key in env vars (`VITE_API_BASE_URL`, `VITE_API_KEY`). Keep the streaming logic in a reusable hook, e.g. `useBatchCapture()`, that exposes `{ tiles, status, progress, start, cancel }`.

7. **UX niceties:** disable the capture button while a stream is running; show elapsed time; if `GET /health/ready` returns 503, show "Backend warming up, retrying…" and poll every 3s before enabling capture.

Deliver a clean, mobile-friendly single page. Prioritize correctness of the streaming parser and the per-tile `index` mapping.
