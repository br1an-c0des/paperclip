import { expect, LIVE, test } from "./fixtures/test";

/*
 * Live mode (`E2E_LIVE=1`): the read-only journeys against a real server (:3100, or
 * PAPERCLIP_API_URL), in the test company TES. Reads go through to the server; every write is still
 * answered by the fake API and never sent (fixtures/mock-api.ts). Nothing here creates, changes or
 * wakes anything.
 *
 * The server must be reachable, and either local_trusted or signed in: on an authenticated server,
 * save a signed-in browser state (`corepack pnpm exec playwright codegen --save-storage=<file>
 * http://localhost:5184`) and pass it as E2E_LIVE_STORAGE_STATE=<file>. Otherwise these skip.
 */

const TES_ID = process.env.E2E_LIVE_COMPANY_ID ?? "c3948f92-4af2-414f-81c4-88f1c59bf2ab";
const SERVER = process.env.PAPERCLIP_API_URL ?? "http://localhost:3100";

if (process.env.E2E_LIVE_STORAGE_STATE) test.use({ storageState: process.env.E2E_LIVE_STORAGE_STATE });

let prefix: string | null = null;
let skipReason: string | null = null;

test.beforeAll(async ({ playwright }) => {
  if (!LIVE) {
    skipReason = "live mode only (E2E_LIVE=1)";
    return;
  }
  const request = await playwright.request.newContext({
    baseURL: SERVER,
    storageState: process.env.E2E_LIVE_STORAGE_STATE,
  });
  try {
    const health = await request.get("/api/health", { timeout: 3_000 }).catch(() => null);
    if (!health?.ok()) {
      skipReason = `no Paperclip server answers at ${SERVER}`;
      return;
    }
    const company = await request.get(`/api/companies/${TES_ID}`, { timeout: 5_000 });
    if (!company.ok()) {
      skipReason = `can't read company ${TES_ID} (${company.status()}): sign in with E2E_LIVE_STORAGE_STATE`;
      return;
    }
    prefix = ((await company.json()) as { issuePrefix: string }).issuePrefix;
  } finally {
    await request.dispose();
  }
});

test.beforeEach(() => {
  test.skip(!!skipReason, skipReason ?? "");
});

test("the company list shows TES and opens its dashboard", async ({ page }) => {
  await page.goto("/companies");
  await expect(page.getByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
  await page.locator(`a[href="/${prefix}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${prefix}/dashboard$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("Inbox and the task list render, and a task opens", async ({ page }) => {
  await page.goto(`/${prefix}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await page.goto(`/${prefix}/issues`);
  await expect(page.getByRole("heading", { name: "All tasks", level: 1 })).toBeVisible();
  const first = page.locator(`main a[href^="/${prefix}/issues/"]`).first();
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\?task=/);
    await expect(page.getByRole("complementary").first()).toBeVisible();
  }
});

test("a project, an agent and settings render", async ({ page }) => {
  await page.goto(`/${prefix}/projects`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const project = page.locator(`main a[href^="/${prefix}/projects/"]`).first();
  if (await project.count()) {
    await project.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page.getByText("Project docs and files")).toBeVisible();
  }
  await page.goto(`/${prefix}/agents`);
  const agent = page.locator(`main a[href^="/${prefix}/agents/"]`).first();
  if (await agent.count()) {
    await agent.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.goto(`/${prefix}/company/settings`);
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
});
