import { describe, expect, it } from "vitest";
import { filterPalette, matchScore, quickFilterGroup, QUICK_FILTERS, searchHandOff, type PaletteCommand, type PaletteGroup } from "./palette";

const command = (label: string, keywords?: string): PaletteCommand => ({ id: label, label, keywords, run: () => {} });

describe("matchScore", () => {
  it("needs every word, in the label or the keywords", () => {
    expect(matchScore(command("Open inbox"), "inbox open")).not.toBeNull();
    expect(matchScore(command("Fix login", "GEA-12"), "gea-12")).not.toBeNull();
    expect(matchScore(command("Open inbox"), "inbox settings")).toBeNull();
  });

  it("ranks a label prefix over a word start over anything else", () => {
    expect(matchScore(command("Settings"), "set")).toBe(0);
    expect(matchScore(command("Company settings"), "set")).toBe(1);
    expect(matchScore(command("Reset view"), "set")).toBe(2);
  });
});

describe("filterPalette", () => {
  const groups: PaletteGroup[] = [
    { title: "Pages", commands: [command("Reset view"), command("Company settings"), command("Settings")] },
    { title: "Agents", commands: [command("Ada"), command("Bob"), command("Cy")], idleLimit: 2 },
  ];

  it("shows each group's first entries with no query", () => {
    const idle = filterPalette(groups, " ");
    expect(idle.map((group) => group.commands.length)).toEqual([3, 2]);
  });

  it("ranks matches and drops empty groups", () => {
    const result = filterPalette(groups, "set");
    expect(result).toHaveLength(1);
    expect(result[0]!.commands.map((entry) => entry.label)).toEqual(["Settings", "Company settings", "Reset view"]);
  });
});

describe("searchHandOff", () => {
  it("hands what's typed to the Search page, tidied", () => {
    let opened: string | null = null;
    const group = searchHandOff("  flaky   login ", (query) => (opened = query));
    expect(group.commands.map((entry) => entry.label)).toEqual(["Search everything for “flaky login”"]);
    group.commands[0]!.run();
    expect(opened).toBe("flaky login");
  });

  it("offers plain Search everything with nothing typed", () => {
    expect(searchHandOff("", () => {}).commands[0]!.label).toBe("Search everything");
  });
});

describe("quickFilterGroup", () => {
  it("adds a filter to what's typed and leaves out ones already there", () => {
    let query = "";
    const group = quickFilterGroup("login", (next) => (query = next))!;
    expect(group.commands.map((entry) => entry.label)).toEqual([...QUICK_FILTERS]);
    group.commands[0]!.run();
    expect(query).toBe("login assignee:me ");
    expect(quickFilterGroup("assignee:me is:open", () => {})!.commands.map((entry) => entry.label)).toEqual(["updated:>7d"]);
    expect(quickFilterGroup(QUICK_FILTERS.join(" "), () => {})).toBeNull();
  });
});
