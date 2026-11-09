import type { IssueRelationIssueSummary } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLockedRelation, Relation, TaskStatusChip } from "./TaskDetails";

/*
 * A private blocker the viewer may not read arrives in `blockedBy` or `blocks` as a locked stub,
 * `{ id, identifier, locked: true }`. It used to crash the Details section, through the status chip.
 */

const people = { agent: () => undefined, youId: () => null, personName: () => "Someone" };
const locked = { id: "p1", identifier: "TES-42", locked: true as const };
const summary: IssueRelationIssueSummary = {
  id: "t5",
  identifier: "TES-5",
  title: "Fix the flaky login test",
  status: "blocked",
  priority: "high",
  assigneeAgentId: null,
  assigneeUserId: null,
};

afterEach(cleanup);

describe("dependency rows", () => {
  it("tells a locked stub from a readable summary", () => {
    expect(isLockedRelation(locked)).toBe(true);
    expect(isLockedRelation(summary)).toBe(false);
  });

  it("shows a private blocker by its identifier only, with no title, status or link, and still lets it be removed", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(() => <Relation kind="blocked-by" relation={locked} people={people} onOpen={onOpen} onRemove={onRemove} />);
    expect(screen.getByTestId("locked-relation").textContent).toContain("TES-42");
    expect(container.querySelector(".td-status")).toBeNull();
    expect(container.querySelector(".td-link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop TES-42 blocking this task" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a private task this one blocks the same way", () => {
    const { container } = render(() => <Relation kind="blocking" relation={{ id: "p2", identifier: null, locked: true }} people={people} onOpen={() => {}} />);
    expect(screen.getByTestId("locked-relation").textContent).toContain("Private");
    expect(container.querySelector(".td-relation-remove")).toBeNull();
  });

  it("still links a readable blocker, with its title and status", () => {
    const onOpen = vi.fn();
    const { container } = render(() => <Relation kind="blocked-by" relation={summary} people={people} onOpen={onOpen} />);
    expect(container.querySelector(".td-status")?.textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /TES-5/ }));
    expect(onOpen).toHaveBeenCalledWith(summary);
  });

  it("draws no status chip for a task with no status, rather than throwing", () => {
    const { container } = render(() => <TaskStatusChip task={{ status: undefined as never }} small />);
    expect(container.querySelector(".td-status")).toBeNull();
  });
});
