import { describe, expect, it, vi } from "vitest";
import type { RunDisposition } from "@paperclipai/shared";
import { createPaperclipCatalog, type CatalogDeps } from "./index.js";
import type { PaperclipTool } from "./types.js";
import { TEST_AGENT_ID, TEST_RUN_ID, TEST_TASK_ID, recordingDispatch, testCaller } from "./test-support.js";

function setup(taskId: string | null = TEST_TASK_ID) {
  const recorded: Array<{ runId: string; disposition: RunDisposition }> = [];
  const deps: CatalogDeps = {
    runTask: vi.fn(async () => ({ taskId, wakeCommentId: "comment-1" })),
    recordDisposition: vi.fn(async (runId, disposition) => { recorded.push({ runId, disposition }); }),
  };
  const catalog = createPaperclipCatalog(deps);
  const find = (name: string): PaperclipTool => catalog.find(candidate => candidate.name === name)!;
  return { deps, recorded, catalog, find };
}

describe("run tools", () => {
  it("finish records a finished disposition and sets done", async () => {
    const { find, recorded } = setup();
    const finish = find("paperclip_finish");
    expect(finish.needsRun).toBe(true);
    const api = recordingDispatch(() => ({ id: TEST_TASK_ID, status: "done" }));
    await finish.run(testCaller(), finish.input.parse({ summary: "Shipped the fix" }), api);
    expect(api.calls).toEqual([{ method: "PATCH", path: `/issues/${TEST_TASK_ID}`, body: { status: "done", comment: "Shipped the fix" } }]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].runId).toBe(TEST_RUN_ID);
    expect(recorded[0].disposition).toMatchObject({ kind: "finished", via: "tool", tool: "paperclip_finish", taskStatus: "done", summary: "Shipped the fix" });

    const review = setup();
    await review.find("paperclip_finish").run(testCaller(), { summary: "Ready", status: "in_review" }, recordingDispatch());
    expect(review.recorded[0].disposition).toMatchObject({ kind: "finished", taskStatus: "in_review" });
  });

  it("block records owner and action", async () => {
    const { find, recorded } = setup();
    const block = find("paperclip_block");
    const api = recordingDispatch();
    await block.run(testCaller(), block.input.parse({ summary: "Waiting on keys", unblockAction: "Add the API key" }), api);
    expect(api.calls).toEqual([{ method: "PATCH", path: `/issues/${TEST_TASK_ID}`, body: {
      status: "blocked", comment: "Waiting on keys", unblockDescriptor: { owner: { agentId: TEST_AGENT_ID }, action: "Add the API key" },
    } }]);
    expect(recorded[0].disposition).toMatchObject({
      kind: "blocked", tool: "paperclip_block", taskStatus: "blocked", blockedOwner: `agent:${TEST_AGENT_ID}`, unblockAction: "Add the API key", summary: "Waiting on keys",
    });

    const board = setup();
    await board.find("paperclip_block").run(testCaller(), board.find("paperclip_block").input.parse({ summary: "s", unblockAction: "Decide", owner: "board" }), recordingDispatch());
    expect(board.recorded[0].disposition.blockedOwner).toBe("board");
  });

  it("progress without continue records nothing", async () => {
    const { find, recorded } = setup();
    const progress = find("paperclip_report_progress");
    const api = recordingDispatch();
    await progress.run(testCaller(), progress.input.parse({ summary: "Half done" }), api);
    expect(api.calls).toEqual([{ method: "POST", path: `/issues/${TEST_TASK_ID}/comments`, body: { body: "Half done" } }]);
    expect(recorded).toEqual([]);

    await progress.run(testCaller(), progress.input.parse({ summary: "More next run", continue: true }), recordingDispatch());
    expect(recorded[0].disposition).toMatchObject({ kind: "continuing", tool: "paperclip_report_progress", summary: "More next run" });
  });

  it("an agent_key caller can't call finish", async () => {
    const { find, recorded } = setup();
    const api = recordingDispatch();
    for (const name of ["paperclip_finish", "paperclip_block", "paperclip_report_progress", "paperclip_task_context"]) {
      const definition = find(name);
      expect(definition.needsRun, name).toBe(true);
      const args = definition.input.parse(name === "paperclip_block" ? { summary: "s", unblockAction: "a" } : name === "paperclip_task_context" ? {} : { summary: "s" });
      await expect(definition.run(testCaller({ kind: "agent_key" }), args, api)).rejects.toThrow(/only during a run/);
    }
    expect(api.calls).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses to finish a run that isn't bound to a task", async () => {
    const { find } = setup(null);
    await expect(find("paperclip_finish").run(testCaller(), { summary: "s", status: "done" }, recordingDispatch()))
      .rejects.toThrow(/isn't bound to a task/);
  });

  it("task_context reads the run's task, its wake comment, recent comments and documents", async () => {
    const { find } = setup();
    const api = recordingDispatch(({ path }) => path.includes("/comments") ? [{ id: "c1", body: "hi", secret: 1 }]
      : path.endsWith("/documents") ? [{ key: "plan", title: "Plan", body: "long" }] : { issue: { id: TEST_TASK_ID } });
    const result = await find("paperclip_task_context").run(testCaller(), {}, api) as Record<string, unknown>;
    expect(api.calls.map(call => call.path)).toEqual([
      `/issues/${TEST_TASK_ID}/heartbeat-context?wakeCommentId=comment-1`,
      `/issues/${TEST_TASK_ID}/comments?order=desc&limit=10`,
      `/issues/${TEST_TASK_ID}/documents`,
    ]);
    expect(result).toMatchObject({ taskId: TEST_TASK_ID, context: { issue: { id: TEST_TASK_ID } }, recentComments: [{ id: "c1", body: "hi" }], documents: [{ key: "plan", title: "Plan" }] });
  });

  it("me reports identity, access and the tools hidden from the caller", async () => {
    const { find } = setup();
    const api = recordingDispatch(() => ({ id: TEST_AGENT_ID, name: "Worker", role: "engineer", adapterConfig: { secret: true } }));
    const result = await find("paperclip_me").run(testCaller({ kind: "agent_key" }), {}, api) as {
      agent: Record<string, unknown>; access: { level: string | null; allowed: string[] }; hiddenTools: Array<{ name: string; reason: string }>; needsApproval: string[];
    };
    expect(result.agent).toEqual({ id: TEST_AGENT_ID, name: "Worker", role: "engineer" });
    expect(result.access.allowed).toContain("tasks:update_own");
    expect(result.access.allowed).not.toContain("tasks:delete");
    expect(result.hiddenTools).toContainEqual({ name: "paperclip_finish", reason: "Needs a run: only a run's own token can end its work." });
    expect(result.hiddenTools).toContainEqual({ name: "paperclip_call_api", reason: "Needs api:raw." });
    expect(result.needsApproval).toContain("paperclip_delete_task");
    expect(result.needsApproval).toContain("paperclip_manage_labels");
    expect(result.needsApproval).not.toContain("paperclip_finish");
  });
});
