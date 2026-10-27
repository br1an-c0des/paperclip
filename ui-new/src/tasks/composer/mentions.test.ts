import { describe, expect, it } from "vitest";
import { activeMention, decorateMentions, insertMention, matchesQuery, parseMentions, splitCode, taskRefFromHref } from "./mentions";

describe("activeMention", () => {
  it("finds the @query just before the caret", () => {
    expect(activeMention("Hi @qua", 7)).toEqual({ start: 3, end: 7, query: "qua" });
    expect(activeMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(activeMention("(@sam", 5)?.query).toBe("sam");
  });

  it("ignores email addresses and finished words", () => {
    expect(activeMention("mail me@example.com", 19)).toBeNull();
    expect(activeMention("@sam done", 9)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the query with the mention link and a space", () => {
    const text = "Ask @qu about it";
    const at = activeMention(text, 7)!;
    const result = insertMention(text, at, { kind: "agent", id: "a1", name: "Quant [R]" });
    expect(result.text).toBe("Ask [@Quant \\[R\\]](agent://a1) about it");
    expect(result.text.slice(0, result.caret)).toBe("Ask [@Quant \\[R\\]](agent://a1) ");
  });

  it("writes task mentions as task links", () => {
    const result = insertMention("See @TR", activeMention("See @TR", 7)!, { kind: "task", id: "t1", identifier: "TRA-41" });
    expect(result.text).toBe("See [TRA-41](/issues/TRA-41) ");
  });
});

describe("parsing and decorating", () => {
  const message = "Thanks [@Quant](agent://a1?i=bot) and [@Sam K.](user://u1). See TRA-41 and `TRA-9` and [TRA-2](/issues/TRA-2).";

  it("lists the mentions outside code", () => {
    expect(parseMentions(message)).toEqual([
      { kind: "agent", id: "a1", label: "@Quant" },
      { kind: "user", id: "u1", label: "@Sam K." },
    ]);
    expect(parseMentions("```\n[@X](agent://a9)\n```")).toEqual([]);
  });

  it("turns mentions into chips and bare identifiers into task links, leaving code alone", () => {
    const html = decorateMentions(message, "TRA");
    expect(html).toContain('<span class="mention mention--agent" data-mention="agent" data-id="a1">@Quant</span>');
    expect(html).toContain('data-mention="user" data-id="u1">@Sam K.</span>');
    expect(html).toContain("See [TRA-41](/issues/TRA-41)");
    expect(html).toContain("`TRA-9`");
    expect(html).toContain("[TRA-2](/issues/TRA-2)");
    expect(html).not.toContain("[[TRA-2]");
  });

  it("only links the company's own prefix", () => {
    expect(decorateMentions("UTF-8 and TRA-3", "TRA")).toBe("UTF-8 and [TRA-3](/issues/TRA-3)");
    expect(decorateMentions("TRA-3", null)).toBe("TRA-3");
  });

  it("escapes names", () => {
    expect(decorateMentions("[@<b>](user://u1)")).toContain(">@&lt;b&gt;</span>");
  });

  it("splits fenced blocks and inline code", () => {
    expect(splitCode("a `b` c\n```js\nx\n```\nd").map((segment) => segment.code)).toEqual([false, true, false, true, false]);
  });
});

describe("helpers", () => {
  it("reads task links", () => {
    expect(taskRefFromHref("/issues/tra-41")).toBe("TRA-41");
    expect(taskRefFromHref("https://board.example/TRA/issues/TRA-41#c1")).toBe("TRA-41");
    expect(taskRefFromHref("https://example.com")).toBeNull();
  });

  it("matches any word of a name", () => {
    expect(matchesQuery("Quant Researcher", "res")).toBe(true);
    expect(matchesQuery("Quant Researcher", "xyz")).toBe(false);
    expect(matchesQuery("Anyone", "")).toBe(true);
  });
});
