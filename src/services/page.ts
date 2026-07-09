import type { Page } from "playwright";

const BLOCKED_RESOURCE_TYPES = new Set([
  "media",
  "font"
]);

const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com",
  "hotjar.com",
  "segment.io",
  "mixpanel.com"
];

export async function optimizePage(page: Page) {
  await page.route("**/*", async route => {
    const request = route.request();
    const url = request.url();

    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      return route.abort();
    }

    if (BLOCKED_DOMAINS.some(domain => url.includes(domain))) {
      return route.abort();
    }

    return route.continue();
  });
}
