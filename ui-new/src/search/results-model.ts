import type {
  CompanySearchCountType,
  CompanySearchHighlight,
  CompanySearchResult,
  CompanySearchScope,
  CompanySearchSnippet,
} from "@paperclipai/shared";
import { chatPath, documentHash, documentKeyFromHash } from "@/chat/chat-model";

/*
 * How search results are drawn (board S1, decision 17): grouped by kind, each row as the API
 * returns it, with no extra requests per result.
 *
 * The API has four result types (task, file, agent, project). Comments and documents aren't results
 * of their own: a task found through a comment or a document comes back as a task whose link points
 * at that evidence (`…/issues/TES-5#comment-<id>` or `#document-<key>`), with the best-matching
 * snippet and no author or revision. In All those are the Comments and Docs sections; a task that
 * also matches by its title or description stays with Tasks, so the Comments and Docs counts
 * (`countsByType`) can be larger than their rows. In a kind's own view every row is drawn as that
 * kind.
 */

export type ResultKind = "task" | "comment" | "document" | "file" | "agent" | "project";

export type KindMeta = { kind: ResultKind; label: string; scope: CompanySearchScope; count: CompanySearchCountType };

/** The kinds in the order the board draws them, with the tab, scope and count each one uses. */
export const KINDS: readonly KindMeta[] = [
  { kind: "task", label: "Tasks", scope: "issues", count: "issue" },
  { kind: "comment", label: "Comments", scope: "comments", count: "comment" },
  { kind: "document", label: "Docs", scope: "documents", count: "document" },
  { kind: "file", label: "Files", scope: "artifacts", count: "artifact" },
  { kind: "agent", label: "Agents", scope: "agents", count: "agent" },
  { kind: "project", label: "Projects", scope: "projects", count: "project" },
];

export function kindOfScope(scope: CompanySearchScope): KindMeta | undefined {
  return KINDS.find((meta) => meta.scope === scope);
}

/** The kind a result is drawn as in All. */
export function resultKind(result: CompanySearchResult): ResultKind {
  switch (result.type) {
    case "artifact":
      return "file";
    case "agent":
      return "agent";
    case "project":
      return "project";
    case "issue":
      if (result.href.includes("#comment-")) return "comment";
      if (result.href.includes("#document-")) return "document";
      return "task";
  }
}

export type Counts = Partial<Record<CompanySearchCountType, number>>;

export type ScopeTab = { scope: CompanySearchScope; label: string; count: number | null };

/**
 * The scope tabs with their counts. `counts` are All's, when known; a kind's own view also knows
 * its count. Agents and projects show no count while task filters are set, since the server leaves
 * them out then.
 */
export function scopeTabs(counts: Counts | null, current?: { scope: CompanySearchScope; counts: Counts }, filtered = false): ScopeTab[] {
  const countFor = (meta: KindMeta): number | null => {
    if (filtered && (meta.kind === "agent" || meta.kind === "project")) return null;
    if (current && current.scope === meta.scope) return current.counts[meta.count] ?? 0;
    return counts ? (counts[meta.count] ?? 0) : null;
  };
  const kinds = KINDS.map((meta) => ({ scope: meta.scope, label: meta.label, count: countFor(meta) }));
  const total = counts ? KINDS.reduce((sum, meta) => sum + (counts[meta.count] ?? 0), 0) : null;
  return [{ scope: "all", label: "All", count: total }, ...kinds];
}

export type ResultSection = {
  kind: ResultKind;
  label: string;
  scope: CompanySearchScope;
  /** How many there are in all, from the counts; at least the rows shown. */
  count: number;
  results: CompanySearchResult[];
  /** There are more than shown here: "All n" opens the kind's view. */
  more: boolean;
};

/** In All, the board shows the top four tasks and the top two of everything else. */
export const ALL_CAPS: Record<ResultKind, number> = { task: 4, comment: 2, document: 2, file: 2, agent: 2, project: 2 };

/**
 * The sections to draw. In All: one per kind with rows or a count, in the board's order, each cut
 * to its cap. In a kind's view: that kind alone, with every row the pages hold.
 */
export function groupResults(results: readonly CompanySearchResult[], counts: Counts, scope: CompanySearchScope): ResultSection[] {
  if (scope !== "all") {
    const meta = kindOfScope(scope);
    if (!meta) return [];
    const count = Math.max(counts[meta.count] ?? 0, results.length);
    return results.length ? [{ kind: meta.kind, label: meta.label, scope, count, results: [...results], more: false }] : [];
  }
  const byKind = new Map<ResultKind, CompanySearchResult[]>();
  for (const result of results) {
    const kind = resultKind(result);
    byKind.set(kind, [...(byKind.get(kind) ?? []), result]);
  }
  return KINDS.flatMap((meta) => {
    const rows = byKind.get(meta.kind) ?? [];
    const count = Math.max(counts[meta.count] ?? 0, rows.length);
    if (count === 0) return [];
    const shown = rows.slice(0, ALL_CAPS[meta.kind]);
    return [{ kind: meta.kind, label: meta.label, scope: meta.scope, count, results: shown, more: count > shown.length }];
  });
}

/** Every result the sections show, in order: what the arrow keys move through. */
export function shownResults(sections: readonly ResultSection[]) {
  return sections.flatMap((section) => section.results);
}

export type Segment = { text: string; hit: boolean };

/** Splits text into plain and matched runs, from the API's highlight ranges (clamped and merged). */
export function highlightSegments(text: string, highlights: readonly CompanySearchHighlight[] | null | undefined): Segment[] {
  const ranges = (highlights ?? [])
    .map((range) => {
      const start = Math.max(0, Math.min(text.length, range.start));
      return { start, end: Math.max(start, Math.min(text.length, range.end)) };
    })
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), hit: false });
    segments.push({ text: text.slice(range.start, range.end), hit: true });
    cursor = range.end;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

const TITLE_FIELDS = new Set(["title", "identifier"]);

/** The title to draw, with matches marked where the API marked them on the title itself. */
export function titleSegments(result: CompanySearchResult): Segment[] {
  const title = result.issue?.title ?? result.title;
  const snippet = result.snippets.find((entry) => entry.field === "title");
  return highlightSegments(title, snippet && snippet.text === title ? snippet.highlights : null);
}

/**
 * The one snippet a row shows: for a comment or document row, the snippet from that source when
 * the API sent one; otherwise the best one that isn't the title (which the row already shows).
 */
export function rowSnippet(result: CompanySearchResult, kind: ResultKind): CompanySearchSnippet | null {
  const body = result.snippets.filter((entry) => !TITLE_FIELDS.has(entry.field) && entry.text.trim());
  if (kind === "comment" || kind === "document") {
    const field = kind === "comment" ? "comment" : "document";
    const own = body.find((entry) => entry.field === field);
    if (own) return own;
  }
  return body[0] ?? null;
}

/** What a snippet's source is called on the row: "Comment", "Description", a document's title. */
export function snippetLabel(snippet: CompanySearchSnippet, kind: ResultKind) {
  if (kind === "document" && snippet.field === "document") return "Document";
  if (snippet.field === "capabilities") return "Role";
  return snippet.label;
}

/** The document's title, for a Docs row: the API labels a document snippet with it. */
export function documentTitle(result: CompanySearchResult) {
  const snippet = result.snippets.find((entry) => entry.field === "document");
  return snippet?.label && snippet.label !== "Document" ? snippet.label : null;
}

/** The task a result opens, if it's task-shaped: the task, a comment or document on it, or a file. */
export function resultTask(result: CompanySearchResult) {
  if (result.issue) {
    return { id: result.issue.id, identifier: result.issue.identifier, title: result.issue.title, projectId: result.issue.projectId };
  }
  if (result.artifact) {
    return {
      id: result.artifact.issueId,
      identifier: result.artifact.issueIdentifier,
      title: result.artifact.issueTitle,
      projectId: result.artifact.projectId,
    };
  }
  return null;
}

/**
 * The part of a result's link that points into its task: `#comment-<id>` or `#document-<key>`, or
 * "" for the task itself. The task's sections read it to scroll to the comment or open the document.
 */
export function resultFragment(result: Pick<CompanySearchResult, "href">) {
  const at = result.href.indexOf("#");
  if (at === -1) return "";
  const fragment = result.href.slice(at);
  return fragment.startsWith("#comment-") || fragment.startsWith("#document-") ? fragment : "";
}

const IDENTIFIER = /^[A-Za-z]+-\d+$/;

/**
 * The result Enter opens from the search box: for a task ID such as TES-5, that task when it's
 * among the results (a task ID jumps straight to it, M14); otherwise the first result.
 */
export function enterTarget(results: readonly CompanySearchResult[], query: string): CompanySearchResult | undefined {
  const wanted = query.trim().toUpperCase();
  if (IDENTIFIER.test(wanted)) {
    const exact = results.find((result) => result.issue?.identifier?.toUpperCase() === wanted);
    if (exact) return exact;
  }
  return results[0];
}

// Chats (decision 8). A chat is a hidden task, and search neither leaves chats out nor marks them,
// so a chat, its messages and its files come back as task-shaped results. The page recognises your
// own chats by their task ids (`GET /chats`) and draws them as chats, opening the chat itself.

/** The task a task-shaped result belongs to, to look up whether it's a chat. */
export function resultIssueId(result: CompanySearchResult): string | null {
  return result.issue?.id ?? result.artifact?.issueId ?? null;
}

/**
 * Where a result from one of your chats opens: the agent's chat, with the document open when the
 * result was found in one (`#document-<key>`, which the chat view reads; ChatDocuments.tsx). The
 * chat doesn't follow other fragments, such as `#comment-<id>`, so they're left off.
 */
export function chatResultHref(prefix: string, agentKey: string, result: CompanySearchResult) {
  const at = result.href.indexOf("#");
  const key = at === -1 ? null : documentKeyFromHash(result.href.slice(at));
  return `${chatPath(prefix, agentKey)}${key ? documentHash(key) : ""}`;
}

/** Where a chat result lives, in place of the task's project or identifier. */
export function chatWhere(kind: ResultKind, agentName: string) {
  switch (kind) {
    case "comment":
      return `Message in your chat with ${agentName}`;
    case "document":
      return `Document in your chat with ${agentName}`;
    case "file":
      return `File in your chat with ${agentName}`;
    default:
      return `Your chat with ${agentName}`;
  }
}
