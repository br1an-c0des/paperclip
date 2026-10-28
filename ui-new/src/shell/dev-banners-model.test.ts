import { describe, expect, it } from "vitest";
import { changedAgo, normalizeHexColor, readableTextColor, restartPlan, restartReason, sampleList, worktreeBranding } from "./dev-banners-model";

describe("the restart banner", () => {
  it("says why and what's next", () => {
    expect(restartReason({ reason: "pending_migrations" })).toMatch(/migrations/);
    expect(restartReason({ reason: "backend_changes_and_pending_migrations" })).toMatch(/Backend files changed and migrations/);
    expect(restartReason({ reason: null })).toMatch(/Backend files changed/);
    expect(restartPlan({ waitingForIdle: true, autoRestartEnabled: true, activeRunCount: 1 })).toBe("Waiting for 1 live run to finish.");
    expect(restartPlan({ waitingForIdle: false, autoRestartEnabled: true, activeRunCount: 0 })).toMatch(/by itself/);
    expect(restartPlan({ waitingForIdle: false, autoRestartEnabled: false, activeRunCount: 2 })).toMatch(/safe to interrupt/);
  });

  it("summarizes lists and times", () => {
    expect(sampleList(["a", "b", "c", "d"], 7)).toBe("a, b, c +4 more");
    expect(sampleList(["a"], 1)).toBe("a");
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(changedAgo("2026-10-28T11:59:30Z", now)).toBe("just now");
    expect(changedAgo("2026-10-28T11:15:00Z", now)).toBe("45m ago");
    expect(changedAgo("2026-10-28T06:00:00Z", now)).toBe("6h ago");
    expect(changedAgo("2026-10-25T12:00:00Z", now)).toBe("3d ago");
    expect(changedAgo("not a date", now)).toBeNull();
  });
});

describe("worktree branding", () => {
  const meta = (tags: Record<string, string>) => (name: string) => tags[name] ?? null;

  it("reads the server's meta tags", () => {
    expect(worktreeBranding(meta({ "paperclip-worktree-enabled": "true", "paperclip-worktree-name": "pap-42", "paperclip-worktree-color": "#FA0" }))).toEqual({
      name: "pap-42",
      color: "#ffaa00",
      textColor: "#111827",
    });
    expect(worktreeBranding(meta({ "paperclip-worktree-enabled": "true", "paperclip-worktree-name": "x", "paperclip-worktree-color": "#123456", "paperclip-worktree-text-color": "#fff" }))?.textColor).toBe("#ffffff");
  });

  it("is off outside a worktree or without a name and colour", () => {
    expect(worktreeBranding(meta({}))).toBeNull();
    expect(worktreeBranding(meta({ "paperclip-worktree-enabled": "true", "paperclip-worktree-color": "#fff" }))).toBeNull();
    expect(worktreeBranding(meta({ "paperclip-worktree-enabled": "true", "paperclip-worktree-name": "x", "paperclip-worktree-color": "red" }))).toBeNull();
  });

  it("picks readable text", () => {
    expect(readableTextColor("#000000")).toBe("#f8fafc");
    expect(readableTextColor("#ffffff")).toBe("#111827");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
  });
});
