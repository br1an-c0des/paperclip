import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import type { FilterDimension, SearchFilters } from "./filters";

/*
 * Filters typed into the search box (board S1's tip: "type them in the search box, like
 * status:blocked or updated:7d"), after ui/src/lib/search-query-parser.ts:
 *
 * - `status:blocked`, `priority:high`, `is:open`, `is:closed`;
 * - `assignee:me`, `assignee:none`, `assignee:<agent name or url key>` (quote names with spaces:
 *   `assignee:"Quant Researcher"`);
 * - `project:<name or url key>`, `label:<name>`;
 * - `updated:7d` or `updated:>7d` (any `<n>h|d|w|m`).
 *
 * A token that doesn't resolve, such as an unknown agent, stays in the text and is searched for.
 */

export type ParserContext = {
  youId?: string | null;
  agents?: readonly { id: string; name: string; urlKey?: string | null }[];
  projects?: readonly { id: string; name: string; urlKey?: string | null }[];
  labels?: readonly { id: string; name: string }[];
};

export type ParsedQuery = {
  /** The words to search for, without the filter tokens. */
  text: string;
  filters: Partial<SearchFilters>;
  /** The dimensions the typed tokens set. */
  dimensions: FilterDimension[];
};

const OPEN: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked"];
const CLOSED: IssueStatus[] = ["done", "cancelled"];

/** Splits on whitespace, keeping `"quoted phrases"` and `key:"quoted values"` whole. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index]!)) index += 1;
    if (index >= input.length) break;
    const start = index;
    if (input[index] === '"') {
      index += 1;
      while (index < input.length && input[index] !== '"') index += 1;
      if (index < input.length) index += 1;
    } else {
      while (index < input.length && !/\s/.test(input[index]!)) {
        if (input[index] === ":" && input[index + 1] === '"') {
          index += 2;
          while (index < input.length && input[index] !== '"') index += 1;
          if (index < input.length) index += 1;
          break;
        }
        index += 1;
      }
    }
    tokens.push(input.slice(start, index));
  }
  return tokens;
}

function unquote(value: string) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, "-");

function byNameOrKey<T extends { id: string; name: string; urlKey?: string | null }>(entries: readonly T[] | undefined, value: string) {
  const wanted = normalize(value);
  return entries?.find(
    (entry) => entry.id === value || normalize(entry.name) === wanted || (entry.urlKey ? normalize(entry.urlKey) === wanted : false),
  );
}

type Resolved = { dimension: FilterDimension; filters: Partial<SearchFilters> };

/** What one token sets, or null when it's plain text. */
function resolveToken(token: string, context: ParserContext): Resolved | null {
  const match = /^([a-zA-Z]+):(.+)$/s.exec(token);
  if (!match) return null;
  const key = match[1]!.toLowerCase();
  const value = unquote(match[2]!).trim();
  const lower = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) return null;
  switch (key) {
    case "status":
      return Object.hasOwn(STATUS_META, lower) ? { dimension: "status", filters: { status: [lower as IssueStatus] } } : null;
    case "is":
      if (lower === "open") return { dimension: "status", filters: { status: OPEN } };
      if (lower === "closed") return { dimension: "status", filters: { status: CLOSED } };
      return null;
    case "priority":
      return Object.hasOwn(PRIORITY_META, lower) ? { dimension: "priority", filters: { priority: [lower as IssuePriority] } } : null;
    case "assignee": {
      if (lower === "me") return context.youId ? { dimension: "assignee", filters: { assignee: `user:${context.youId}` } } : null;
      if (lower === "none" || lower === "unassigned") return { dimension: "assignee", filters: { assignee: "none" } };
      const agent = byNameOrKey(context.agents, value);
      return agent ? { dimension: "assignee", filters: { assignee: `agent:${agent.id}` } } : null;
    }
    case "project": {
      const project = byNameOrKey(context.projects, value);
      return project ? { dimension: "project", filters: { projectId: project.id } } : null;
    }
    case "label": {
      const label = byNameOrKey(context.labels, value);
      return label ? { dimension: "label", filters: { labelId: label.id } } : null;
    }
    case "updated": {
      const window = value.replace(/^>/, "");
      return /^[1-9]\d{0,2}(h|d|w|m)$/.test(window) ? { dimension: "updated", filters: { updated: window } } : null;
    }
    default:
      return null;
  }
}

export function parseQuery(input: string, context: ParserContext = {}): ParsedQuery {
  const words: string[] = [];
  const filters: Partial<SearchFilters> = {};
  const dimensions: FilterDimension[] = [];
  for (const token of tokenize(input)) {
    const resolved = resolveToken(token, context);
    if (!resolved) {
      words.push(token);
      continue;
    }
    if (!dimensions.includes(resolved.dimension)) dimensions.push(resolved.dimension);
    const { status, priority, ...single } = resolved.filters;
    if (status) filters.status = [...new Set([...(filters.status ?? []), ...status])];
    if (priority) filters.priority = [...new Set([...(filters.priority ?? []), ...priority])];
    Object.assign(filters, single);
  }
  return { text: words.join(" "), filters, dimensions };
}

/** The query with its filter tokens taken out: all of them, or one dimension's. */
export function stripFilters(input: string, context: ParserContext = {}, dimension?: FilterDimension): string {
  return tokenize(input)
    .filter((token) => {
      const resolved = resolveToken(token, context);
      return !resolved || (dimension !== undefined && resolved.dimension !== dimension);
    })
    .join(" ");
}

