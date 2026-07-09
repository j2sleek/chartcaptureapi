import app from "./app.js";
import { env } from "./config/env.js";
import { closeBrowser } from "./services/browser.js";

async function start() {
  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST
    });

    console.log(`ChartCapture API running on ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});

start();
