import type { CompactIssue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTaskGroups } from "./list-model";
import type { TaskPeople } from "./people";
import type { TaskRetry } from "./retry";
import type { TaskUpdates } from "./task-updates";
import { TaskList } from "./TaskList";

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "company", issuePrefix: "TES" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openNewTask: () => {} }) }));

// jsdom doesn't scroll; the list scrolls the cursor into view.
Element.prototype.scrollIntoView = () => {};

function task(id: string, extra: Partial<CompactIssue> = {}) {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    parentId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    labelIds: [],
    labels: [],
    blockedBy: [],
    updatedAt: new Date(),
    ...extra,
  } as unknown as CompactIssue;
}

const people = {
  agent: () => undefined,
  assignableAgents: () => [],
  otherPeople: () => [],
  personName: (id: string) => id,
  youId: () => null,
  liveIssueIds: () => new Set<string>(),
} as unknown as TaskPeople;

function renderList() {
  const groups = buildTaskGroups(
    [task("p"), task("k1", { parentId: "p", status: "done" }), task("k2", { parentId: "p" }), task("g", { parentId: "k1" })],
    new Set(),
  );
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (id: string, open: boolean) => {
    const next = new Set(expanded());
    if (open) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };
  render(() => (
    <TaskList
      groups={groups}
      people={people}
      updates={{ update: vi.fn(), create: vi.fn() } as unknown as TaskUpdates}
      retry={{ retry: vi.fn(), busy: () => false } as unknown as TaskRetry}
      onOpen={() => {}}
      isOpen={() => true}
      onToggleGroup={() => {}}
      checked={new Set()}
      onCheckedChange={() => {}}
      expanded={expanded()}
      onToggleExpanded={toggle}
    />
  ));
  return { expanded };
}

const titles = () => [...document.querySelectorAll(".tl-row .tl-title")].map((link) => link.textContent);

describe("TaskList subtasks", () => {
  // The list listens for keys on the document, so each test's list must go before the next.
  afterEach(cleanup);

  it("unfolds a parent's subtasks under it, indented, and folds them again", () => {
    renderList();
    expect(titles()).toEqual(["Task p"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 subtasks, 1 done" }));
    expect(titles()).toEqual(["Task p", "Task k1", "Task k2"]);
    const child = document.querySelector<HTMLElement>('[data-task="k1"]')!;
    expect(child.dataset.parent).toBe("p");
    expect(child.querySelector(".tl-name--sub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 subtask, 0 done" }));
    expect(titles()).toEqual(["Task p", "Task k1", "Task g", "Task k2"]);
    fireEvent.click(screen.getByRole("button", { name: "Hide 2 subtasks, 1 done" }));
    expect(titles()).toEqual(["Task p"]);
  });

  it("unfolds with → and folds with ← from the keyboard", () => {
    const { expanded } = renderList();
    const parent = screen.getByText("Task p");
    parent.focus();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect([...expanded()]).toEqual(["p"]);
    // From a subtask, ← goes to the parent; from the unfolded parent it folds.
    const kid = screen.getByText("Task k2");
    kid.focus();
    fireEvent.keyDown(kid, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: "ArrowLeft" });
    expect([...expanded()]).toEqual([]);
  });
});
