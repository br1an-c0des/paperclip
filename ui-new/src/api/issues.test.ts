import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { issuesApi, markMonitoring } from "./issues";

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

describe("What in-progress tasks show on compact lists", () => {
  // Compact rows leave `displayStatus` out; full rows of the in-progress tasks carry it.
  const fullRead = (url: string) => !new URL(url, "http://x").searchParams.has("view");

  it("marks each in-progress task with what it shows: Monitoring, or Todo, Blocked or In review with no run (#19453)", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url: string) =>
      (fullRead(url)
        ? [
            { id: "m", displayStatus: "monitoring" },
            { id: "w", displayStatus: "todo" },
            { id: "b", displayStatus: "blocked" },
            { id: "p", displayStatus: "in_progress" },
          ]
        : [
            { id: "m", status: "in_progress" },
            { id: "w", status: "in_progress" },
            { id: "b", status: "in_progress" },
            { id: "p", status: "in_progress" },
            { id: "t", status: "todo" },
          ]) as never,
    );
    const tasks = await issuesApi.listAll("c1", { projectId: "p1" });
    expect(tasks.map((task) => task.displayStatus ?? null)).toEqual(["monitoring", "todo", "blocked", null, null]);
    expect(get).toHaveBeenCalledTimes(2);
    const second = new URL(String(get.mock.calls[1]![0]), "http://x");
    expect(Object.fromEntries(second.searchParams)).toMatchObject({ projectId: "p1", status: "in_progress" });
    expect(second.searchParams.has("view")).toBe(false);
    expect(second.searchParams.has("displayStatus")).toBe(false);
  });

  it("asks nothing more when no task is in progress, the rows carry the field, or the list is one display status", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([{ id: "t", status: "todo" }] as never);
    await issuesApi.list("c1", {});
    get.mockResolvedValue([{ id: "p", status: "in_progress", displayStatus: "in_progress" }] as never);
    await issuesApi.list("c1", {});
    get.mockResolvedValue([{ id: "m", status: "in_progress" }] as never);
    const monitored = await issuesApi.list("c1", { displayStatus: "monitoring" });
    expect(get).toHaveBeenCalledTimes(3);
    expect(monitored[0]!.displayStatus).toBe("monitoring");
  });

  it("marks rows read another way against the company's in-progress tasks", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([{ id: "m", displayStatus: "monitoring" }, { id: "p", displayStatus: "in_review" }] as never);
    const rows = await markMonitoring("c1", [
      { id: "m", status: "in_progress" as const },
      { id: "p", status: "in_progress" as const },
      { id: "q", status: "in_progress" as const },
    ]);
    expect(rows.map((row) => ("displayStatus" in row ? row.displayStatus : null))).toEqual(["monitoring", "in_review", null]);
    expect(get).toHaveBeenCalledTimes(1);
    const url = new URL(String(get.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe("/companies/c1/issues");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ status: "in_progress", includeRoutineExecutions: "true" });
  });
});
