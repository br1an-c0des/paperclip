import type { Goal, Project } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { descendantIds, goalAncestors, goalEditorEdit, newGoalEditorPayload, parentCandidates, servedProjects, subGoals, withParent } from "./goal-model";
import { emptyGoalDraft, goalDraft, type ProjectGoal } from "./settings-model";

const goal = (id: string, parentId: string | null = null, extra: Partial<Goal> = {}): Goal => ({
  id,
  companyId: "c1",
  title: id.toUpperCase(),
  description: null,
  level: "task",
  status: "planned",
  parentId,
  ownerAgentId: null,
  createdAt: new Date("2026-10-01"),
  updatedAt: new Date("2026-10-02"),
  ...extra,
});

// a ─ b ─ c, a ─ d; e on its own, archived; f and g point at each other (a loop already stored).
const goals = [goal("a", null, { level: "company" }), goal("b", "a"), goal("c", "b"), goal("d", "a", { status: "cancelled" }), goal("e", null, { status: "cancelled" }), goal("f", "g"), goal("g", "f")];

describe("descendantIds", () => {
  it("collects every goal below, not the goal itself", () => {
    expect([...descendantIds("a", goals)].sort()).toEqual(["b", "c", "d"]);
    expect([...descendantIds("c", goals)]).toEqual([]);
  });

  it("stops at a stored loop", () => {
    expect([...descendantIds("f", goals)]).toEqual(["g"]);
  });
});

describe("parentCandidates", () => {
  it("leaves out the goal, its sub-goals and archived goals", () => {
    expect(parentCandidates("b", null, goals).map((entry) => entry.id)).toEqual(["a", "f", "g"]);
  });

  it("keeps an archived goal that is already the parent", () => {
    expect(parentCandidates("b", "e", goals).map((entry) => entry.id)).toContain("e");
  });

  it("offers every open goal to a new goal, company level first", () => {
    expect(parentCandidates(null, null, goals).map((entry) => entry.id)).toEqual(["a", "b", "c", "f", "g"]);
  });
});

describe("goal edits with a parent", () => {
  const stored: ProjectGoal = { ...goal("b", "a"), loaded: true };

  it("sends the parent only when it changes", () => {
    expect(goalEditorEdit(stored, withParent(goalDraft(stored), "a"))).toBeNull();
    expect(goalEditorEdit(stored, withParent(goalDraft(stored), null))).toEqual({ parentId: null });
    expect(goalEditorEdit(stored, { ...withParent(goalDraft(stored), "f"), title: "New" })).toEqual({ title: "New", parentId: "f" });
  });

  it("creates with a parent when one is picked", () => {
    expect(newGoalEditorPayload({ ...withParent(emptyGoalDraft(), "a"), title: "Child" })).toMatchObject({ title: "Child", parentId: "a" });
    expect(newGoalEditorPayload({ ...withParent(emptyGoalDraft(), null), title: "Top" })).not.toHaveProperty("parentId");
  });
});

describe("subGoals and goalAncestors", () => {
  it("lists direct sub-goals, archived last", () => {
    expect(subGoals("a", [...goals, goal("a2", "a")]).map((entry) => entry.id)).toEqual(["a2", "b", "d"]);
  });

  it("walks up to the top and stops at a loop", () => {
    expect(goalAncestors("c", goals).map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(goalAncestors("f", goals).map((entry) => entry.id)).toEqual(["g"]);
  });
});

describe("servedProjects", () => {
  const project = (id: string, name: string, goalIds: string[]) => ({ id, name, goalIds, goals: [], goalId: null }) as unknown as Project;

  it("lists the projects linking the goal, the current one first", () => {
    const projects = [project("p1", "Alpha", ["a"]), project("p2", "Beta", ["b", "a"]), project("p3", "Gamma", [])];
    expect(servedProjects("a", projects, "p2").map((entry) => entry.id)).toEqual(["p2", "p1"]);
  });
});
