import { expect, test } from "./fixtures/test";
import { AGENT_ID, COMPANY_ID } from "./fixtures/world";

// Step 5: a run's Input tab shows its prompt in labelled sections from the `adapter.prompt` record,
// and a run recorded before sections shows adapter.invoke's prompt as one. Every write is stubbed.

const wake = "## Comments\n\nM7 test Brian: please check the hero copy.";
const brief = "# MSE-1 M7 test Write the landing page\n\nDraft the landing page copy and layout.";
const record = {
  version: 1,
  session: "fresh",
  systemPrompt: [
    { id: "agent_instructions", label: "Agent instructions", placement: "system", delivery: "fresh_only", reason: "the agent has an instructions file", source: "AGENTS.md", text: "You are M7 test Builder.", chars: 24 },
  ],
  firstMessage: [
    { id: "wake", label: "Wake", placement: "first_message", delivery: "every_run", reason: "woken by a comment", source: "wake payload", text: wake, chars: wake.length,
      parts: [{ id: "wake.comments", label: "Comments", source: "task comments", text: wake, chars: wake.length }] },
    { id: "task_brief", label: "Task brief", placement: "first_message", delivery: "every_run", reason: "the run is for MSE-1", source: "task description", text: brief, chars: brief.length },
  ],
  firstMessageChars: wake.length + 2 + brief.length,
  matchedPlan: true,
};

// A phone's run modal shows only the transcript; Input opens on desktop (M11).
test.skip(({ isMobile }) => isMobile, "Input is a desktop tab");

function event(seq: number, runId: string, eventType: string, payload: Record<string, unknown>) {
  return { id: seq, companyId: COMPANY_ID, runId, agentId: AGENT_ID, seq, eventType, stream: "system", level: "info", color: null, message: null, payload, createdAt: "2026-11-15T15:30:01.000Z" };
}

async function openInput(page: import("@playwright/test").Page) {
  await page.goto("/MSE/issues/MSE-1?section=runs");
  await page.getByRole("button", { name: "View run" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: /^Input/ }).click();
  return modal;
}

test("a run's Input shows its prompt in folded sections", async ({ page, api }) => {
  api.get("/heartbeat-runs/:runId/events", ({ params, query }) =>
    Number(query.get("afterSeq") ?? 0) > 0
      ? []
      : [
          event(1, params.runId, "adapter.invoke", { adapterType: "claude_local", command: "claude", prompt: `${wake}\n\n${brief}` }),
          event(2, params.runId, "adapter.prompt", record),
        ],
  );
  const modal = await openInput(page);
  await expect(modal.getByRole("heading", { name: "System prompt" })).toBeVisible();
  await expect(modal.getByRole("heading", { name: "First message" })).toBeVisible();
  const wakeSection = modal.locator("details.ps-sec", { hasText: "woken by a comment" });
  await expect(wakeSection).not.toHaveAttribute("open", "");
  await wakeSection.locator("summary").click();
  await expect(wakeSection.getByText("Comments", { exact: true })).toBeVisible();
  await expect(wakeSection.getByText("M7 test Brian: please check the hero copy.")).toBeVisible();
});

test("a resume that failed and retried fresh shows the fresh attempt", async ({ page, api }) => {
  const resumed = {
    ...record,
    session: "resumed",
    systemPrompt: [],
    firstMessage: [{ ...record.firstMessage[0]!, label: "M7 test resumed wake", reason: "the failed resume" }],
  };
  api.get("/heartbeat-runs/:runId/events", ({ params, query }) =>
    Number(query.get("afterSeq") ?? 0) > 0
      ? []
      : [
          event(1, params.runId, "adapter.invoke", { adapterType: "claude_local", command: "claude", commandArgs: ["--resume", "m7-resumed"], prompt: wake }),
          event(2, params.runId, "adapter.prompt", resumed),
          event(3, params.runId, "adapter.invoke", { adapterType: "claude_local", command: "claude", commandArgs: ["--print", "m7-fresh"], prompt: `${wake}\n\n${brief}` }),
          event(4, params.runId, "adapter.prompt", record),
        ],
  );
  const modal = await openInput(page);
  await expect(modal.locator("details.ps-sec", { hasText: "AGENTS.md" })).toBeVisible();
  await expect(modal.getByText("Kept from the session's start")).toHaveCount(0);
  await expect(modal.getByText("the failed resume")).toHaveCount(0);
  await modal.locator("details.ri-xs", { hasText: "Command" }).locator("summary").click();
  await expect(modal.getByText(/claude --print m7-fresh/)).toBeVisible();
});

test("a run recorded before sections shows its prompt as one section", async ({ page, api }) => {
  api.get("/heartbeat-runs/:runId/events", ({ params, query }) =>
    Number(query.get("afterSeq") ?? 0) > 0 ? [] : [event(1, params.runId, "adapter.invoke", { adapterType: "claude_local", command: "claude", prompt: "You are M7 test Builder." })],
  );
  const modal = await openInput(page);
  await expect(modal.locator("details.ps-sec")).toHaveCount(1);
  await expect(modal.getByText("Recorded before sections")).toBeVisible();
  await expect(modal.getByText("Not recorded for this run")).toBeVisible();
});
