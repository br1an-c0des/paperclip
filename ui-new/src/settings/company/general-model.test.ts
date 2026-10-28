import { describe, expect, it } from "vitest";
import { canonicalAudience, descriptionEdit, kindAudience, nameEdit, setKindAudience, startsNarrower } from "./general-model";

describe("organization edits", () => {
  it("renames only to a new, non-blank name", () => {
    expect(nameEdit({ name: "Acme" }, " Acme ")).toBeNull();
    expect(nameEdit({ name: "Acme" }, "  ")).toBeNull();
    expect(nameEdit({ name: "Acme" }, "Acme Labs ")).toEqual({ name: "Acme Labs" });
  });

  it("clears a blank description", () => {
    expect(descriptionEdit({ description: "Hello" }, "  ")).toEqual({ description: null });
    expect(descriptionEdit({ description: null }, "")).toBeNull();
    expect(descriptionEdit({ description: "Hello" }, "Hello")).toBeNull();
    expect(descriptionEdit({ description: null }, " New ")).toEqual({ description: "New" });
  });
});

describe("agent request audiences", () => {
  it("maps the legacy aliases", () => {
    expect(canonicalAudience(undefined)).toBe("anyone");
    expect(canonicalAudience("board_or_agents")).toBe("anyone");
    expect(canonicalAudience("board_only")).toBe("human_only");
    expect(canonicalAudience("not_creator")).toBe("not_creator");
  });

  it("reads a kind's cap and default", () => {
    expect(kindAudience({}, "ask_user_questions")).toEqual({ cap: "anyone", start: "anyone" });
    expect(kindAudience({ ask_user_questions: { cap: "human_only", defaultPolicy: "not_creator" } }, "ask_user_questions")).toEqual({
      cap: "human_only",
      start: "not_creator",
    });
  });

  it("keeps the stored object sparse", () => {
    const capped = setKindAudience({}, "suggest_tasks", "cap", "human_only");
    expect(capped).toEqual({ suggest_tasks: { cap: "human_only" } });
    expect(setKindAudience(capped, "suggest_tasks", "cap", "anyone")).toEqual({});
    const both = setKindAudience(capped, "suggest_tasks", "defaultPolicy", "not_creator");
    expect(both).toEqual({ suggest_tasks: { cap: "human_only", defaultPolicy: "not_creator" } });
    expect(setKindAudience(both, "suggest_tasks", "cap", "anyone")).toEqual({ suggest_tasks: { defaultPolicy: "not_creator" } });
  });

  it("doesn't change the object it was given", () => {
    const before = { request_confirmation: { cap: "human_only" as const } };
    setKindAudience(before, "request_confirmation", "cap", "anyone");
    expect(before).toEqual({ request_confirmation: { cap: "human_only" } });
  });

  it("says when new requests start narrower than the cap", () => {
    expect(startsNarrower({ cap: "anyone", start: "human_only" })).toBe(true);
    expect(startsNarrower({ cap: "human_only", start: "not_creator" })).toBe(false);
    expect(startsNarrower({ cap: "anyone", start: "anyone" })).toBe(false);
  });
});
