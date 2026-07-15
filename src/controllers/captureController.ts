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
export async function handleBatchStream(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = parse<{ items: CaptureRequest[] }>(
    BatchSchema,
    request.body ?? {},
  );

  // Take ownership of the raw socket; Fastify will not touch the reply.
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no", // disable proxy buffering so lines flush live
    Connection: "keep-alive",
  });

  const write = (obj: unknown): void => {
    reply.raw.write(`${JSON.stringify(obj)}\n`);
  };

  const total = input.items.length;
  write({ type: "meta", total, timestamp: Date.now() });

  let succeeded = 0;
  try {
    for await (const result of captureBatchStream(input.items)) {
      if (result.success) succeeded += 1;
      write({ type: "result", ...result });
    }
    write({
      type: "done",
      total,
      succeeded,
      failed: total - succeeded,
      timestamp: Date.now(),
    });
  } catch (error) {
    // Headers are already sent, so surface the failure as a stream line
    // rather than a (now-impossible) error status.
    request.log.error({ err: error }, "Batch stream aborted");
    write({
      type: "error",
      message: error instanceof Error ? error.message : "stream failed",
    });
  } finally {
    reply.raw.end();
  }
}
