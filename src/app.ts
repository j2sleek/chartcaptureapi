import Fastify from "fastify";

import healthRoutes from "./routes/health.js";
import screenshotRoutes from "./routes/screenshot.js";

const app = Fastify({
    logger: true
});

app.register(healthRoutes);
app.register(screenshotRoutes);

export default app;
