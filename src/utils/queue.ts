import PQueue from "p-queue";

export const captureQueue = new PQueue({
  concurrency: Number(process.env.CAPTURE_CONCURRENCY ?? 10),

  timeout: Number(process.env.CAPTURE_TIMEOUT ?? 30000),

  throwOnTimeout: true
});
