import { describe, expect, it } from "vitest";
import { findRanges } from "./find-in-run";
import { foldsToReveal, holds, itemText, matchOffsets, stepMatch } from "./find-model";
import type { TranscriptItem } from "./transcript-model";

function tool(key: string, title: string, output = ""): TranscriptItem {
  return {
    kind: "tool",
    key,
    ts: "2026-10-26T10:00:00Z",
    endTs: null,
    name: "Bash",
    step: "command",
    title,
    input: `run ${title}`,
    output,
    status: "done",
    diff: null,
    added: 0,
    removed: 0,
    refs: {},
  };
}

const message = (key: string, text: string): TranscriptItem => ({ kind: "message", key, ts: "2026-10-26T10:00:00Z", role: "assistant", text, streaming: false });

describe("find-model", () => {
  it("reads a tool call's name, title, input and output", () => {
    expect(itemText(tool("t1", "ls", "README.md"))).toContain("README.md");
    expect(holds(itemText(tool("t1", "ls", "README.md")), "readme")).toBe(true);
    expect(holds("anything", "  ")).toBe(false);
  });

  it("opens the folds hiding a match, and only those", () => {
    // Seven steps between two messages fold the first five.
    const steps = Array.from({ length: 7 }, (_, index) => tool(`t${index}`, `step ${index}`, index === 1 ? "needle here" : ""));
    const items = [message("m1", "start"), ...steps, message("m2", "end")];
    expect(foldsToReveal(items, { thinking: true, tools: true }, "needle")).toEqual(new Set(["fold:t0"]));
    expect(foldsToReveal(items, { thinking: true, tools: true }, "start")).toEqual(new Set());
    expect(foldsToReveal(items, { thinking: true, tools: true }, "")).toEqual(new Set());
  });

  it("finds every match, ignoring case, without overlaps", () => {
    expect(matchOffsets("Aa aA aaa", "aa")).toEqual([0, 3, 6]);
    expect(matchOffsets("text", "")).toEqual([]);
  });

  it("steps through matches, wrapping round", () => {
    expect(stepMatch(-1, 1, 3)).toBe(0);
    expect(stepMatch(-1, -1, 3)).toBe(2);
    expect(stepMatch(2, 1, 3)).toBe(0);
    expect(stepMatch(0, -1, 3)).toBe(2);
    expect(stepMatch(0, 1, 0)).toBe(-1);
  });
});

describe("findRanges", () => {
  it("finds matches in the view's text, including closed details, but not in buttons", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>Reading the config file</p><details><summary>Tool</summary><pre>config: true</pre></details><button>config</button>`;
    const ranges = findRanges(root, "CONFIG");
    expect(ranges.map((range) => range.toString())).toEqual(["config", "config"]);
    expect(ranges[1]!.startContainer.parentElement?.tagName).toBe("PRE");
  });
});
