import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { issuesApi } from "./issues";

afterEach(() => vi.restoreAllMocks());

describe("issuesApi.listAll", () => {
  it("asks the server for one agent's tasks with participantAgentId", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    await issuesApi.listAll("c1", { projectId: "p1", includeBlockedBy: true, participantAgentId: "ada" });
    const url = new URL(String(get.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe("/companies/c1/issues");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ projectId: "p1", includeBlockedBy: "true", participantAgentId: "ada" });
  });

  it("leaves it out otherwise", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    await issuesApi.listAll("c1", {});
    expect(String(get.mock.calls[0]![0])).not.toContain("participantAgentId");
  });
});

describe("issuesApi.list", () => {
  const params = (get: ReturnType<typeof vi.spyOn>) => Object.fromEntries(new URL(String(get.mock.calls[0]![0]), "http://x").searchParams);

  it("asks for the most recently updated first unless the view sorts by created", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    await issuesApi.list("c1", {});
    expect(params(get)).toMatchObject({ sortField: "updated", sortDir: "desc" });
    get.mockClear();
    await issuesApi.list("c1", { sortField: "created", sortDir: "asc" });
    expect(params(get)).toMatchObject({ sortField: "created", sortDir: "asc" });
  });

  it("filters by display status and by the task the tasks were made from", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    await issuesApi.list("c1", { displayStatus: "monitoring", createdFromIssueId: "t1" });
    expect(params(get)).toMatchObject({ displayStatus: "monitoring", createdFromIssueId: "t1" });
  });
});

describe("issuesApi.runsByIds", () => {
  it("reads the runs in batches of 100 ids, each once", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([]);
    const ids = Array.from({ length: 150 }, (_, index) => `r${index}`);
    await issuesApi.runsByIds("t1", [...ids, "r0"]);
    expect(get).toHaveBeenCalledTimes(2);
    const first = new URL(String(get.mock.calls[0]![0]), "http://x");
    expect(first.pathname).toBe("/issues/t1/runs");
    expect(first.searchParams.get("runIds")!.split(",")).toHaveLength(100);
    expect(new URL(String(get.mock.calls[1]![0]), "http://x").searchParams.get("runIds")!.split(",")).toHaveLength(50);
  });
});
