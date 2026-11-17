import { defineConfig, devices } from "@playwright/test";

/*
 * The ui-new smoke suite (e2e/, see ui-new/README.md). Playwright starts the app on :5184 itself.
 *
 * - Mocked (default): every `/api` request is answered by e2e/fixtures, so no Paperclip server is
 *   needed, and the app's `/api` proxy points at a closed port so nothing can leak to one.
 * - Live (`E2E_LIVE=1`): only e2e/live.spec.ts runs, reading from the server on :3100 (or
 *   PAPERCLIP_API_URL) through the proxy; every write is still answered by the fake API.
 *
 * The app is a production build served by `vite preview` (about 15 s to build, then each page loads
 * in well under a second). `E2E_DEV=1` runs against the Vite dev server instead: no build, but
 * every page load compiles modules on demand, which makes the suite several times slower.
 * `E2E_REUSE_SERVER=1` uses whatever already listens on :5184 (mind its proxy target).
 *
 * `@playwright/test` comes from the workspace root's devDependencies; the browser is the Chromium
 * headless shell in ~/.cache/ms-playwright.
 */

const PORT = 5184;
const LIVE = process.env.E2E_LIVE === "1";
const DEV = process.env.E2E_DEV === "1";
const apiTarget = LIVE ? (process.env.PAPERCLIP_API_URL ?? "http://localhost:3100") : "http://127.0.0.1:9";
const server = DEV
  ? `corepack pnpm exec vite --port ${PORT} --strictPort`
  : `corepack pnpm exec vite build --outDir e2e/.dist --emptyOutDir --logLevel error && corepack pnpm exec vite preview --outDir e2e/.dist --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: LIVE ? "live.spec.ts" : "**/*.spec.ts",
  testIgnore: LIVE ? [] : ["**/live.spec.ts"],
  // The dev server compiles each module on first request; warm it once before the workers start.
  globalSetup: DEV && !LIVE ? "./e2e/global-setup.ts" : undefined,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: DEV ? 60_000 : 30_000,
  expect: { timeout: DEV ? 15_000 : 7_500 },
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  outputDir: "e2e/.results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A service worker would answer requests before page.route sees them.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: server,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
    env: { PAPERCLIP_API_URL: apiTarget },
    stdout: "ignore",
    stderr: "pipe",
  },
});
