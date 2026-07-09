import { getBrowser } from "./browser.js";
import type { CaptureRequest } from "../schemas/capture.js";

export async function capture(data: CaptureRequest) {
  const browser = await getBrowser();

  const context = await browser.newContext({
    viewport: {
      width: data.width,
      height: data.height
    }
  });

  const page = await context.newPage();

  try {
    await page.goto(data.url, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    const image = await page.screenshot({
      type: data.format,
      fullPage: data.fullPage
    });

    return image;

  } finally {
    await context.close();
  }
}
