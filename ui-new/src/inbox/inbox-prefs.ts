/*
 * What the Inbox's Needs you remembers on this device, per company (board 14b), as seen.ts keeps the
 * last visit: per-viewer conveniences in localStorage, read and written inside try/catch, so a
 * blocked store (a private window, a preview) just means the defaults.
 *
 * - Cards: the last Collapse all or Expand all. Collapsed until you pick Expand all. Cards you open
 *   or close one at a time aren't remembered.
 * - Group: None, Task, Agent or Project.
 * - Folds: which group headers are folded, kept apart for each grouping.
 */

export type CardsMode = "collapsed" | "expanded";

export type GroupBy = "none" | "task" | "agent" | "project";

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "task", label: "Task" },
  { value: "agent", label: "Agent" },
  { value: "project", label: "Project" },
];

const PREFIX = "paperclip.ui-new.inbox";
const cardsKey = (companyId: string) => `${PREFIX}-cards.${companyId}`;
const groupKey = (companyId: string) => `${PREFIX}-group.${companyId}`;
const foldsKey = (companyId: string, by: GroupBy) => `${PREFIX}-folds.${by}.${companyId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts this visit only.
  }
}

export function readCardsMode(companyId: string): CardsMode {
  return read(cardsKey(companyId)) === "expanded" ? "expanded" : "collapsed";
}

export function writeCardsMode(companyId: string, mode: CardsMode) {
  write(cardsKey(companyId), mode);
}

export function readGroupBy(companyId: string): GroupBy {
  const value = read(groupKey(companyId));
  return GROUP_BY_OPTIONS.some((option) => option.value === value) ? (value as GroupBy) : "none";
}

export function writeGroupBy(companyId: string, by: GroupBy) {
  write(groupKey(companyId), by);
}

/** The folded group keys for one grouping; none for an ungrouped list or a bad entry. */
export function readFolds(companyId: string, by: GroupBy): Set<string> {
  if (by === "none") return new Set();
  try {
    const parsed: unknown = JSON.parse(read(foldsKey(companyId, by)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeFolds(companyId: string, by: GroupBy, folds: ReadonlySet<string>) {
  if (by === "none") return;
  write(foldsKey(companyId, by), folds.size ? JSON.stringify([...folds]) : null);
}
