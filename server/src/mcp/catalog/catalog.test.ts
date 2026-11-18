import { describe, expect, it } from "vitest";
import { PAPERCLIP_TOOL_NAMES } from "./tool-names.js";
import { createPaperclipCatalog } from "./index.js";
import type { PaperclipTool } from "./types.js";
import { TEST_COMPANY_ID, recordingDispatch, testCaller } from "./test-support.js";

const catalog = createPaperclipCatalog({
  runTask: async () => ({ taskId: null, wakeCommentId: null }),
  recordDisposition: async () => {},
});

function find(name: string): PaperclipTool {
  const found = catalog.find(candidate => candidate.name === name);
  if (!found) throw new Error(`${name} is not in the catalog`);
  return found;
}

async function call(name: string, args: unknown, respond?: Parameters<typeof recordingDispatch>[0]) {
  const definition = find(name);
  const api = recordingDispatch(respond);
  const result = await definition.run(testCaller(), definition.input.parse(args), api);
  return { result, calls: api.calls };
}

describe("the Paperclip catalog", () => {
  it("every catalog tool name is in PAPERCLIP_TOOL_NAMES and unique", () => {
    const names = catalog.map(definition => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(PAPERCLIP_TOOL_NAMES).toContain(name);
    for (const definition of catalog) {
      expect(definition.description.length, definition.name).toBeLessThanOrEqual(240);
    }
  });

  it("update_task sends labelIds", async () => {
    const labelId = "55555555-5555-4555-8555-555555555555";
    const { calls } = await call("paperclip_update_task", { taskId: "TES-1", labelIds: [labelId], blockedByTaskIds: [] });
    expect(calls).toEqual([{ method: "PATCH", path: "/issues/TES-1", body: { labelIds: [labelId], blockedByIssueIds: [] } }]);
    expect(find("paperclip_update_task").action).toEqual(["tasks:update_own", "tasks:update_any"]);
    expect(() => find("paperclip_update_task").input.parse({ taskId: "TES-1" })).toThrow();
  });

  it("archive_task sets and clears hiddenAt", async () => {
    const archived = await call("paperclip_archive_task", { taskId: "TES-1" });
    expect(archived.calls).toHaveLength(1);
    expect(archived.calls[0]).toMatchObject({ method: "PATCH", path: "/issues/TES-1" });
    const hiddenAt = (archived.calls[0].body as { hiddenAt: string }).hiddenAt;
    expect(Number.isNaN(Date.parse(hiddenAt))).toBe(false);

    const restored = await call("paperclip_archive_task", { taskId: "TES-1", archived: false });
    expect(restored.calls).toEqual([{ method: "PATCH", path: "/issues/TES-1", body: { hiddenAt: null } }]);
  });

  it("delete_task calls DELETE /issues/:id", async () => {
    const { calls } = await call("paperclip_delete_task", { taskId: "TES-9" });
    expect(calls).toEqual([{ method: "DELETE", path: "/issues/TES-9" }]);
    expect(find("paperclip_delete_task").action).toBe("tasks:delete");
  });

  it("searches tasks in the caller's company with the given filters", async () => {
    const { calls, result } = await call("paperclip_search_tasks", { query: "login bug", status: ["todo", "in_progress"], limit: 5 },
      () => [{ id: "t1", identifier: "TES-1", title: "Fix login", status: "todo", secret: "x" }]);
    expect(calls[0].method).toBe("GET");
    const url = new URL("http://x" + calls[0].path);
    expect(url.pathname).toBe(`/companies/${TEST_COMPANY_ID}/issues`);
    expect(url.searchParams.get("q")).toBe("login bug");
    expect(url.searchParams.get("status")).toBe("todo,in_progress");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(result).toEqual({ tasks: [{ id: "t1", identifier: "TES-1", title: "Fix login", status: "todo" }] });
  });

  it("creates a task in the caller's company with labels and blockers", async () => {
    const { calls } = await call("paperclip_create_task", {
      title: "Write tests", parentId: "TES-1", assigneeAgentId: "66666666-6666-4666-8666-666666666666", blockedByTaskIds: [],
    });
    expect(calls).toEqual([{ method: "POST", path: `/companies/${TEST_COMPANY_ID}/issues`, body: {
      title: "Write tests", parentId: "TES-1", assigneeAgentId: "66666666-6666-4666-8666-666666666666", blockedByIssueIds: [],
    } }]);
  });

  it("writes a document with its base revision", async () => {
    const { calls } = await call("paperclip_write_document", { taskId: "TES-1", key: "plan", body: "# Plan", baseRevisionId: null });
    expect(calls).toEqual([{ method: "PUT", path: "/issues/TES-1/documents/plan", body: { format: "markdown", body: "# Plan", baseRevisionId: null } }]);
  });

  it("manages label definitions", async () => {
    const labelId = "77777777-7777-4777-8777-777777777777";
    const { calls } = await call("paperclip_manage_labels", { create: [{ name: "bug", color: "#ff0000" }], delete: [labelId] });
    expect(calls).toEqual([
      { method: "POST", path: `/companies/${TEST_COMPANY_ID}/labels`, body: { name: "bug", color: "#ff0000" } },
      { method: "DELETE", path: `/labels/${labelId}` },
    ]);
  });

  it("asks the board on the task and waits in review", async () => {
    const { calls } = await call("paperclip_ask_board", { taskId: "TES-1", question: "Which region?", choices: ["EU", "US"] },
      ({ method }) => method === "POST" ? { id: "int-1", status: "pending" } : {});
    expect(calls[0]).toMatchObject({ method: "POST", path: "/issues/TES-1/interactions" });
    const body = calls[0].body as { kind: string; payload: { questionSet: { questions: Array<{ answerMode: string; options: unknown[] }> } } };
    expect(body.kind).toBe("ask_user_questions");
    expect(body.payload.questionSet.questions[0].answerMode).toBe("single_select");
    expect(body.payload.questionSet.questions[0].options).toHaveLength(2);
    expect(calls[1]).toEqual({ method: "PATCH", path: "/issues/TES-1", body: { status: "in_review" } });
  });

  it("requests a board approval linked to tasks", async () => {
    const { calls } = await call("paperclip_request_approval", { title: "Spend $42", summary: "Hosting", taskIds: ["88888888-8888-4888-8888-888888888888"] });
    expect(calls).toEqual([{ method: "POST", path: `/companies/${TEST_COMPANY_ID}/approvals`, body: {
      type: "request_board_approval", payload: { title: "Spend $42", summary: "Hosting" }, issueIds: ["88888888-8888-4888-8888-888888888888"],
    } }]);
  });
});
