import { afterEach, describe, expect, it } from "vitest";
import { _resetDismissalMemory, actionHref, dismissalPrefix, readDismissals, saveDismissal, showableAnnouncement, type DismissalStore } from "./announcement-model";

const announcement = {
  id: "new-projects",
  eyebrow: "New",
  title: "Projects got better",
  description: "Read what changed.",
  primaryAction: { kind: "route", label: "Open projects", path: "/projects" },
  secondaryLink: { kind: "external", label: "Release notes", url: "https://paperclip.ing/notes" },
};

function store(): DismissalStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

afterEach(() => _resetDismissalMemory());

describe("which announcements show", () => {
  it("shows a well-formed one", () => {
    expect(showableAnnouncement(announcement)?.id).toBe("new-projects");
  });

  it("drops malformed, unsafe and expired ones", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(showableAnnouncement(null)).toBeNull();
    expect(showableAnnouncement({ ...announcement, id: "Bad ID" })).toBeNull();
    expect(showableAnnouncement({ ...announcement, title: "" })).toBeNull();
    expect(showableAnnouncement({ ...announcement, primaryAction: { kind: "route", label: "x", path: "/api/secrets" } })).toBeNull();
    expect(showableAnnouncement({ ...announcement, secondaryLink: { kind: "external", label: "x", url: "http://insecure.example" } })).toBeNull();
    expect(showableAnnouncement({ ...announcement, expiresAt: "2026-10-27T00:00:00Z" }, now)).toBeNull();
    expect(showableAnnouncement({ ...announcement, expiresAt: "2026-10-29T00:00:00Z" }, now)).not.toBeNull();
  });

  it("puts route actions in the current company", () => {
    expect(actionHref({ kind: "route", label: "x", path: "/projects" }, "TES")).toBe("/TES/projects");
    expect(actionHref({ kind: "external", label: "x", url: "https://paperclip.ing" }, "TES")).toBe("https://paperclip.ing");
  });
});

describe("dismissals", () => {
  it("are kept per person under the old UI's keys", () => {
    const storage = store();
    expect(saveDismissal("user 1", "new-projects", true, storage)).toBe(true);
    expect([...storage.data]).toEqual([[`${dismissalPrefix("user 1")}new-projects`, "pending"]]);
    expect(dismissalPrefix("user 1")).toBe("paperclip.announcement-dismissals.v1:user%201:");
    saveDismissal("user 1", "new-projects", false, storage);
    expect(readDismissals("user 1", storage)).toEqual(new Map([["new-projects", false]]));
    expect(readDismissals("someone-else", storage).size).toBe(0);
  });

  it("still count for this visit without storage", () => {
    expect(saveDismissal("u", "a", true, null)).toBe(false);
    expect(readDismissals("u", null)).toEqual(new Map([["a", true]]));
  });

  it("ignore stray keys", () => {
    const storage = store();
    storage.setItem(`${dismissalPrefix("u")}Bad ID`, "pending");
    storage.setItem(`${dismissalPrefix("u")}ok`, "weird");
    expect(readDismissals("u", storage).size).toBe(0);
  });
});
