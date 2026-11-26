import { expect, test } from "./fixtures/test";
import { QUESTION_ID } from "./fixtures/world";

// M2: the task list loads and groups; a task opens in the panel; status changes inline; a comment
// posts; an agent's question gets an answer; a run opens in the run modal. Every write is stubbed.

test("the list loads, grouped by status, and a task opens in the panel", async ({ page }) => {
  await page.goto("/MSE/issues");
  await expect(page.getByRole("heading", { name: "All tasks", level: 1 })).toBeVisible();
  for (const group of ["In progress", "In review", "Todo", "Backlog", "Done"]) {
    await expect(page.getByRole("heading", { name: new RegExp(`^${group}`) })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "M7 test Fix the signup form" })).toBeVisible();

  // The panel docks beside the list on a desktop and covers the page on a phone.
  await page.getByRole("link", { name: "M7 test Write the landing page" }).click();
  await expect(page).toHaveURL(/\/MSE\/issues\?task=MSE-1$/);
  const panel = page.getByRole("complementary", { name: /MSE-1|M7 test Write the landing page/ });
  await expect(panel.getByText("Draft the landing page copy and layout.")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Status: Todo/ })).toBeVisible();
});

test("changes a task's status inline", async ({ page, api }) => {
  await page.goto("/MSE/issues");
  await page.getByRole("button", { name: "Status: Todo. Change status" }).click();
  await page.getByRole("menuitem", { name: /In progress/ }).click();
  const patch = await api.waitForWrite("PATCH", "/issues/issue-m7-1");
  expect(patch.body).toMatchObject({ status: "in_progress" });
  await expect(page.getByRole("button", { name: "Status: In progress. Change status" })).toHaveCount(2);
});

test("posts a comment", async ({ page, api }) => {
  await page.goto("/MSE/issues/MSE-1?section=activity");
  await expect(page.getByText("M7 test I started on the draft.")).toBeVisible();
  const composer = page.getByRole("combobox", { name: "Comment" });
  await composer.fill("M7 test Looks good, carry on.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const posted = await api.waitForWrite("POST", "/issues/issue-m7-1/comments");
  expect(posted.body).toMatchObject({ body: "M7 test Looks good, carry on." });
  await expect(page.getByText("M7 test Looks good, carry on.")).toBeVisible();
});

test("answers an agent's question", async ({ page, api }) => {
  await page.goto("/MSE/issues/MSE-2?section=activity");
  await expect(page.getByRole("heading", { name: "M7 test Which signup fields should stay?" })).toBeVisible();
  const send = page.getByRole("button", { name: "Send answer" });
  await expect(send).toBeDisabled();
  await page.getByRole("radio", { name: "Email and name" }).check();
  await send.click();
  const answer = await api.waitForWrite("POST", `/issues/issue-m7-2/interactions/${QUESTION_ID}/respond`);
  expect(answer.body).toEqual({ answers: [{ questionId: "q1", optionIds: ["o2"], otherText: null }] });
  await expect(page.getByRole("button", { name: "Send answer" })).toBeHidden();
});

test("opens a run in the run modal", async ({ page }) => {
  await page.goto("/MSE/issues/MSE-1?section=runs");
  await page.getByRole("button", { name: "View run" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("M7 test Builder").first()).toBeVisible();
  await expect(modal.getByText(/Succeeded/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("the Hidden tasks only filter lists the tasks someone hid", async ({ page, db }) => {
  db.issues.find((i) => i.id === "issue-m7-3")!.hiddenAt = "2026-11-20T09:00:00.000Z" as never;
  await page.goto("/MSE/issues");
  await expect(page.getByRole("link", { name: "M7 test Fix the signup form" })).toBeVisible();
  await expect(page.getByRole("link", { name: "M7 test Review the pricing copy" })).toHaveCount(0);

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Hidden tasks only" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "M7 test Review the pricing copy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "M7 test Fix the signup form" })).toHaveCount(0);
});

test("deletes a task after asking", async ({ page, api }) => {
  await page.goto("/MSE/issues/MSE-5");
  await page.getByRole("button", { name: "More task actions" }).click();
  await page.getByRole("menuitem", { name: "Delete task…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete MSE-5?" });
  await expect(dialog.getByText("This can't be undone.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete task" }).click();
  await api.waitForWrite("DELETE", "/issues/issue-m7-5");
  await expect(page).toHaveURL(/\/MSE\/issues$/);
  await expect(page.getByRole("link", { name: "M7 test Plan the launch" })).toHaveCount(0);
});
