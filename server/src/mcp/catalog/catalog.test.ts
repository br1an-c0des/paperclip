import { describe, expect, it } from "vitest";
import { agentRouteRequirement } from "../../middleware/agent-route-policy-table.js";
import { listTools } from "../server.js";
import { PAPERCLIP_TOOL_NAMES } from "./tool-names.js";
import { createPaperclipCatalog } from "./index.js";
import type { PaperclipTool } from "./types.js";
import { TEST_COMPANY_ID, TEST_TASK_ID, recordingDispatch, testCaller } from "./test-support.js";

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

  it("a worker run sees 22 tools and 4 more marked as needing approval", () => {
    const tools = listTools(testCaller({ access: { level: "worker" } }), catalog);
    const needsApproval = tools.filter(definition => definition.annotations?.paperclipNeedsApproval).map(definition => definition.name);
    expect(tools.length - needsApproval.length).toBe(22);
    expect(needsApproval.sort()).toEqual([
      "paperclip_create_project", "paperclip_delete_task", "paperclip_manage_labels", "paperclip_update_project",
    ]);
    const names = tools.map(definition => definition.name);
    expect(names).not.toContain("paperclip_call_api");
    // File links belong to an outside connection's grant.
    expect(names).not.toContain("paperclip_file_upload");
    expect(names).not.toContain("paperclip_file_download");
    // Skills and deliverables are listed for their reads; their changes need approval.
    expect(tools.find(definition => definition.name === "paperclip_skills")!.description).toMatch(/Changes need approval\.$/);
    expect(tools.find(definition => definition.name === "paperclip_deliverables")!.description).not.toMatch(/approval/);
  });

  it("each tool's action passes the route policy of every write it makes", async () => {
    // A caller allowed a tool must not then be refused by the agent route policy on the routes it
    // re-enters: each tool action must be one the route accepts (or the route checks access itself).
    const boundCatalog = createPaperclipCatalog({
      runTask: async () => ({ taskId: TEST_TASK_ID, wakeCommentId: null }),
      recordDisposition: async () => {},
    });
    const labelId = "77777777-7777-4777-8777-777777777777";
    const projectId = "99999999-9999-4999-8999-999999999999";
    const sampleArgs: Record<string, unknown> = {
      paperclip_report_progress: { summary: "halfway" },
      paperclip_finish: { summary: "done" },
      paperclip_block: { summary: "stuck", unblockAction: "approve" },
      paperclip_read_task: { taskId: "TES-1" },
      paperclip_create_task: { title: "New" },
      paperclip_update_task: { taskId: "TES-1", title: "Renamed" },
      paperclip_archive_task: { taskId: "TES-1" },
      paperclip_delete_task: { taskId: "TES-1" },
      paperclip_add_comment: { taskId: "TES-1", body: "hi" },
      paperclip_read_document: { taskId: "TES-1" },
      paperclip_write_document: { taskId: "TES-1", key: "plan", body: "# Plan", baseRevisionId: null },
      paperclip_manage_labels: { create: [{ name: "bug", color: "#ff0000" }], update: [{ labelId, name: "defect" }], delete: [labelId] },
      paperclip_create_project: { name: "Website" },
      paperclip_update_project: { projectId, changes: { name: "Site" } },
      paperclip_ask_board: { taskId: "TES-1", question: "Which?" },
      paperclip_request_approval: { title: "Spend", summary: "Hosting" },
      paperclip_deliverables: { taskId: "TES-1", register: { type: "artifact", provider: "paperclip", title: "Report" } },
      paperclip_configure_agent: { agentId: projectId, changes: { title: "Editor" } },
      paperclip_skills: { create: { name: "Review" } },
    };
    const caller = testCaller({ access: { level: "admin", overrides: { "tasks:delete": true } } });
    let writes = 0;
    for (const definition of boundCatalog) {
      if (definition.name === "paperclip_call_api" || definition.name === "paperclip_search_api" || definition.needsGrant) continue;
      const api = recordingDispatch(({ method }) => method === "GET" ? [] : { id: "x" });
      await definition.run(caller, definition.input.parse(sampleArgs[definition.name] ?? {}), api);
      const actions = typeof definition.action === "string" ? [definition.action] : definition.action;
      for (const call of api.calls.filter(recorded => recorded.method !== "GET")) {
        writes += 1;
        const requirement = agentRouteRequirement(call.method, call.path);
        expect(requirement.tagged, `${definition.name}: ${call.method} ${call.path} is in the route policy`).toBe(true);
        if (requirement.routeChecks) continue;
        for (const action of actions) {
          expect(requirement.actions, `${definition.name} (${action}) on ${call.method} ${call.path}`).toContain(action);
        }
      }
    }
    expect(writes).toBeGreaterThan(15);
  });

  it("update_task sends labelIds", async () => {
    const labelId = "55555555-5555-4555-8555-555555555555";
    const { calls } = await call("paperclip_update_task", { taskId: "TES-1", labelIds: [labelId], blockedByTaskIds: [] });
    expect(calls).toEqual([{ method: "PATCH", path: "/issues/TES-1", body: { labelIds: [labelId], blockedByIssueIds: [] } }]);
    expect(find("paperclip_update_task").action).toEqual(["tasks:update_own", "tasks:update_any"]);
    expect(() => find("paperclip_update_task").input.parse({ taskId: "TES-1" })).toThrow();
  });

  it("update_task with onlyIfProvisional sets only a provisional title, through the title route", async () => {
    const { calls, result } = await call("paperclip_update_task", { taskId: "TES-1", title: "Fix sign-in", onlyIfProvisional: true },
      () => ({ id: "t1", title: "Fix sign-in", titleNeedsGeneration: false, changed: true }));
    expect(calls).toEqual([{ method: "PUT", path: "/issues/TES-1/title", body: { title: "Fix sign-in", onlyIfProvisional: true } }]);
    expect(result).toEqual({ task: { id: "t1", title: "Fix sign-in", titleNeedsGeneration: false }, changed: true });
    // A title someone already chose stays, and the result says so.
    const kept = await call("paperclip_update_task", { taskId: "TES-1", title: "Fix sign-in", onlyIfProvisional: true },
      () => ({ id: "t1", title: "Chosen", titleNeedsGeneration: false, changed: false }));
    expect(kept.result).toEqual({ task: { id: "t1", title: "Chosen", titleNeedsGeneration: false }, changed: false });
    // Without it (or with false), a title is an ordinary change.
    expect((await call("paperclip_update_task", { taskId: "TES-1", title: "Renamed", onlyIfProvisional: false })).calls)
      .toEqual([{ method: "PATCH", path: "/issues/TES-1", body: { title: "Renamed" } }]);
    const input = find("paperclip_update_task").input;
    expect(() => input.parse({ taskId: "TES-1", onlyIfProvisional: true })).toThrow();
    expect(() => input.parse({ taskId: "TES-1", onlyIfProvisional: false })).toThrow();
    expect(() => input.parse({ taskId: "TES-1", title: "x", status: "done", onlyIfProvisional: true })).toThrow(/title alone/);
    // The route decides own-or-any itself (and needs the assigned agent's active run).
    expect(agentRouteRequirement("PUT", "/issues/TES-1/title")).toMatchObject({ tagged: true, routeChecks: true });
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

  it("creates a task with its plan, and a project with repository URLs", async () => {
    expect((await call("paperclip_create_task", { title: "Ship", initialPlan: "# Plan" })).calls)
      .toEqual([{ method: "POST", path: `/companies/${TEST_COMPANY_ID}/issues`, body: { title: "Ship", initialPlan: "# Plan" } }]);
    expect((await call("paperclip_create_project", { name: "Site", repositoryUrls: ["https://github.com/acme/site"] })).calls)
      .toEqual([{ method: "POST", path: `/companies/${TEST_COMPANY_ID}/projects`, body: { name: "Site", status: "backlog", repositoryUrls: ["https://github.com/acme/site"] } }]);
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

  it("tools carried over from the public MCP fold reads into existing tools", async () => {
    const agentId = "66666666-6666-4666-8666-666666666666";
    const projectId = "99999999-9999-4999-8999-999999999999";
    expect((await call("paperclip_list_agents", { agentId }, () => ({ id: agentId, adapterType: "claude_local", adapterConfig: { model: "m", env: { SECRET: "x" } } }))).calls)
      .toEqual([{ method: "GET", path: `/agents/${agentId}/configuration` }]);
    expect((await call("paperclip_list_projects", { projectId })).calls).toEqual([{ method: "GET", path: `/projects/${projectId}` }]);
    expect((await call("paperclip_read_document", { taskId: "TES-1", key: "plan", revisions: true })).calls)
      .toEqual([{ method: "GET", path: "/issues/TES-1/documents/plan/revisions" }]);
    expect((await call("paperclip_update_project", { projectId, repositoryIds: ["12"] })).calls)
      .toEqual([{ method: "PUT", path: `/projects/${projectId}/repositories`, body: { repositoryIds: ["12"] } }]);
    expect((await call("paperclip_update_task", { taskId: "TES-1", status: "blocked", unblock: { owner: "board", action: "Send the file" } })).calls)
      .toEqual([{ method: "PATCH", path: "/issues/TES-1", body: { status: "blocked", unblockDescriptor: { owner: "board", action: "Send the file" } } }]);
    const listed = await call("paperclip_list_requests", {}, () => [{ id: "a1", type: "permission_request", status: "pending", payload: { summary: "Delete task TES-1" } }]);
    expect(listed.result).toEqual({ requests: [{ id: "a1", type: "permission_request", status: "pending", title: "Delete task TES-1" }] });
  });

  it("configure_agent and skills read without writing", async () => {
    const agentId = "66666666-6666-4666-8666-666666666666";
    expect((await call("paperclip_configure_agent", { agentId, read: "instructions" })).calls)
      .toEqual([{ method: "GET", path: `/agents/${agentId}/instructions-bundle/file?path=AGENTS.md` }]);
    expect(() => find("paperclip_configure_agent").input.parse({ agentId })).toThrow();
    const skills = find("paperclip_skills");
    expect(skills.writes?.({})).toBe(false);
    expect(skills.writes?.({ create: { name: "x" } })).toBe(true);
    expect((await call("paperclip_skills", {})).calls).toEqual([{ method: "GET", path: `/companies/${TEST_COMPANY_ID}/skills` }]);
  });
});
