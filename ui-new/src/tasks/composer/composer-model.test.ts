import { afterEach, describe, expect, it } from "vitest";
import {
  attachmentIds,
  clearComposerDraft,
  loadComposerDraft,
  messageBody,
  planSend,
  reopensByDefault,
  saveComposerDraft,
  type ComposerAttachment,
  type ComposerState,
  type TaskForSend,
} from "./composer-model";

const task: TaskForSend = {
  status: "in_progress",
  workMode: "standard",
  assigneeAgentId: "a1",
  assigneeUserId: null,
  assigneeAdapterOverrides: { adapterConfig: { model: "old", sandbox: true } },
};

const state = (extra: Partial<ComposerState> = {}): ComposerState => ({
  body: "Hello",
  attachments: [],
  workMode: "standard",
  assignee: null,
  runSettings: null,
  reopen: false,
  ...extra,
});

const context = { task, mode: "send" as const, clientRequestId: "req-1", adapterTypeOf: (id: string) => (id === "a2" ? "codex_local" : "claude_local") };

const file = (extra: Partial<ComposerAttachment>): ComposerAttachment => ({ key: "k", name: "f.txt", size: 1, status: "attached", attachmentId: "at1", contentPath: "/api/a/1", ...extra });

describe("planSend", () => {
  it("posts a plain comment", () => {
    expect(planSend(state(), context)).toEqual({
      ok: true,
      workMode: null,
      request: { via: "post", data: { body: "Hello", clientRequestId: "req-1" } },
      steer: false,
    });
  });

  it("saves a changed work mode first, and carries reopen, interrupt and steer", () => {
    const plan = planSend(state({ workMode: "planning", reopen: true }), { ...context, mode: "interrupt" });
    expect(plan).toMatchObject({ ok: true, workMode: "planning", request: { via: "post", data: { reopen: true, interrupt: true } } });
    expect(planSend(state(), { ...context, mode: "steer" })).toMatchObject({ steer: true });
  });

  it("reassigns through PATCH with the comment, clearing the old overrides", () => {
    const plan = planSend(state({ assignee: { agentId: null, userId: "u1" }, reopen: true }), context);
    expect(plan).toEqual({
      ok: true,
      workMode: null,
      request: {
        via: "patch",
        data: { comment: "Hello", commentClientRequestId: "req-1", assigneeAgentId: null, assigneeUserId: "u1", assigneeAdapterOverrides: null, status: "todo" },
      },
      steer: false,
    });
  });

  it("sends run settings as the task's overrides, under the right agent's key", () => {
    const same = planSend(state({ runSettings: { model: "claude-opus-5-5", effort: "max" } }), context);
    expect(same).toMatchObject({ request: { via: "patch", data: { assigneeAdapterOverrides: { adapterConfig: { sandbox: true, model: "claude-opus-5-5", effort: "max" } } } } });
    expect(same.ok && same.request.data).not.toHaveProperty("assigneeAgentId");
    const moved = planSend(state({ assignee: { agentId: "a2", userId: null }, runSettings: { model: null, effort: "high" } }), context);
    expect(moved).toMatchObject({ request: { data: { assigneeAgentId: "a2", assigneeAdapterOverrides: { adapterConfig: { modelReasoningEffort: "high" } } } } });
  });

  it("treats picking the current assignee as no change", () => {
    expect(planSend(state({ assignee: { agentId: "a1", userId: null } }), context)).toMatchObject({ request: { via: "post" } });
  });

  it("refuses an empty message, or one with files still uploading or failed", () => {
    expect(planSend(state({ body: "  " }), context)).toEqual({ ok: false, problem: "Write a message first." });
    expect(planSend(state({ attachments: [file({ status: "uploading" })] }), context)).toMatchObject({ ok: false });
    expect(planSend(state({ attachments: [file({ status: "error" })] }), context)).toMatchObject({ ok: false });
  });

  it("sends files as link lines and attachment ids", () => {
    const plan = planSend(state({ body: "", attachments: [file({})] }), context);
    expect(plan).toMatchObject({ request: { via: "post", data: { body: "[f.txt](/api/a/1)", attachmentIds: ["at1"] } } });
  });
});

describe("attachments", () => {
  it("keeps inline images only while the text still has them", () => {
    const image = file({ attachmentId: "img", contentPath: "/api/i/2", inline: true, name: "a.png" });
    expect(attachmentIds("![a.png](/api/i/2)", [image])).toEqual(["img"]);
    expect(attachmentIds("removed", [image])).toEqual([]);
    expect(messageBody("Look", [image])).toBe("Look");
  });
});

describe("reopen and drafts", () => {
  afterEach(() => clearComposerDraft("t1"));

  it("reopens closed tasks for agents only", () => {
    expect(reopensByDefault("done", { agentId: "a1", userId: null })).toBe(true);
    expect(reopensByDefault("done", { agentId: null, userId: "u1" })).toBe(false);
    expect(reopensByDefault("in_progress", { agentId: "a1", userId: null })).toBe(false);
  });

  it("keeps a draft per task, with only uploaded files", () => {
    saveComposerDraft("t1", { body: "half", attachments: [file({}), file({ key: "u", status: "uploading" })] });
    expect(loadComposerDraft("t1")).toEqual({ body: "half", attachments: [file({})] });
    saveComposerDraft("t1", { body: " ", attachments: [] });
    expect(loadComposerDraft("t1")).toEqual({ body: "", attachments: [] });
  });
});
