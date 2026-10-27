import { describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { issuesApi } from "./issues";

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
