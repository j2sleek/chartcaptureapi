import type { FastifyInstance } from "fastify";
import { CaptureSchema } from "../schemas/capture.js";
import { capture } from "../services/screenshot.js";

export default async function (app: FastifyInstance) {

    app.post("/capture", async (request, reply) => {

        const body = CaptureSchema.parse(request.body);

        try {
           const image = await capture(body);

           return reply
             .type(`image/${body.format}`)
             .send(image);

        } catch (error: any) {
          request.log.error(error);

          if (error.name === "TimeoutError") {
            return reply.status(504).send({
              success: false,
              error: "CAPTURE_TIMEOUT"
            });
          }

          return reply.status(500).send({
            success: false,
            error: "SCREENSHOT_FAILED"
          });
        }

    });

}
