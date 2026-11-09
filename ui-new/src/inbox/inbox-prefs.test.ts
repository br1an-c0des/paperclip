import { afterEach, describe, expect, it, vi } from "vitest";
import { readCardsMode, readFolds, readGroupBy, writeCardsMode, writeFolds, writeGroupBy } from "./inbox-prefs";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("what Needs you remembers on this device", () => {
  it("rests collapsed until Expand all, per company", () => {
    expect(readCardsMode("c1")).toBe("collapsed");
    writeCardsMode("c1", "expanded");
    expect(readCardsMode("c1")).toBe("expanded");
    expect(readCardsMode("c2")).toBe("collapsed");
    writeCardsMode("c1", "collapsed");
    expect(readCardsMode("c1")).toBe("collapsed");
  });

  it("remembers the grouping per company, and ignores a bad value", () => {
    expect(readGroupBy("c1")).toBe("none");
    writeGroupBy("c1", "agent");
    expect(readGroupBy("c1")).toBe("agent");
    expect(readGroupBy("c2")).toBe("none");
    localStorage.setItem("paperclip.ui-new.inbox-group.c1", "weekday");
    expect(readGroupBy("c1")).toBe("none");
  });

  it("keeps folds apart for each grouping", () => {
    writeFolds("c1", "task", new Set(["group:task:t1", "group:task:none"]));
    writeFolds("c1", "agent", new Set(["group:agent:a1"]));
    expect([...readFolds("c1", "task")]).toEqual(["group:task:t1", "group:task:none"]);
    expect([...readFolds("c1", "agent")]).toEqual(["group:agent:a1"]);
    expect(readFolds("c1", "project").size).toBe(0);
    expect(readFolds("c1", "none").size).toBe(0);
    writeFolds("c1", "task", new Set());
    expect(localStorage.getItem("paperclip.ui-new.inbox-folds.task.c1")).toBeNull();
    localStorage.setItem("paperclip.ui-new.inbox-folds.agent.c1", "{not json");
    expect(readFolds("c1", "agent").size).toBe(0);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeCardsMode("c1", "expanded")).not.toThrow();
    expect(() => writeFolds("c1", "task", new Set(["x"]))).not.toThrow();
    expect(readCardsMode("c1")).toBe("collapsed");
    expect(readGroupBy("c1")).toBe("none");
    expect(readFolds("c1", "task").size).toBe(0);
  });
});
