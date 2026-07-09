import { chromium } from "playwright";
import type { Browser } from "playwright";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  return browser;
}

export async function closeBrowser() {
  if (!browser) return;

  await browser.close();
  browser = null;
}
