import { pino, type LoggerOptions } from "pino";
import { env, isProduction } from "../config/env.js";

/**
 * Shared pino configuration. Exported so Fastify can build its request logger
 * from the same options (avoids instance-type mismatches) while standalone
 * modules use the {@link logger} instance below.
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
};

/** Central logger for non-request code paths (pools, services, startup). */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
