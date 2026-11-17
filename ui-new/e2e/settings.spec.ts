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
