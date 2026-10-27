import { describe, expect, it } from "vitest";
import { opensAs, readTaskOpenMode, TASK_OPEN_MODE_KEY, writeTaskOpenMode } from "./task-open-mode";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("task open mode", () => {
  it("defaults to the docked panel", () => {
    expect(readTaskOpenMode(memory())).toBe("panel");
    expect(readTaskOpenMode(memory({ [TASK_OPEN_MODE_KEY]: "something else" }))).toBe("panel");
    expect(readTaskOpenMode(null)).toBe("panel");
  });

  it("remembers the modal", () => {
    const store = memory();
    writeTaskOpenMode("modal", store);
    expect(readTaskOpenMode(store)).toBe("modal");
    writeTaskOpenMode("panel", store);
    expect(readTaskOpenMode(store)).toBe("panel");
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTaskOpenMode(broken)).toBe("panel");
    expect(() => writeTaskOpenMode("modal", broken)).not.toThrow();
  });

  it("opens the modal on pages without a list, whatever the setting", () => {
    expect(opensAs("panel", true)).toBe("panel");
    expect(opensAs("modal", true)).toBe("modal");
    expect(opensAs("panel", false)).toBe("modal");
  });
});
