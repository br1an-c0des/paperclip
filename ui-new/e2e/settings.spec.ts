import { expect, test } from "./fixtures/test";
import { COMPANY_ID } from "./fixtures/world";

// M6: change a setting, see its unsaved-change dot, save (stubbed, body asserted).

test("an edited budget shows its unsaved dot until it's saved", async ({ page, api }) => {
  await page.goto("/MSE/company/settings/budgets");
  const amount = page.getByRole("textbox", { name: "Monthly budget" });
  await expect(amount).toHaveValue("500");
  const dot = page.getByRole("button", { name: "Unsaved change: Monthly budget" });
  await expect(dot).toHaveCount(0);

  await amount.fill("750");
  await expect(dot).toBeVisible();
  await page.getByRole("button", { name: "Save budget" }).click();

  const saved = await api.waitForWrite("POST", `/companies/${COMPANY_ID}/budgets/policies`);
  expect(saved.body).toEqual({
    scopeType: "company",
    scopeId: COMPANY_ID,
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 75_000,
    warnPercent: 80,
    hardStopEnabled: true,
  });
  await expect(dot).toHaveCount(0);
  await expect(amount).toHaveValue("750");
  await expect(page.getByRole("button", { name: "Save budget" })).toHaveCount(0);
});

// Step 4b part 3: cleaning up finished worktrees is a choice in Features, off by default; restore
// points can't be chosen when they can't work here, and a choice saves through the experimental PATCH.
test("worktree cleanup is off by default and saves the chosen mode", async ({ page, api }) => {
  api.get("/instance/settings/worktree-cleanup", () => ({
    saved: null,
    mode: "off",
    source: "environment",
    dryRun: false,
    restorePoints: { available: false, reason: "File storage is S3 and PAPERCLIP_SECRETS_MASTER_KEY isn't set." },
    days: { strictDelay: 1, restorePointDelay: 3, idle: 7, retention: 90 },
  }));
  api.patch("/instance/settings/experimental", ({ body }) => ({ ...(body as object) }));
  await page.goto("/MSE/company/settings/instance/general");
  const select = page.getByLabel("Clean up finished worktrees");
  await expect(select).toHaveValue("off");
  await expect(page.getByText("Isolated workspaces", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Restore points are unavailable/)).toBeVisible();
  await expect(select.locator('option[value="restore_points"]')).toBeDisabled();
  await select.selectOption("strict");
  const saved = await api.waitForWrite("PATCH", "/instance/settings/experimental");
  expect(saved.body).toEqual({ worktreeCleanup: "strict" });
});
