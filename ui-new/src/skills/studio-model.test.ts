import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { skillsApi } from "@/api/skills";
import { isVersionConflict } from "./studio-model";

describe("Studio stale writes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells a stale write from other failures", () => {
    expect(isVersionConflict(new ApiError("Skill version changed", 409, { error: "Skill version changed" }))).toBe(true);
    expect(isVersionConflict(new ApiError("Forbidden", 403, null))).toBe(false);
    expect(isVersionConflict(new Error("offline"))).toBe(false);
  });

  it("sends the version the edit started from with saves and deletes", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await skillsApi.saveFile("c1", "s1", "SKILL.md", "# Hi", { executable: false, expectedVersionId: "v3" });
    await skillsApi.deleteFile("c1", "s1", "notes.md", { expectedVersionId: "v3" });
    const bodies = fetch.mock.calls.map((call) => JSON.parse(((call as unknown[])[1] as RequestInit).body as string));
    expect(bodies[0]).toEqual({ path: "SKILL.md", content: "# Hi", executable: false, expectedVersionId: "v3" });
    expect(bodies[1]).toEqual({ path: "notes.md", target: "file", expectedVersionId: "v3" });
  });
});
