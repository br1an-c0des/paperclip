import { describe, expect, it } from "vitest";
import {
  isRunPromptRecord,
  joinRunPromptSections,
  type RunPromptRecord,
  type RunPromptSection,
} from "./run-prompt.js";

function section(text: string, id: RunPromptSection["id"] = "wake"): RunPromptSection {
  return {
    id,
    label: id,
    placement: "first_message",
    delivery: "every_run",
    reason: "test",
    source: "test",
    text,
    chars: text.length,
  };
}

/**
 * A copy of `joinPromptSections` in `packages/adapter-utils/src/server-utils.ts`, which this
 * package can't import. `joinRunPromptSections` must give the same result on the sections' text.
 */
function referenceJoin(sections: Array<string | null | undefined>, separator = "\n\n") {
  return sections
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(separator);
}

describe("isRunPromptRecord", () => {
  const minimal: RunPromptRecord = {
    version: 1,
    session: "fresh",
    systemPrompt: [],
    firstMessage: [],
    firstMessageChars: 0,
    matchedPlan: true,
  };

  it("accepts a minimal record", () => {
    expect(isRunPromptRecord(minimal)).toBe(true);
  });

  it("accepts a record with sections", () => {
    expect(
      isRunPromptRecord({
        ...minimal,
        session: "resumed",
        firstMessage: [section("hello")],
        firstMessageChars: 5,
      }),
    ).toBe(true);
  });

  it("rejects another version", () => {
    expect(isRunPromptRecord({ ...minimal, version: 2 })).toBe(false);
    expect(isRunPromptRecord({ version: 2 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isRunPromptRecord(null)).toBe(false);
    expect(isRunPromptRecord(undefined)).toBe(false);
    expect(isRunPromptRecord("record")).toBe(false);
    expect(isRunPromptRecord([])).toBe(false);
  });

  it("rejects a record whose section lists are missing", () => {
    const { systemPrompt: _systemPrompt, ...noSystemPrompt } = minimal;
    const { firstMessage: _firstMessage, ...noFirstMessage } = minimal;
    expect(isRunPromptRecord(noSystemPrompt)).toBe(false);
    expect(isRunPromptRecord(noFirstMessage)).toBe(false);
    expect(isRunPromptRecord({ ...minimal, firstMessage: "text" })).toBe(false);
  });
});

describe("joinRunPromptSections", () => {
  const cases: string[][] = [
    [],
    [""],
    ["  "],
    ["a"],
    ["a", "b"],
    ["a", "", "  ", "b"],
    ["  a  ", "\n\nb\n", "\t"],
    ["line 1\nline 2", "", "c\n\n"],
    ["", "", ""],
    [" \n ", "x"],
  ];

  for (const texts of cases) {
    it(`matches joinPromptSections on ${JSON.stringify(texts)}`, () => {
      expect(joinRunPromptSections(texts.map((text) => section(text)))).toBe(referenceJoin(texts));
    });
  }

  it("drops empty and whitespace-only sections and trims the rest", () => {
    expect(joinRunPromptSections(["a", "", "  ", "b"].map((text) => section(text)))).toBe("a\n\nb");
    expect(joinRunPromptSections([section("  a \n"), section("\tb")])).toBe("a\n\nb");
  });

  it("gives an empty string when nothing has text", () => {
    expect(joinRunPromptSections([])).toBe("");
    expect(joinRunPromptSections([section(""), section(" \n\t ")])).toBe("");
  });
});
