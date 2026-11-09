import { describe, expect, it } from "vitest";
import { groupItems, groupOf, hiddenByGroup, urgentSign, type GroupInput } from "./group-model";
import type { RowModel } from "./row-model";

type Entry = { id: string; input: GroupInput; row: Pick<RowModel, "expiry" | "blocks">; fresh: boolean };

const task = (id: string) => ({ id, identifier: id.toUpperCase(), title: `Task ${id}` });
const project = { id: "p1", name: "Checkout v2" };
const plain = { expiry: null, blocks: false };

// Most urgent first, as Needs you sorts them.
const entries: Entry[] = [
  { id: "tool", input: { task: task("har-44"), project, owner: { kind: "agent", agentId: "be", name: "Backend Engineer" } }, row: { expiry: { text: "38m left", soon: true }, blocks: false }, fresh: true },
  { id: "refunds", input: { task: task("har-41"), project: null, owner: { kind: "agent", agentId: "be", name: "Backend Engineer" } }, row: { expiry: null, blocks: true }, fresh: false },
  { id: "budget", input: { task: null, project: null, owner: { kind: "agent", agentId: "me", name: "Mobile Engineer" } }, row: plain, fresh: true },
  { id: "signoff", input: { task: task("har-39"), project, owner: { kind: "agent", agentId: "be", name: "Backend Engineer" } }, row: plain, fresh: false },
  { id: "split", input: { task: task("har-41"), project: null, owner: { kind: "agent", agentId: "be", name: "Backend Engineer" } }, row: plain, fresh: false },
  { id: "hire", input: { task: null, project: null, owner: { kind: "agent", agentId: "ceo", name: "CEO" } }, row: plain, fresh: false },
  { id: "join", input: { task: null, project: null, owner: { kind: "people" } }, row: plain, fresh: false },
  { id: "stuck", input: { task: task("har-50"), project: null, owner: { kind: "paperclip" } }, row: plain, fresh: false },
];

describe("grouping Needs you", () => {
  it("groups by task, with the catch-all sorted by its most urgent request", () => {
    const groups = groupItems(entries, (entry) => groupOf(entry.input, "task"));
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ["Task har-44", ["tool"]],
      ["Task har-41", ["refunds", "split"]],
      ["No task", ["budget", "hire", "join"]],
      ["Task har-39", ["signoff"]],
      ["Task har-50", ["stuck"]],
    ]);
    expect(groups[2]).toMatchObject({ key: "group:task:none", kind: "none", id: null });
  });

  it("groups by agent: a budget stop under the agent it paused; people and outside agents together; Paperclip apart", () => {
    const groups = groupItems(entries, (entry) => groupOf(entry.input, "agent"));
    expect(groups.map((group) => [group.kind, group.label, group.items.length])).toEqual([
      ["agent", "Backend Engineer", 4],
      ["agent", "Mobile Engineer", 1],
      ["agent", "CEO", 1],
      ["none", "People and outside agents", 1],
      ["paperclip", "Paperclip", 1],
    ]);
  });

  it("groups by project, with No project for the rest", () => {
    const groups = groupItems(entries, (entry) => groupOf(entry.input, "project"));
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.id)])).toEqual([
      ["group:project:p1", ["tool", "signoff"]],
      ["group:project:none", ["refunds", "budget", "split", "hire", "join", "stuck"]],
    ]);
  });

  it("gives a header one sign: a soon expiry, then Blocks work, then how many are new", () => {
    expect(urgentSign(entries.slice(0, 3))).toEqual({ tone: "soon", icon: "clock", text: "38m left" });
    expect(urgentSign(entries.slice(1, 3))).toEqual({ tone: "block", icon: "block", text: "Blocks work" });
    expect(urgentSign(entries.slice(2, 4))).toEqual({ tone: "plain", text: "1 new" });
    expect(urgentSign(entries.slice(3, 5))).toBeNull();
    expect(urgentSign([{ row: { expiry: { text: "6h left", soon: false }, blocks: false }, fresh: false }])).toBeNull();
  });

  it("drops from a row what its header shows", () => {
    expect(hiddenByGroup("task")).toBe("task");
    expect(hiddenByGroup("agent")).toBe("who");
    expect(hiddenByGroup("project")).toBeNull();
    expect(hiddenByGroup("none")).toBeNull();
  });
});
