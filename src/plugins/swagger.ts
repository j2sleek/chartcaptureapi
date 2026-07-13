import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

/** Register OpenAPI generation and the interactive docs UI at /docs. */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "ChartCapture API",
        description:
          "Production-grade screenshot API for Coinalyze/TradingView charts.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", name: "X-API-Key", in: "header" },
        },
      },
      tags: [
        { name: "capture", description: "Chart capture endpoints" },
        { name: "system", description: "Health & metrics" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });
}
