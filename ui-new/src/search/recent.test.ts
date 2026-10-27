import { describe, expect, it } from "vitest";
import { loadRecent, pushRecent, RECENT_LIMIT } from "./recent";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("recent searches", () => {
  it("keeps the newest first, once each, per company", () => {
    const store = memoryStore();
    pushRecent("c1", "login", store);
    pushRecent("c1", "flaky  test", store);
    expect(pushRecent("c1", "LOGIN", store)).toEqual(["LOGIN", "flaky test"]);
    expect(loadRecent("c2", store)).toEqual([]);
  });

  it("caps the list and ignores blanks and bad storage", () => {
    const store = memoryStore();
    for (let index = 0; index < RECENT_LIMIT + 3; index += 1) pushRecent("c1", `q${index}`, store);
    expect(loadRecent("c1", store)).toHaveLength(RECENT_LIMIT);
    expect(pushRecent("c1", "  ", store)).toHaveLength(RECENT_LIMIT);
    store.setItem("paperclip.ui-new.recent-searches.c1", "{not json");
    expect(loadRecent("c1", store)).toEqual([]);
    expect(loadRecent("c1", null)).toEqual([]);
  });
});
