import type { CompanySkillFileDetail, CompanySkillVersion } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import { restoreReplacesFiles, restoreSkillVersion } from "./restore";

const created = { id: "v-new" } as CompanySkillVersion;

function fakeApi(savedVersionIds: (string | null)[] = []) {
  const ids = [...savedVersionIds];
  return {
    version: vi.fn(async () => ({
      id: "v1",
      revisionNumber: 1,
      fileInventory: [
        { path: "SKILL.md", kind: "skill", content: "# Notes", encoding: "utf8" },
        { path: "run.sh", kind: "script", content: "echo hi", executable: true },
      ],
    }) as unknown as CompanySkillVersion),
    saveFile: vi.fn(async () => ({ versionId: ids.shift() ?? null }) as CompanySkillFileDetail),
    createVersion: vi.fn(async () => created),
  };
}

describe("restoring a skill version", () => {
  it("restores a managed skill in one call, expecting the version on screen", async () => {
    const api = fakeApi();
    const result = await restoreSkillVersion(api, "c1", { id: "s1", sourceType: "managed", currentVersionId: "v3" }, { id: "v1", revisionNumber: 1 });
    expect(result).toBe(created);
    expect(api.createVersion).toHaveBeenCalledTimes(1);
    expect(api.createVersion).toHaveBeenCalledWith("c1", "s1", "Restore of v1", { sourceVersionId: "v1", expectedVersionId: "v3" });
    expect(api.version).not.toHaveBeenCalled();
    expect(api.saveFile).not.toHaveBeenCalled();
  });

  it("writes a local skill's files back one by one, each save expecting the last one's version", async () => {
    const api = fakeApi(["v4", null]);
    await restoreSkillVersion(api, "c1", { id: "s1", sourceType: "local_path", currentVersionId: "v3" }, { id: "v1", revisionNumber: 1 });
    expect(api.version).toHaveBeenCalledWith("c1", "s1", "v1");
    expect(api.saveFile).toHaveBeenNthCalledWith(1, "c1", "s1", "SKILL.md", "# Notes", { encoding: "utf8", executable: false, expectedVersionId: "v3" });
    expect(api.saveFile).toHaveBeenNthCalledWith(2, "c1", "s1", "run.sh", "echo hi", { encoding: undefined, executable: true, expectedVersionId: "v4" });
    // The second save made no version, so the last known one is still expected.
    expect(api.createVersion).toHaveBeenCalledWith("c1", "s1", "Restore of v1", { expectedVersionId: "v4" });
  });

  it("says which skills have their files replaced outright", () => {
    expect(restoreReplacesFiles({ sourceType: "managed" })).toBe(true);
    expect(restoreReplacesFiles({ sourceType: "local_path" })).toBe(false);
  });
});
