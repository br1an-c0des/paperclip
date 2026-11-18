import { describe, expect, it } from "vitest";
import { API_TOOLS, searchOperations } from "./api.js";
import { routeAction, type RoutePolicyEntry } from "./route-policy.js";
import type { PaperclipTool } from "./types.js";
import { recordingDispatch, testCaller } from "./test-support.js";

const find = (name: string): PaperclipTool => API_TOOLS.find(candidate => candidate.name === name)!;
const admin = () => testCaller({ access: { level: "admin" } });

describe("search_api", () => {
  it("search hides operations the caller can't call", async () => {
    // Without api:raw nothing found is callable, so nothing is listed.
    const search = find("paperclip_search_api");
    const manager = await search.run(testCaller({ access: { level: "manager" } }), search.input.parse({ query: "issue" }), recordingDispatch()) as { operations: unknown[] };
    expect(manager.operations).toEqual([]);

    // Board-only and MCP transport operations are never listed.
    const everything = searchOperations(admin(), "", 2000);
    expect(everything.length).toBeGreaterThan(100);
    expect(everything.some(op => op.path.startsWith("/mcp/"))).toBe(false);
    expect(everything.some(op => op.operationId === "PATCH /issues/{id}")).toBe(true);

    // A route that needs an action the caller lacks is hidden, even with api:raw.
    const table: RoutePolicyEntry[] = [{ method: "DELETE", path: "/issues/:id", action: "tasks:delete" }];
    const hidden = searchOperations(admin(), "delete issue", 20, table);
    expect(hidden.some(op => op.operationId === "DELETE /issues/{id}")).toBe(false);
    const granted = searchOperations(testCaller({ access: { level: "admin", overrides: { "tasks:delete": true } } }), "delete issue", 20, table);
    expect(granted.some(op => op.operationId === "DELETE /issues/{id}")).toBe(true);

    // Reads need tasks:read.
    const noReads = searchOperations(testCaller({ access: { level: "admin", overrides: { "tasks:read": false } } }), "", 2000);
    expect(noReads.every(op => op.method !== "GET")).toBe(true);
  });

  it("matches every word and returns an input schema", () => {
    const [operation] = searchOperations(admin(), "update issue", 20).filter(op => op.operationId === "PATCH /issues/{id}");
    expect(operation).toMatchObject({ method: "PATCH", path: "/issues/{id}", pathParams: ["id"] });
    expect(operation.body).toBeTruthy();
    expect(searchOperations(admin(), "update issue zzzz-no-such-word", 20)).toEqual([]);
  });
});

describe("routeAction", () => {
  it("reads need tasks:read, untagged writes need api:raw, route_checks need tasks:read", () => {
    const table: RoutePolicyEntry[] = [
      { method: "PATCH", path: "/issues/:id", action: "route_checks" },
      { method: "POST", path: "/companies/:companyId/labels", action: "labels:manage" },
    ];
    expect(routeAction("GET", "/issues/{id}", table)).toBe("tasks:read");
    expect(routeAction("PATCH", "/issues/{id}", table)).toBe("tasks:read");
    expect(routeAction("POST", "/companies/{companyId}/labels", table)).toBe("labels:manage");
    expect(routeAction("POST", "/companies/{companyId}/secrets", table)).toBe("api:raw");
  });
});

describe("call_api", () => {
  it("call_api refuses without api:raw", async () => {
    const callApi = find("paperclip_call_api");
    expect(callApi.action).toBe("api:raw");
    const api = recordingDispatch();
    const args = callApi.input.parse({ operationId: "PATCH /issues/{id}", pathParams: { id: "TES-1" }, body: { status: "done" } });
    await expect(callApi.run(testCaller({ access: { level: "manager" } }), args, api))
      .rejects.toMatchObject({ code: "access_denied", missingAction: "api:raw", requestable: false });
    expect(api.calls).toEqual([]);
  });

  it("call_api reaches a route through the dispatch", async () => {
    const callApi = find("paperclip_call_api");
    const api = recordingDispatch(() => ({ id: "t1", status: "done" }));
    const result = await callApi.run(admin(), callApi.input.parse({
      operationId: "PATCH /issues/{id}", pathParams: { id: "TES 1" }, body: { status: "done" },
    }), api);
    expect(api.calls).toEqual([{ method: "PATCH", path: "/issues/TES%201", body: { status: "done" } }]);
    expect(result).toEqual({ result: { id: "t1", status: "done" } });

    const list = recordingDispatch(() => []);
    await callApi.run(admin(), callApi.input.parse({
      operationId: "GET /companies/{companyId}/issues", pathParams: { companyId: "c1" }, query: { status: ["todo", "blocked"], limit: 5 },
    }), list);
    expect(list.calls).toEqual([{ method: "GET", path: "/companies/c1/issues?status=todo%2Cblocked&limit=5" }]);
  });

  it("refuses unknown operations and missing path parameters", async () => {
    const callApi = find("paperclip_call_api");
    await expect(callApi.run(admin(), callApi.input.parse({ operationId: "GET /nope" }), recordingDispatch())).rejects.toThrow(/Unknown operation/);
    await expect(callApi.run(admin(), callApi.input.parse({ operationId: "PATCH /issues/{id}" }), recordingDispatch())).rejects.toThrow(/id/);
  });
});
