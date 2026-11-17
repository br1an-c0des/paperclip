import { expect, test } from "./fixtures/test";
import { COMPANY_ID, QUESTION_ID } from "./fixtures/world";

// M3: Needs you shows the request cards, and one gets triaged (archived for you). Writes stubbed.

test("Needs you shows the request cards and archives one", async ({ page, api }) => {
  await page.goto("/MSE/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Inbox views" }).getByRole("link", { name: /Needs you/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Questions 2" })).toBeVisible();

  const signup = page.getByText("M7 test Which signup fields should stay?").first();
  const pricing = page.getByText("M7 test Which pricing tier goes first?").first();
  await expect(signup).toBeVisible();
  await expect(pricing).toBeVisible();

  // Open the first row's card: the question, its options, and its actions.
  await signup.click();
  const card = page.getByRole("article", { name: "Question from M7 test Builder" });
  await expect(card.getByRole("heading", { name: "M7 test Which signup fields should stay?" })).toBeVisible();
  await expect(card.getByRole("radio", { name: "Email only" })).toBeVisible();

  await card.getByRole("button", { name: "Request actions" }).click();
  await page.getByRole("menuitem", { name: /Archive/ }).click();

  const dismissal = await api.waitForWrite("POST", `/companies/${COMPANY_ID}/inbox-dismissals`);
  expect(dismissal.body).toEqual({ itemKey: `attention:interaction:${QUESTION_ID}`, fingerprint: "fp-1" });
  await expect(page.getByText("Archived for you")).toBeVisible();
  await expect(page.getByRole("button", { name: /M7 test Which signup fields should stay\?/ })).toHaveCount(0);
  await expect(pricing).toBeVisible();
  await expect(page.getByRole("button", { name: "Questions 1" })).toBeVisible();
});
