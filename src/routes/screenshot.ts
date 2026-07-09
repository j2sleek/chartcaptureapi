import type { FastifyInstance } from "fastify";
import { CaptureSchema } from "../schemas/capture.js";
import { capture } from "../services/screenshot.js";

export default async function (app: FastifyInstance) {

    app.post("/capture", async (request, reply) => {

        const body = CaptureSchema.parse(request.body);

        const image = await capture(body);

        reply
            .type(`image/${body.format}`)
            .send(image);

    });

}
