import { expect, test } from "./fixtures/test";
import { CHAT_ID } from "./fixtures/world";

// M5: an agent's page opens on its chat; a message goes out (stubbed).

test("the agent page shows its chat and sends a message", async ({ page, api }) => {
  await page.goto("/MSE/agents/m7-test-builder");
  await expect(page.getByRole("heading", { name: "M7 test Builder", level: 1 })).toBeVisible();
  await expect(page.getByText("M7 test Hi, I'm ready when you are.")).toBeVisible();

  const composer = page.getByRole("combobox", { name: "Message M7 test Builder" });
  await composer.fill("M7 test Please start on MSE-1.");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const sent = await api.waitForWrite("POST", `/issues/${CHAT_ID}/comments`);
  expect(sent.body).toMatchObject({ body: "M7 test Please start on MSE-1." });
  expect((sent.body as { clientRequestId?: unknown }).clientRequestId).toEqual(expect.any(String));
  await expect(page.getByText("M7 test Please start on MSE-1.")).toBeVisible();
  await expect(composer).toHaveValue("");
});
