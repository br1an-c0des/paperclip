import { afterEach, describe, expect, it } from "vitest";
import { defaultRepeat } from "@/recurring/schedule";
import {
  buildCreatePayload,
  buildRoutinePayload,
  buildTriggerPayloads,
  clearDraft,
  draftProblem,
  draftRepeats,
  effortOptions,
  emptyDraft,
  loadDraft,
  missingDefaults,
  recurringDraftProblem,
  saveDraft,
  type PayloadContext,
} from "./new-task";

const context: PayloadContext = { adapterType: null, project: null, isolatedWorkspacesEnabled: false, idempotencyKey: "key-1" };

describe("buildCreatePayload", () => {
  it("sends the basics with a duplicate allowance and the idempotency key", () => {
    const payload = buildCreatePayload(emptyDraft({ title: "  Fix login  ", projectId: "p1" }), context);
    expect(payload).toMatchObject({ title: "Fix login", projectId: "p1", status: "todo", allowDuplicate: true, idempotencyKey: "key-1" });
    expect(payload).not.toHaveProperty("executionPolicy");
    expect(payload).not.toHaveProperty("reviewPolicy");
  });

  it("sends extra fields only while they're shown", () => {
    const draft = emptyDraft({ title: "T", parentId: "parent", billingCode: "OPS", private: true, extras: ["billing"] });
    const payload = buildCreatePayload(draft, context);
    expect(payload.billingCode).toBe("OPS");
    expect(payload).not.toHaveProperty("parentId");
    expect(payload).not.toHaveProperty("visibility");
  });

  it("puts model and effort overrides under the adapter's own key", () => {
    const draft = emptyDraft({ title: "T", assignee: { kind: "agent", id: "a1" }, model: "gpt-6-sol", effort: "ultra" });
    const codex = buildCreatePayload(draft, { ...context, adapterType: "codex_local" });
    expect(codex.assigneeAgentId).toBe("a1");
    expect(codex.assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "ultra" } });
    const other = buildCreatePayload(draft, { ...context, adapterType: "http" });
    expect(other).not.toHaveProperty("assigneeAdapterOverrides");
  });

  it("turns the reviewer and approver into execution stages", () => {
    const draft = emptyDraft({
      title: "T",
      reviewer: { kind: "user", id: "u1" },
      approver: { kind: "agent", id: "a2" },
      extras: ["approver"],
    });
    const policy = buildCreatePayload(draft, context).executionPolicy as { stages: { type: string; participants: unknown[] }[] };
    expect(policy.stages.map((stage) => stage.type)).toEqual(["review", "approval"]);
    expect(policy.stages[0]!.participants[0]).toMatchObject({ type: "user", userId: "u1", agentId: null });
    expect(policy.stages[1]!.participants[0]).toMatchObject({ type: "agent", agentId: "a2", userId: null });
  });

  it("sends the workspace only when the project and instance allow it", () => {
    const project = {
      id: "p1",
      executionWorkspacePolicy: { enabled: true, defaultMode: "isolated_workspace" },
      workspaces: [{ id: "w1", isPrimary: true }],
    } as unknown as PayloadContext["project"];
    const draft = emptyDraft({ title: "T", workspace: "isolated_workspace" });
    expect(buildCreatePayload(draft, { ...context, project })).not.toHaveProperty("executionWorkspacePreference");
    expect(buildCreatePayload(draft, { ...context, project, isolatedWorkspacesEnabled: true })).toMatchObject({
      executionWorkspacePreference: "isolated_workspace",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
      projectWorkspaceId: "w1",
    });
  });

  it("reuses another task's worktree with its id, its mode and its project workspace", () => {
    const project = {
      id: "p1",
      executionWorkspacePolicy: { enabled: true, defaultMode: "shared_workspace" },
      workspaces: [{ id: "w1", isPrimary: true }],
    } as unknown as PayloadContext["project"];
    const reused = { id: "ew9", name: "TES-4 worktree", mode: "operator_branch", projectWorkspaceId: "w2" };
    const draft = emptyDraft({ title: "T", workspace: "reuse_existing", reuseWorkspace: reused });
    expect(buildCreatePayload(draft, { ...context, project, isolatedWorkspacesEnabled: true })).toMatchObject({
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceId: "ew9",
      executionWorkspaceSettings: { mode: "operator_branch" },
      projectWorkspaceId: "w2",
    });
    const adapterManaged = { ...reused, mode: "adapter_managed", projectWorkspaceId: null };
    expect(
      buildCreatePayload(emptyDraft({ title: "T", workspace: "reuse_existing", reuseWorkspace: adapterManaged }), {
        ...context,
        project,
        isolatedWorkspacesEnabled: true,
      }),
    ).toMatchObject({ executionWorkspaceSettings: { mode: "agent_default" }, projectWorkspaceId: "w1" });
    expect(draftProblem(emptyDraft({ title: "T", workspace: "reuse_existing" }))).toBe("Pick the workspace to reuse.");
  });
});

describe("effortOptions", () => {
  it("follows the adapter, and for Codex the model", () => {
    expect(effortOptions("claude_local", null).map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(effortOptions("codex_local", "gpt-6-sol").map((option) => option.value)).toContain("ultra");
    expect(effortOptions("codex_local", "unknown").map((option) => option.value)).toContain("minimal");
  });
});

describe("drafts", () => {
  afterEach(() => clearDraft("c1"));

  it("needs a title or a description, and a watchdog once the role is added", () => {
    expect(draftProblem(emptyDraft())).not.toBeNull();
    expect(draftProblem(emptyDraft({ description: "Context" }))).toBeNull();
    expect(draftProblem(emptyDraft({ title: "T", extras: ["watchdog"] }))).toMatch(/watchdog/);
  });

  it("keeps a draft with content and forgets an empty one", () => {
    saveDraft("c1", emptyDraft({ title: "Half written" }));
    expect(loadDraft("c1")?.title).toBe("Half written");
    saveDraft("c1", emptyDraft());
    expect(loadDraft("c1")).toBeNull();
  });
});

describe("Repeat (boards N4–N7)", () => {
  const repeat = { ...defaultRepeat("America/Chicago"), frequency: "weekly" as const, days: [1, 4], time: "09:00" };
  const draft = emptyDraft({
    title: "  Funding rate snapshot for {{date}}  ",
    description: "Pull the last 24 hours.",
    projectId: "p1",
    priority: "high",
    assignee: { kind: "agent", id: "a1" },
    labelIds: ["l1"],
    reviewer: { kind: "user", id: "u1" },
    parentId: "parent",
    goalId: "goal",
    blockedByIssueIds: ["b1"],
    extras: ["parent", "goal", "blocked"],
    repeat,
  });

  it("is a recurring task only with a schedule or a webhook", () => {
    expect(draftRepeats(emptyDraft())).toBe(false);
    expect(draftRepeats(draft)).toBe(true);
    expect(draftRepeats({ repeat: { ...repeat, schedule: false } })).toBe(false);
    expect(draftRepeats({ repeat: { ...repeat, schedule: false, webhook: true } })).toBe(true);
  });

  it("sends only what a routine copies to each occurrence", () => {
    expect(buildRoutinePayload(draft)).toEqual({
      title: "Funding rate snapshot for {{date}}",
      description: "Pull the last 24 hours.",
      projectId: "p1",
      assigneeAgentId: "a1",
      priority: "high",
      goalId: "goal",
      parentIssueId: "parent",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
    });
  });

  it("drops a person as assignee, empty text and fields that aren't shown", () => {
    const payload = buildRoutinePayload({ ...draft, description: "  ", assignee: { kind: "user", id: "u1" }, extras: [], repeat: { ...repeat, policy: "skip_if_active" } });
    expect(payload).toMatchObject({ description: null, assigneeAgentId: null, goalId: null, parentIssueId: null, concurrencyPolicy: "skip_if_active" });
  });

  it("adds the schedule, then the webhook still being set up", () => {
    expect(buildTriggerPayloads(repeat)).toEqual([{ kind: "schedule", cronExpression: "0 9 * * 1,4", timezone: "America/Chicago" }]);
    expect(buildTriggerPayloads({ ...repeat, webhook: true, sender: "github" })).toEqual([
      { kind: "schedule", cronExpression: "0 9 * * 1,4", timezone: "America/Chicago" },
      { kind: "webhook", signingMode: "github_hmac", setupPending: true },
    ]);
    expect(buildTriggerPayloads({ ...repeat, schedule: false, webhook: true })).toEqual([{ kind: "webhook", signingMode: "app_webhook", setupPending: true }]);
  });

  it("needs a title and a schedule that works", () => {
    expect(recurringDraftProblem({ ...draft, title: " " })).toMatch(/title/);
    expect(recurringDraftProblem({ ...draft, repeat: { ...repeat, days: [] } })).toMatch(/day/);
    expect(recurringDraftProblem({ ...draft, repeat: { ...repeat, frequency: "custom", cron: "every day" } })).toMatch(/5 fields/);
    expect(recurringDraftProblem(draft)).toBeNull();
  });

  it("gives each placeholder a default, which a schedule needs", () => {
    const withInputs = { ...draft, description: "Pull {{exchanges}} for {{lookback\\_hours}} hours on {{date}}." };
    expect(missingDefaults(withInputs)).toEqual(["exchanges", "lookback_hours"]);
    expect(recurringDraftProblem(withInputs)).toBe("A schedule needs a default for exchanges, lookback_hours.");
    const filled = { ...withInputs, repeat: { ...repeat, defaults: { exchanges: "Binance", lookback_hours: " 24 " } } };
    expect(recurringDraftProblem(filled)).toBeNull();
    expect(buildRoutinePayload(filled).variables).toEqual([
      { name: "exchanges", type: "text", defaultValue: "Binance", required: true },
      { name: "lookback_hours", type: "text", defaultValue: "24", required: true },
    ]);
    // A webhook fills them from its JSON, so it doesn't need defaults.
    expect(recurringDraftProblem({ ...withInputs, repeat: { ...repeat, schedule: false, webhook: true } })).toBeNull();
  });

  it("keeps Repeat in a saved draft", () => {
    saveDraft("c2", draft);
    expect(loadDraft("c2")?.repeat).toEqual(repeat);
    clearDraft("c2");
    expect(emptyDraft().repeat).toBeNull();
  });
});
