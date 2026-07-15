import type { FastifyInstance } from "fastify";
import {
  handleBatch,
  handleBatchStream,
  handleCapture,
} from "../controllers/captureController.js";
import { TIMEFRAMES, IMAGE_FORMATS } from "../schemas/capture.js";
import { SUPPORTED_METRICS, SUPPORTED_SYMBOLS } from "../services/symbols.js";

/**
 * JSON Schema for OpenAPI docs only. Runtime validation is done by Zod in the
 * controller (single source of truth), so we keep `additionalProperties` open
 * here to avoid Fastify stripping fields before Zod sees them.
 */
const captureBody = {
  type: "object",
  additionalProperties: true,
  properties: {
    symbol: { type: "string", examples: ["bitcoin", "ethereum", "BTC_AVGPRICE"] },
    metric: { type: "string", enum: SUPPORTED_METRICS, default: "open-interest" },
    timeframe: {
      type: "string",
      description: `One of ${TIMEFRAMES.join(", ")} or aliases (1h, 4h, daily, weekly).`,
      default: "1D",
    },
    indicators: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", examples: ["Moving Average", "Relative Strength Index"] },
          inputs: { type: "array", items: {} },
          overlay: { type: "boolean" },
        },
      },
    },
    width: { type: "integer", minimum: 320, maximum: 3840, default: 1280 },
    height: { type: "integer", minimum: 200, maximum: 2160, default: 800 },
    format: { type: "string", enum: [...IMAGE_FORMATS], default: "png" },
    quality: { type: "integer", minimum: 1, maximum: 100, default: 90 },
    json: { type: "boolean", default: false },
  },
} as const;

// eslint-disable-next-line @typescript-eslint/require-await
export default async function captureRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/capture",
    {
      schema: {
        tags: ["capture"],
        summary: "Capture a single chart screenshot",
        description:
          "Renders a Coinalyze/TradingView chart with the requested symbol, " +
          "timeframe and indicators. Returns an image by default, or a JSON " +
          "envelope with a base64 image when `json: true`.",
        body: captureBody,
      },
    },
    handleCapture,
  );

  app.post(
    "/capture/batch",
    {
      schema: {
        tags: ["capture"],
        summary: "Capture multiple charts in one request",
        body: {
          type: "object",
          required: ["items"],
          additionalProperties: false,
          properties: {
            items: { type: "array", items: captureBody, minItems: 1 },
          },
        },
      },
    },
    handleBatch,
  );

  app.post(
    "/capture/batch/stream",
    {
      schema: {
        tags: ["capture"],
        summary: "Stream multiple chart captures as newline-delimited JSON",
        description:
          "Same body as /capture/batch, but responds with " +
          "application/x-ndjson: a `meta` line first, one `result` line per " +
          "capture as it finishes (in completion order — use each line's " +
          "`index` to map back to the request), then a `done` summary. " +
          "Preferred for large batches: bytes flow continuously so the " +
          "request never hits a gateway/client idle timeout.",
        body: {
          type: "object",
          required: ["items"],
          additionalProperties: false,
          properties: {
            items: { type: "array", items: captureBody, minItems: 1 },
          },
        },
      },
    },
    handleBatchStream,
  );

  app.get(
    "/capture/options",
    { schema: { tags: ["capture"], summary: "List supported symbols/metrics/timeframes" } },
    async () => ({
      symbols: SUPPORTED_SYMBOLS,
      metrics: SUPPORTED_METRICS,
      timeframes: TIMEFRAMES,
      formats: IMAGE_FORMATS,
    }),
  );
}
