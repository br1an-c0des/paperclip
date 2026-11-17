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

/** Every path the page goes to from now on, history navigations included. */
function recordPaths(page: import("@playwright/test").Page) {
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  return visited;
}

test("signing in goes back to the page asked for", async ({ page }) => {
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/auth\?next=%2Fcompanies$/);
  const visited = recordPaths(page);
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/companies$/);
  // One navigation, straight there: not on to `/` (and the first company) once `?next=` is gone.
  expect(visited).toEqual(["/companies"]);
});

test("after signing in, a write goes out at once", async ({ page, api }) => {
  await page.goto("/MSE/issues");
  await expect(page).toHaveURL(/\/auth\?next=%2FMSE%2Fissues$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/MSE\/issues$/);
  await expect(page.getByRole("link", { name: "M7 test Write the landing page" })).toBeVisible();

  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Task title").fill("M7 test Created after sign-in");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  // The session was checked with the server on this page load (on /auth, before the board mounted),
  // so the write queue sends the task without waiting for another session read.
  const created = await api.waitForWrite("POST", `/companies/${world.COMPANY_ID}/issues`, { timeout: 5_000 });
  expect(created.body).toMatchObject({ title: "M7 test Created after sign-in" });
});

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
