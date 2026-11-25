import type { ClaudeRunPreview, ClaudeRunPreviewManifest, RunPromptPreview, RunPromptSection } from "@paperclipai/shared";
import { expect, test } from "./fixtures/test";
import { AGENT_ID } from "./fixtures/world";

// The New task dialog's prompt preview (fork/task-prompt-preview.md): with an agent on Claude's
// CLI engine assigned, the button beside the assignee opens, over the dialog, the prompt the task
// would give it once created, from POST /agents/:id/run-preview/draft (mocked). The preview is a
// read: nothing is created and nothing starts a run.

const manifest = { version: 1, engine: "cli" } as unknown as ClaudeRunPreviewManifest;

const section = (id: RunPromptSection["id"], label: string, text: string, extra: Partial<RunPromptSection> = {}): RunPromptSection => ({
  id, label, placement: "first_message", delivery: "every_run", reason: "M7 test reason", source: "M7 test source",
  text, chars: text.length, ...extra,
});

function prompt(title: string): RunPromptPreview {
  const issue = `- Issue: "MSE-99"\n- Title: "${title}"`;
  const firstMessage = [
    section("heartbeat_template", "Who you are", "You are M7 test Builder, Builder."),
    section("task_brief", "Task brief", issue, {
      parts: [{
        id: "task_brief.issue", label: "Issue", source: "task: identifier and title", text: issue, chars: issue.length,
        pending: "The task's id and identifier are given when it's created; the identifier shown is the next one, which another task can take first.",
      }],
    }),
  ];
  return {
    kind: "assignment",
    issueId: null,
    systemPrompt: [section("agent_instructions", "Agent instructions", "M7 test: you are the Builder.", { placement: "system", delivery: "fresh_only" })],
    firstMessage,
    firstMessageChars: firstMessage.map((entry) => entry.text).join("\n\n").length,
  };
}

test("the New task dialog previews the assignee's prompt, over the dialog, from the draft as it stands", async ({ page, api }) => {
  const asked: Array<Record<string, unknown>> = [];
  api.post("/agents/:agentId/run-preview/draft", ({ params, body }): ClaudeRunPreview => {
    expect(params.agentId).toBe(AGENT_ID);
    const draft = body as Record<string, unknown>;
    asked.push(draft);
    return { supported: true, project: null, manifest, blockers: [], prompt: prompt(String(draft.title)) };
  });

  await page.goto("/MSE/issues");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  const title = dialog.getByLabel("Task title");
  await title.fill("M7 test Count the ledger");

  // No assignee yet: the button is there, disabled, with the reason beside it.
  const previewButton = dialog.getByRole("button", { name: "Preview the prompt" });
  await expect(previewButton).toBeDisabled();
  await expect(dialog.getByText("No assignee yet")).toBeVisible();

  await dialog.getByRole("button", { name: "Assign the task" }).click();
  await page.getByRole("listbox", { name: "Assignee" }).getByRole("option", { name: /M7 test Builder/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Assignee" })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(previewButton).toBeEnabled();
  await expect(dialog.getByText("No assignee yet")).toHaveCount(0);

  // Opened: the prompt in sections, with what the launch fills in marked.
  await previewButton.click();
  const preview = page.getByRole("dialog", { name: "Prompt preview" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("heading", { name: "System prompt" })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "First message" })).toBeVisible();
  await preview.locator('details[data-section="task_brief"] > summary').click();
  await expect(preview.locator('[data-part="task_brief.issue"]').getByText("filled in at launch")).toBeVisible();
  await expect(preview.getByText('- Title: "M7 test Count the ledger"')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ title: "M7 test Count the ledger", status: "todo", workMode: "standard" });

  // Nothing scrolls sideways (a full-screen sheet on a phone).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Escape closes the preview only: the New task dialog and its draft stay, focus is back on the button.
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue("M7 test Count the ledger");
  await expect(previewButton).toBeFocused();

  // Reopened after an edit: drafted again from the new text.
  await title.fill("M7 test Count the ledger twice");
  expect(asked).toHaveLength(1);
  await previewButton.click();
  await expect(preview.getByRole("heading", { name: "First message" })).toBeVisible();
  await preview.locator('details[data-section="task_brief"] > summary').click();
  await expect(preview.getByText('- Title: "M7 test Count the ledger twice"')).toBeVisible();
  expect(asked.at(-1)).toMatchObject({ title: "M7 test Count the ledger twice" });

  // The close button, too, closes only the preview.
  await preview.getByRole("button", { name: "Close" }).click();
  await expect(preview).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(previewButton).toBeFocused();

  // Only the preview's reads were sent: no task was created.
  expect(api.writes.map((write) => `${write.method} ${write.path}`)).toEqual([
    `POST /agents/${AGENT_ID}/run-preview/draft`,
    `POST /agents/${AGENT_ID}/run-preview/draft`,
  ]);
});
