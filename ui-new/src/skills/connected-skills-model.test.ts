import type { CompanyMcpSkill } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { canApprove, connectedSkillNote, previewCurrent, reviewable, sizeLine, sortConnectedSkills, waitingLine } from "./connected-skills-model";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

const skill = (over: Partial<CompanyMcpSkill> = {}): CompanyMcpSkill => ({
  id: "skill-1",
  connectionId: "connection-1",
  appName: "Hugging Face",
  name: "dataset-search",
  description: "Find datasets.",
  skillUri: "skill://hf/dataset-search/SKILL.md",
  status: "pending_review",
  statusReason: "new",
  manifestDigest: DIGEST,
  fileCount: 3,
  totalBytes: 2048,
  requestedTools: [],
  allowedToolsApproved: false,
  nameCollision: false,
  reviewedAt: null,
  lastSeenAt: "2026-11-13T10:00:00.000Z",
  ...over,
});

describe("connected app skills", () => {
  it("explains each state's reason, and nothing for a new one", () => {
    expect(connectedSkillNote(skill())).toBeNull();
    expect(connectedSkillNote(skill({ statusReason: null }))).toBeNull();
    expect(connectedSkillNote(skill({ statusReason: "changed" }))).toBe("Hugging Face changed this skill. Agents won't use it until you approve the new version.");
    expect(connectedSkillNote(skill({ statusReason: "removed" }))).toBe("Hugging Face no longer offers this skill.");
    expect(connectedSkillNote(skill({ statusReason: "dynamic" }))).toMatch(/can't check its content/);
  });

  it("can review waiting and declined skills only", () => {
    expect(reviewable(skill())).toBe(true);
    expect(reviewable(skill({ status: "declined" }))).toBe(true);
    expect(reviewable(skill({ status: "approved" }))).toBe(false);
    expect(reviewable(skill({ status: "unavailable" }))).toBe(false);
  });

  it("sizes a skill, and says nothing for one without a manifest", () => {
    expect(sizeLine(skill())).toBe("3 files · 2 KB");
    expect(sizeLine(skill({ fileCount: 1, totalBytes: 10 }))).toBe("1 file · 10 B");
    expect(sizeLine(skill({ fileCount: null, totalBytes: null }))).toBeNull();
  });

  it("counts what waits, and lists it first", () => {
    const list = [skill({ id: "a", name: "zeta", status: "approved" }), skill({ id: "b", name: "beta", status: "unavailable" }), skill({ id: "c", name: "alpha" }), skill({ id: "d", name: "gamma" })];
    expect(waitingLine(list)).toBe("2 waiting for review");
    expect(waitingLine([skill({ status: "approved" })])).toBeNull();
    expect(sortConnectedSkills(list).map((entry) => entry.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("approves only against the version on screen", () => {
    expect(previewCurrent(skill(), null)).toBe(true);
    expect(previewCurrent(skill(), { skillId: "other", loading: true })).toBe(true);
    expect(previewCurrent(skill(), { skillId: "skill-1", loading: true })).toBe(false);
    expect(previewCurrent(skill(), { skillId: "skill-1", loading: false, manifestDigest: OTHER, markdown: "# Old" })).toBe(false);
    expect(previewCurrent(skill(), { skillId: "skill-1", loading: false, manifestDigest: DIGEST, markdown: "# Current" })).toBe(true);
    expect(canApprove(skill(), null, false)).toBe(true);
    expect(canApprove(skill(), null, true)).toBe(false);
    expect(canApprove(skill({ manifestDigest: null }), null, false)).toBe(false);
    expect(canApprove(skill({ status: "approved" }), null, false)).toBe(false);
    expect(canApprove(skill(), { skillId: "skill-1", loading: false, manifestDigest: OTHER, markdown: "# Old" }, false)).toBe(false);
  });
});
