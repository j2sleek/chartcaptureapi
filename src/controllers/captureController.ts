import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  BatchSchema,
  CaptureSchema,
  type CaptureRequest,
} from "../schemas/capture.js";
import { ValidationError } from "../utils/errors.js";
import {
  capture,
  captureBatch,
  captureBatchStream,
} from "../services/capture.js";

const CONTENT_TYPE: Record<CaptureRequest["format"], string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Parse `body` with a Zod schema, throwing a typed ValidationError on failure. */
function parse<T>(schema: { safeParse: (v: unknown) => any }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Request validation failed", result.error.issues);
  }
  return result.data as T;
}

export async function handleCapture(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input = parse<CaptureRequest>(CaptureSchema, request.body ?? {});
  const result = await capture(input);

  if (input.json) {
    return reply.status(200).send({
      success: true,
      image: result.buffer.toString("base64"),
      format: result.format,
      width: result.width,
      height: result.height,
      durationMs: result.durationMs,
      symbol: result.symbol,
      timeframe: result.timeframe,
    });
  }

  return reply
    .status(200)
    .header("Content-Type", CONTENT_TYPE[result.format])
    .header("X-Capture-Duration-Ms", String(result.durationMs))
    .header("X-Capture-Symbol", result.symbol)
    .send(result.buffer);
}

export async function handleBatch(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input = parse<{ items: CaptureRequest[] }>(
    BatchSchema,
    request.body ?? {},
  );
  const results = await captureBatch(input.items);
  const succeeded = results.filter((r) => r.success).length;

  return reply.status(200).send({
    success: true,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
}

/**
 * Streaming batch as newline-delimited JSON (application/x-ndjson). Emits:
 *   1. one `{"type":"meta",...}` line immediately (first byte defeats idle
 *      timeouts before any capture finishes),
 *   2. one `{"type":"result",...}` line per capture as it completes, and
 *   3. a final `{"type":"done",...}` summary line.
 * Writing incrementally keeps the connection producing bytes for the whole
 * batch, so it never trips the 60s gateway/client abort that buffering hits.
 */
export function handleBatchStream(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const input = parse<{ items: CaptureRequest[] }>(
    BatchSchema,
    request.body ?? {},
  );

  const total = input.items.length;

  // Produce NDJSON lines lazily. Returning this as a stream (rather than
  // hijacking the socket) is important: Fastify still applies the reply
  // headers set by the CORS/helmet hooks, so browser clients get the
  // Access-Control-Allow-Origin header. Hijacking skips those hooks, which
  // manifests in the browser as an opaque "Failed to fetch".
  async function* lines(): AsyncGenerator<string> {
    yield `${JSON.stringify({ type: "meta", total, timestamp: Date.now() })}\n`;

    let succeeded = 0;
    try {
      for await (const result of captureBatchStream(input.items)) {
        if (result.success) succeeded += 1;
        yield `${JSON.stringify({ type: "result", ...result })}\n`;
      }
      yield `${JSON.stringify({
        type: "done",
        total,
        succeeded,
        failed: total - succeeded,
        timestamp: Date.now(),
      })}\n`;
    } catch (error) {
      // The response is already streaming, so surface the failure as a line
      // rather than an (impossible now) error status code.
      request.log.error({ err: error }, "Batch stream aborted");
      yield `${JSON.stringify({
        type: "error",
        message: error instanceof Error ? error.message : "stream failed",
      })}\n`;
    }
  }

  reply
    .header("Content-Type", "application/x-ndjson")
    .header("Cache-Control", "no-cache, no-transform")
    .header("X-Accel-Buffering", "no"); // disable proxy buffering

  return reply.send(Readable.from(lines()));
}
