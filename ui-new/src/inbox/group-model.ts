import type { AttentionProjectRef, AttentionSubject } from "@paperclipai/shared";
import type { GroupBy } from "./inbox-prefs";
import type { RowModel, RowOwner, RowSign } from "./row-model";

/*
 * Needs you grouped by task, agent or project (board 14b), in place of New today and Earlier.
 *
 * - Who a request belongs to: its task (the related task, else the subject when that's a task, so a
 *   sign-off lands under the task it signs off, where upstream's Coordinator files it under "Other
 *   decisions"); the agent that asked, or for a budget stop the agent it paused (`RowOwner`); the
 *   project the feed names.
 * - Catch-alls: "No task", "No project", "People and outside agents", and "Paperclip" for what it
 *   raised itself.
 * - Groups sort by their most urgent request, catch-alls included, and rows keep the Needs you order
 *   inside each: the list comes in most urgent first, so a group sits where its first row would.
 * - Each header carries one most-urgent sign: an expiry under an hour, then "Blocks work", then
 *   "n new".
 */

export type GroupKind = "task" | "agent" | "project" | "paperclip" | "none";

export type GroupRef = {
  key: string;
  kind: GroupKind;
  /** The task, agent or project id; null for a catch-all. */
  id: string | null;
  label: string;
};

export type InboxGroup<T> = GroupRef & { items: T[] };

export type GroupInput = {
  task: Pick<AttentionSubject, "id" | "identifier" | "title"> | null;
  project: Pick<AttentionProjectRef, "id" | "name"> | null;
  owner: RowOwner;
};

/** The group a request falls in under a grouping. */
export function groupOf(input: GroupInput, by: Exclude<GroupBy, "none">): GroupRef {
  if (by === "task") {
    const task = input.task;
    return task ? { key: `group:task:${task.id}`, kind: "task", id: task.id, label: task.title ?? task.identifier ?? "Task" } : { key: "group:task:none", kind: "none", id: null, label: "No task" };
  }
  if (by === "project") {
    const project = input.project;
    return project ? { key: `group:project:${project.id}`, kind: "project", id: project.id, label: project.name } : { key: "group:project:none", kind: "none", id: null, label: "No project" };
  }
  const owner = input.owner;
  if (owner.kind === "agent") return { key: `group:agent:${owner.agentId}`, kind: "agent", id: owner.agentId, label: owner.name };
  if (owner.kind === "paperclip") return { key: "group:agent:paperclip", kind: "paperclip", id: null, label: "Paperclip" };
  return { key: "group:agent:people", kind: "none", id: null, label: "People and outside agents" };
}

/**
 * Items into groups, in the order their first item comes. `items` is most urgent first, so groups
 * sort by their most urgent request and rows keep their order.
 */
export function groupItems<T>(items: readonly T[], refOf: (item: T) => GroupRef): InboxGroup<T>[] {
  const groups = new Map<string, InboxGroup<T>>();
  for (const item of items) {
    const ref = refOf(item);
    const group = groups.get(ref.key);
    if (group) group.items.push(item);
    else groups.set(ref.key, { ...ref, items: [item] });
  }
  return [...groups.values()];
}

/** A header's one sign: a soon expiry, then Blocks work, then how many are new. */
export function urgentSign(rows: readonly { row: Pick<RowModel, "expiry" | "blocks">; fresh: boolean }[]): RowSign | null {
  const soon = rows.find((entry) => entry.row.expiry?.soon);
  if (soon) return { tone: "soon", icon: "clock", text: soon.row.expiry!.text };
  if (rows.some((entry) => entry.row.blocks)) return { tone: "block", icon: "block", text: "Blocks work" };
  const fresh = rows.filter((entry) => entry.fresh).length;
  return fresh ? { tone: "plain", text: `${fresh} new` } : null;
}

/** What a row leaves out because its header shows it: the task ID under a task, the avatar under an agent. */
export function hiddenByGroup(by: GroupBy): "task" | "who" | null {
  return by === "task" ? "task" : by === "agent" ? "who" : null;
}
