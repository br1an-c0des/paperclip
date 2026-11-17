import { expect, test } from "./fixtures/test";

// M4: a project's dashboard and its Docs tab render.

test("the project dashboard and Docs tab render", async ({ page }) => {
  await page.goto("/MSE/projects/m7-test-website");
  await expect(page.getByRole("heading", { name: /M7 test Website/, level: 1 })).toBeVisible();
  // The brief: a card on a desktop, a line under the title on a phone.
  await expect(page.getByText("The website project.").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Agents at work")).toBeVisible();
  await expect(page.getByText("MSE-2 · M7 test Fix the signup form").first()).toBeVisible();

  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page).toHaveURL(/\/MSE\/projects\/m7-test-website\/docs$/);
  await expect(page.getByText("Project docs and files")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search docs and files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Documents 1" })).toBeVisible();
  await expect(page.getByText("M7 test Landing page plan").filter({ visible: true }).first()).toBeVisible();
});
