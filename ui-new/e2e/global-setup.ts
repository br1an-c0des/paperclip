import { chromium, type FullConfig } from "@playwright/test";
import { installDefaultHandlers } from "./fixtures/handlers";
import { MockApi } from "./fixtures/mock-api";

/*
 * Warms the dev server before the tests start: Vite compiles each module on its first request, so
 * the first page load is slow (seconds), and several workers paying that at once can run tests
 * into their timeouts. One mocked visit to the main pages here pays it once.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    const api = new MockApi();
    installDefaultHandlers(api);
    await api.install(context);
    const page = await context.newPage();
    for (const path of ["/MSE/issues", "/MSE/issues/MSE-2?section=activity", "/MSE/inbox", "/MSE/projects/m7-test-website", "/MSE/agents/m7-test-builder", "/MSE/company/settings/budgets"]) {
      await page.goto(path);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
    }
  } finally {
    await browser.close();
  }
}
