import { getBrowser } from "./browser.js";
import type { CaptureRequest } from "../schemas/capture.js";
import { optimizePage } from "./page.js";
import { captureQueue } from "../utils/queue.js";

export async function capture(data: CaptureRequest) {
  return captureQueue.add(async () => {
    const browser = await getBrowser();

    const context = await browser.newContext({
      viewport: {
        width: data.width,
        height: data.height,
      },
    });

    async function navigate(page: Page, url: string) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await page.goto(url, {
            waitUntil: "networkidle",
            timeout: 30000
          });
          return;
        } catch (error) {
          if (attempt === 3) {
            throw error;
          }
        }
      }
    }

    try {
      const page = await context.newPage();

      await optimizePage(page);

      await navigate(page, data.url);

      return await page.screenshot({
        type: data.format,
        fullPage: data.fullPage,
      });
    } finally {
      await context.close();
    }
  });
}
