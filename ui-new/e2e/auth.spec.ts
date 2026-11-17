import { expect, test } from "./fixtures/test";
import * as world from "./fixtures/world";

// M0/M1: a signed-out visitor signs in, sees their companies and opens one.

test.use({ mock: { signedOut: true } });

async function signIn(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(world.USER.email);
  await page.getByLabel("Password").fill("m7-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signs in, lists the companies and opens one", async ({ page, api }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\?next=%2F$/);
  await signIn(page);

  const sent = await api.waitForWrite("POST", "/auth/sign-in/email");
  expect(sent.body).toEqual({ email: world.USER.email, password: "m7-test-password" });

  // `/` opens the first company.
  await expect(page).toHaveURL(/\/MSE\/dashboard$/);
  await expect(page.getByRole("heading", { name: "M7 test Smoke Co", level: 1 })).toBeVisible();

  await page.goto("/companies");
  await expect(page.getByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /M7 test Smoke Co/ })).toBeVisible();
  await page.getByRole("link", { name: /M7 test Other Co/ }).click();

  await expect(page).toHaveURL(/\/MOT\/dashboard$/);
  await expect(page.getByRole("heading", { name: "M7 test Other Co", level: 1 })).toBeVisible();
});
