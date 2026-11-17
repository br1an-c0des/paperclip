import { expect, test } from "./fixtures/test";
import { COMPANY_ID } from "./fixtures/world";

// M1: move around the app (Inbox, Tasks, a project, Agents, settings), open the command palette,
// and create a task with New task.

test("moves between Inbox, Tasks, a project, an agent and settings", async ({ page, phone }) => {
  await page.goto("/MSE/dashboard");
  await expect(page.getByRole("heading", { name: "M7 test Smoke Co", level: 1 })).toBeVisible();
  const main = page.getByRole("navigation", { name: "Main" });

  // Inbox
  await main.getByRole("link", { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/MSE\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();

  // Tasks, then a project
  await main.getByRole("link", { name: phone ? "Tasks" : /^All tasks/ }).click();
  await expect(page).toHaveURL(/\/MSE\/issues$/);
  await expect(page.getByRole("link", { name: "M7 test Write the landing page" })).toBeVisible();
  if (phone) {
    // On the tasks page the dock's Tasks button opens the switcher sheet.
    await main.getByRole("button", { name: "Tasks" }).click();
    await page.getByRole("dialog").getByRole("link", { name: /M7 test Website/ }).click();
  } else {
    await main.getByRole("link", { name: /M7 test Website/ }).click();
  }
  await expect(page).toHaveURL(/\/MSE\/projects\/m7-test-website/);
  await expect(page.getByRole("heading", { name: /M7 test Website/, level: 1 })).toBeVisible();

  // An agent
  if (phone) {
    await main.getByRole("link", { name: /^Agents/ }).click();
    await expect(page).toHaveURL(/\/MSE\/agents$/);
    await page.getByRole("link", { name: "M7 test Builder", exact: true }).click();
  } else {
    await main.getByRole("link", { name: /M7 test Builder/ }).click();
  }
  await expect(page).toHaveURL(/\/MSE\/agents\/m7-test-builder/);
  await expect(page.getByRole("heading", { name: "M7 test Builder", level: 1 })).toBeVisible();

  // Settings: the organization's Settings tab, or on a phone the You sheet.
  if (phone) {
    // A detail page hides the dock; back on the task list, its Tasks button opens the sheet.
    await page.goto("/MSE/issues");
    await main.getByRole("button", { name: "Tasks" }).click();
    await page.getByRole("button", { name: "You: profile, theme and notifications" }).click();
    await page.getByRole("link", { name: /Settings and admin/ }).click();
  } else {
    await page.goto("/MSE/agents");
    await page.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "Settings" }).click();
  }
  await expect(page).toHaveURL(/\/MSE\/company\/settings/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("M7 test Smoke Co");
});

test("opens the command palette and finds a task", async ({ page }) => {
  await page.goto("/MSE/issues");
  await expect(page.getByRole("link", { name: "M7 test Write the landing page" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search tasks, projects, agents and commands" });
  await expect(search).toBeVisible();
  await search.fill("signup");
  const option = page.getByRole("listbox", { name: "Results" }).getByRole("option", { name: /M7 test Fix the signup form/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(search).toBeHidden();
  await expect(page).toHaveURL(/\/MSE\/issues\/MSE-2/);
});

test("New task creates a task", async ({ page, api }) => {
  // Time is under the test's control, to stand in for coming back to the tab later (below).
  await page.clock.install();
  await page.goto("/MSE/issues");
  await expect(page.getByRole("link", { name: "M7 test Write the landing page" })).toBeVisible();
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Task title").fill("M7 test Smoke-created task");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  // Create saves in the background: the task waits in the write queue, shown at the top of the list.
  await expect(page.getByText("M7 test Smoke-created task")).toBeVisible();
  // App bug found by this suite (see "a fresh load opens without a trip through sign-in" below):
  // the session gate remounts after a bounce through /auth, so the write queue never counts the
  // session as checked on this page load and the task stays "Waiting to send…" until the health or
  // session read refreshes (a refocus once they're 30 s stale). Simulate that; once the bug is
  // fixed the POST goes out at once and these two lines can go.
  await page.clock.fastForward("00:31");
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

  const created = await api.waitForWrite("POST", `/companies/${COMPANY_ID}/issues`);
  expect(created.body).toMatchObject({ title: "M7 test Smoke-created task", status: "todo" });
  await expect(page.getByRole("link", { name: "M7 test Smoke-created task" })).toBeVisible();
});

test("a fresh load opens without a trip through sign-in", async ({ page }) => {
  // App bug found by this suite: with no reads saved from a last visit, the session gate renders
  // once with health loaded but the session read not yet started (enabled in that same update, so
  // not `isLoading`), takes that for "signed out" and navigates to /auth?next=…; SignIn then finds
  // the session and navigates back, and the gate mounts a second time (lib/session.tsx).
  // Expected to fail until that's fixed; Playwright reports it when it starts passing.
  test.fail();
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  await page.goto("/MSE/issues");
  await expect(page.getByRole("link", { name: "M7 test Write the landing page" })).toBeVisible();
  expect(visited).not.toContain("/auth");
});
