import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { readDiscoveryStream } from "@/api/skills";
import {
  allConnections,
  auditDrift,
  auditLine,
  auditVerdict,
  canForceInstall,
  canRename,
  canReset,
  connectionChoices,
  needsConnection,
  parseCategories,
  renameRequest,
  scanFraction,
  scanProgressLine,
  settingsDraft,
  settingsPatch,
  settingsProblem,
} from "./skill-settings-model";

const skill = {
  name: "Review code",
  slug: "review-code",
  currentVersionId: "v3",
  description: "Reviews diffs.",
  tagline: null,
  categories: ["engineering"],
  authorName: null,
  homepageUrl: null,
  iconUrl: null,
  color: null,
  sharingScope: "company" as const,
};

describe("skill settings", () => {
  it("drafts from the skill and patches only what changed", () => {
    const draft = settingsDraft(skill);
    expect(draft).toMatchObject({ name: "Review code", description: "Reviews diffs.", categories: "engineering", tagline: "", sharingScope: "company" });
    expect(settingsPatch(skill, draft)).toBeNull();
    expect(settingsPatch(skill, { ...draft, tagline: " Second opinions ", categories: "engineering, Review, review", sharingScope: "private", description: " " })).toEqual({
      tagline: "Second opinions",
      categories: ["engineering", "Review"],
      sharingScope: "private",
      description: null,
    });
    // A public link reads as the organization (it can't be set from here).
    expect(settingsDraft({ ...skill, sharingScope: "public_link" }).sharingScope).toBe("company");
  });

  it("renames only when the name changed, with the slug following it", () => {
    expect(renameRequest(skill, { name: "Review code" })).toBeNull();
    expect(renameRequest(skill, { name: "  Code review!  " })).toEqual({ name: "Code review!", slug: "code-review", expectedVersionId: "v3" });
  });

  it("checks the draft", () => {
    const draft = settingsDraft(skill);
    expect(settingsProblem(draft)).toBeNull();
    expect(settingsProblem({ ...draft, name: " " })).toMatch(/Name/);
    expect(settingsProblem({ ...draft, name: "!!!" })).toMatch(/letter/);
    expect(settingsProblem({ ...draft, tagline: "x".repeat(121) })).toMatch(/120/);
    expect(settingsProblem({ ...draft, homepageUrl: "example.com" })).toMatch(/homepage/);
    expect(parseCategories(" a , ,b,A ")).toEqual(["a", "b"]);
  });

  it("knows which skills rename, reset and force an update", () => {
    const base = { key: "company/c1/review", forkedFromSkillId: null, sourceType: "managed" as const, sourceBadge: "paperclip" as const, editable: true };
    expect(canRename(base)).toBe(true);
    expect(canRename({ ...base, editable: false })).toBe(false);
    expect(canRename({ ...base, key: "acme/skills/review", sourceType: "github" as never, sourceBadge: "github" as never })).toBe(false);
    expect(canReset({ sourceType: "catalog" })).toBe(true);
    expect(canReset({ sourceType: "github" })).toBe(false);
    expect(canForceInstall({ hasUpdate: true, updateHoldReason: "local_modifications" } as never)).toBe(true);
    expect(canForceInstall({ hasUpdate: true, updateHoldReason: "audit_hard_stop" } as never)).toBe(false);
    expect(canForceInstall(undefined)).toBe(false);
  });
});

describe("audit", () => {
  it("sums up findings and drift", () => {
    expect(auditVerdict("fail")).toEqual({ label: "Failed", tone: "red" });
    expect(auditLine({ verdict: "pass", findings: [] })).toBe("Nothing found.");
    expect(
      auditLine({
        verdict: "fail",
        findings: [
          { code: "a", severity: "error", message: "x", path: null },
          { code: "b", severity: "warning", message: "y", path: null },
          { code: "c", severity: "warning", message: "z", path: null },
        ],
      }),
    ).toBe("1 error, 2 warnings.");
    expect(auditDrift({ installedHash: "a", originHash: "b" })).toBe(true);
    expect(auditDrift({ installedHash: "a", originHash: null })).toBe(false);
  });
});

describe("source connections", () => {
  const options = {
    connections: [
      { id: "c1", name: "Acme org" },
      { id: "c2", name: "Brian" },
    ],
    repositories: [{ id: "r", fullName: "acme/skills", url: "https://github.com/acme/skills", connections: ["Acme org", "Brian"], connectionIds: ["c1", "c2"] }],
    connectionCount: 2,
    failedConnectionCount: 0,
  };

  it("lists the connections that can read a repository", () => {
    expect(connectionChoices(options, "https://github.com/Acme/skills.git")).toEqual([
      { id: "c1", name: "Acme org" },
      { id: "c2", name: "Brian" },
    ]);
    expect(connectionChoices(options, "https://github.com/acme/other")).toEqual([]);
    expect(connectionChoices(undefined, "x")).toEqual([]);
    expect(allConnections(options).map((entry) => entry.id)).toEqual(["c1", "c2"]);
  });

  it("offers a connection choice for a failing source", () => {
    expect(needsConnection({ lastError: "403", repairAction: "connection", connectionId: "c1" })).toBe(true);
    expect(needsConnection({ lastError: "403", repairAction: null, connectionId: null })).toBe(true);
    expect(needsConnection({ lastError: "bad ref", repairAction: "branch", connectionId: null })).toBe(false);
    expect(needsConnection({ lastError: null, repairAction: "connection", connectionId: null })).toBe(false);
  });
});

describe("streamed scans", () => {
  const progress = (extra: object) => ({ type: "progress", phase: "checking", totalSkills: 4, checkedSkills: 1, currentPath: "lint", checkedFiles: 3, totalFiles: null, ...extra });

  it("words the progress", () => {
    expect(scanProgressLine(null)).toMatch(/Reading/);
    expect(scanProgressLine(progress({ phase: "downloading", download: { stage: "receiving", percent: 41.6 } }) as never)).toBe("Downloading the repository: 42%");
    expect(scanProgressLine(progress({}) as never)).toBe("Checking skill 2 of 4: lint");
    expect(scanFraction(progress({}) as never)).toBe(0.25);
    expect(scanFraction(progress({ phase: "listing" }) as never)).toBeNull();
  });

  const reader = (chunks: string[]) => {
    const encoder = new TextEncoder();
    const queue = [...chunks];
    return { read: async () => (queue.length ? { value: encoder.encode(queue.shift()!), done: false } : { value: undefined, done: true }) };
  };

  it("reads progress and found skills, then the result, across chunk breaks", async () => {
    const onUpdate = vi.fn();
    const discovery = { repositoryUrl: "u", candidates: [] };
    const lines = [JSON.stringify(progress({})), JSON.stringify({ type: "candidate", candidate: { path: "a", name: "A", description: null, fileCount: 1, error: null } }), JSON.stringify({ type: "complete", discovery })];
    const text = lines.join("\n") + "\n";
    const result = await readDiscoveryStream(reader([text.slice(0, 17), text.slice(17, 90), text.slice(90)]), onUpdate);
    expect(result).toEqual(discovery);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1]![0]).toMatchObject({ type: "candidate" });
  });

  it("rejects on an error line or a cut-off stream", async () => {
    await expect(readDiscoveryStream(reader([`${JSON.stringify({ type: "error", error: "Not found", status: 404 })}\n`]), () => {})).rejects.toMatchObject({ status: 404 });
    await expect(readDiscoveryStream(reader([`${JSON.stringify(progress({}))}\n`]), () => {})).rejects.toThrow(/cut off/);
    const error = await readDiscoveryStream(reader([`${JSON.stringify({ type: "error", error: "x", status: 403 })}\n`]), () => {}).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
  });
});
