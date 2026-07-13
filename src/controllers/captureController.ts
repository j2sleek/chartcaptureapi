import type { FastifyReply, FastifyRequest } from "fastify";
import {
  BatchSchema,
  CaptureSchema,
  type CaptureRequest,
} from "../schemas/capture.js";
import { ValidationError } from "../utils/errors.js";
import { capture, captureBatch } from "../services/capture.js";

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
