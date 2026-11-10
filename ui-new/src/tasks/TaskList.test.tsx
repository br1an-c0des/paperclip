import type { CompactIssue, IssueLabel } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { buildTaskGroups } from "./list-model";
import type { TaskPeople } from "./people";
import type { TaskRetry } from "./retry";
import type { TaskUpdates } from "./task-updates";
import { TaskList } from "./TaskList";

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "company", issuePrefix: "TES" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openNewTask: () => {} }) }));
vi.mock("@/api/task-actions", () => ({ taskActionsApi: { createLabel: vi.fn() } }));
vi.mock("@/api/issues", async (original) => ({
  ...(await original<typeof import("@/api/issues")>()),
  issuesApi: { listLabels: vi.fn() },
}));

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

describe("TaskList labels menu", () => {
  afterEach(cleanup);

  const bug = { id: "l1", name: "Bug", color: "#f2286f" } as IssueLabel;
  const created = { id: "l2", name: "M7 test label", color: "#6366f1" } as IssueLabel;

  function renderRow() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.issues.labels("company"), [bug]);
    const update = vi.fn();
    const onOpen = vi.fn();
    const row = task("t", { labelIds: ["l1"], labels: [bug] } as Partial<CompactIssue>);
    render(() => (
      <QueryClientProvider client={client}>
        <TaskList
          groups={buildTaskGroups([row], new Set())}
          people={people}
          updates={{ update, create: vi.fn() } as unknown as TaskUpdates}
          retry={{ retry: vi.fn(), busy: () => false } as unknown as TaskRetry}
          onOpen={onOpen}
          isOpen={() => true}
          onToggleGroup={() => {}}
          checked={new Set()}
          onCheckedChange={() => {}}
          expanded={new Set()}
          onToggleExpanded={() => {}}
        />
      </QueryClientProvider>
    ));
    return { client, update, onOpen, row };
  }

  const press = (element: Element) => {
    fireEvent.pointerDown(element, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(element, { button: 0, pointerType: "mouse" });
    fireEvent.click(element);
  };

  it("creates a label from a row's menu and adds it to that row's task", async () => {
    vi.mocked(taskActionsApi.createLabel).mockResolvedValue(created);
    vi.mocked(issuesApi.listLabels).mockResolvedValue([bug, created]);
    const { client, update, onOpen, row } = renderRow();

    press(screen.getByRole("button", { name: "Labels: Bug. Change labels" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: /Bug/ })).toBeTruthy();
    press(screen.getByRole("menuitem", { name: /New label…/ }));

    const name = await screen.findByRole("textbox", { name: "Label name" });
    fireEvent.input(name, { target: { value: "  M7 test label " } });
    // A click inside the dialog reaches the row through Solid's delegation, but doesn't open the task.
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(taskActionsApi.createLabel).toHaveBeenCalledWith("company", { name: "M7 test label", color: "#6366f1" });
    expect(update).toHaveBeenCalledWith([{ task: row, data: { labelIds: ["l1", "l2"] } }]);
    expect(client.getQueryData<IssueLabel[]>(queryKeys.issues.labels("company"))?.map((label) => label.id)).toEqual(["l1", "l2"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpen).not.toHaveBeenCalled();
  });
});
