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

// Step 4b part 3: cleaning up finished worktrees is one level in Features, Off until chosen; restore
// points can't be chosen when they can't work, the wait and compaction show once it isn't Off, and
// each change saves through the experimental PATCH.
test("worktree cleanup starts off, then saves a level and its wait", async ({ page, api }) => {
  let mode = "off";
  let levelSaved = false;
  api.get("/instance/settings/worktree-cleanup", () => ({
    saved: levelSaved,
    mode,
    source: levelSaved ? "setting" : "default",
    restorePoints: { available: false, reason: "File storage is S3 and PAPERCLIP_SECRETS_MASTER_KEY isn't set." },
    values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 7 },
    retentionDays: 90,
  }));
  api.patch("/instance/settings/experimental", ({ body }) => {
    const patch = body as { worktreeCleanup?: string };
    if (patch.worktreeCleanup) {
      mode = patch.worktreeCleanup;
      levelSaved = true;
    }
    return { ...patch };
  });
  await page.goto("/MSE/company/settings/instance/general");
  const select = page.getByLabel("Clean up finished worktrees");
  await expect(select).toHaveValue("off");
  await expect(page.getByText("Isolated workspaces", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Restore points are unavailable/)).toBeVisible();
  await expect(select.locator('option[value="restore_points"]')).toBeDisabled();
  await expect(page.getByLabel("Wait after a task closes", { exact: true })).toHaveCount(0);
  await select.selectOption("merged");
  const saved = await api.waitForWrite("PATCH", "/instance/settings/experimental");
  expect(saved.body).toEqual({ worktreeCleanup: "merged" });
  const wait = page.getByLabel("Wait after a task closes", { exact: true });
  await expect(wait).toHaveValue("1");
  await expect(page.getByRole("switch", { name: "Remove dependencies and build output from finished worktrees" })).toBeVisible();
  await expect(page.getByLabel("Save a restore point after", { exact: true })).toHaveCount(0);
  await wait.fill("3");
  await wait.press("Enter");
  await expect.poll(() => api.writes.filter((write) => write.method === "PATCH").map((write) => write.body))
    .toContainEqual({ worktreeCleanupWaitDays: 3 });
  // A saved level other than the first shows after a reload too (the select's options come later).
  await page.reload();
  await expect(page.getByLabel("Clean up finished worktrees")).toHaveValue("merged");
});
