import type { CompanyArtifact, CompanyArtifactGroup, IssueStatus } from "@paperclipai/shared";

/*
 * The project Docs tab's "From tasks" section (board 9): every task's documents, attachments and
 * outputs, grouped by task, with a type filter and closed tasks shown or hidden.
 *
 * The artifacts endpoint grouped by task returns each group with up to three previews; a group with
 * more is loaded in full on its own (`groupIssueId`). Groups don't say what state their task is in,
 * so the project's task list supplies it. The type filter maps onto the artifact's source:
 * documents, attachments, and outputs (the `artifact` work products agents publish).
 */

export type DocKind = "doc" | "att" | "out";
export type DocFilter = "all" | DocKind;

export const DOC_FILTERS: { value: DocFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "doc", label: "Documents" },
  { value: "att", label: "Attachments" },
  { value: "out", label: "Outputs" },
];

export function docKind(artifact: Pick<CompanyArtifact, "source">): DocKind {
  if (artifact.source === "document") return "doc";
  if (artifact.source === "attachment") return "att";
  return "out";
}

const CLOSED: ReadonlySet<string> = new Set(["done", "cancelled"]);

/** A document's key, from its link (`…/issues/TES-4#document-plan`). */
export function documentKey(artifact: Pick<CompanyArtifact, "source" | "href">) {
  if (artifact.source !== "document") return null;
  const match = /#document-(.+)$/.exec(artifact.href);
  return match ? decodeURIComponent(match[1]!) : null;
}

const TYPE_BY_TAG: Record<string, string> = {
  MD: "Document",
  PNG: "Image",
  JPG: "Image",
  GIF: "Image",
  WEBP: "Image",
  SVG: "Image",
  CSV: "Spreadsheet",
  XLSX: "Spreadsheet",
  PDF: "PDF",
  LOG: "Log",
  TXT: "Text",
  JSON: "Data",
  HTML: "Page",
  MP4: "Video",
  ZIP: "Archive",
};

/** The short tag a file tile shows: MD for documents, else the extension, else the media type's. */
export function fileTag(artifact: Pick<CompanyArtifact, "source" | "title" | "contentType" | "mediaKind">) {
  if (artifact.source === "document") return "MD";
  const extension = /\.([a-z0-9]{1,5})$/i.exec(artifact.title)?.[1];
  if (extension) return extension.toUpperCase();
  const subtype = artifact.contentType?.split(";")[0]?.split("/")[1];
  if (subtype && /^[a-z0-9.+-]{1,12}$/i.test(subtype)) return (subtype === "markdown" ? "MD" : subtype.split(/[.+-]/).pop()!).toUpperCase();
  return artifact.mediaKind === "empty" ? "LINK" : "FILE";
}

/** "Document", "Image", "PDF"…, for the tile's meta line. */
export function fileType(artifact: Pick<CompanyArtifact, "source" | "title" | "contentType" | "mediaKind">) {
  if (artifact.source === "work_product") return "Output";
  const tag = fileTag(artifact);
  return TYPE_BY_TAG[tag] ?? (artifact.mediaKind === "image" ? "Image" : artifact.mediaKind === "video" ? "Video" : "File");
}

export type TaskFacts = { status: IssueStatus; assigneeAgentId: string | null; assigneeUserId: string | null };

export type DocGroup = {
  issueId: string;
  identifier: string;
  title: string;
  /** The task's status, from the project's task list; null when the list doesn't have it. */
  status: IssueStatus | null;
  assigneeAgentId: string | null;
  closed: boolean;
  /** The group's artifacts that pass the filter: all of them once loaded, else the previews. */
  items: CompanyArtifact[];
  /** Whether `items` is the whole group, or previews while the rest loads. */
  complete: boolean;
  /** How many the group holds: the filtered count once complete, the server's count before. */
  count: number;
};

export type DocGroupsView = {
  groups: DocGroup[];
  /** Items per filter, across the tasks shown. */
  counts: Record<DocFilter, number>;
  itemCount: number;
};

export function docGroups(input: {
  groups: readonly CompanyArtifactGroup[];
  /** Full artifact lists for groups loaded on their own, by task id. */
  full: ReadonlyMap<string, readonly CompanyArtifact[]>;
  tasks: ReadonlyMap<string, TaskFacts>;
  showClosed: boolean;
  filter: DocFilter;
  /** Matches titles and task names, word by word. */
  search?: string;
}): DocGroupsView {
  const terms = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (artifact: CompanyArtifact, group: CompanyArtifactGroup) => {
    const haystack = `${artifact.title} ${group.issue.identifier} ${group.issue.title}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
  const counts: Record<DocFilter, number> = { all: 0, doc: 0, att: 0, out: 0 };
  const groups: DocGroup[] = [];
  for (const group of input.groups) {
    const facts = input.tasks.get(group.issue.id);
    const closed = facts ? CLOSED.has(facts.status) : false;
    if (closed && !input.showClosed) continue;
    const loaded = input.full.get(group.issue.id);
    const complete = Boolean(loaded) || group.previewArtifacts.length >= group.count;
    const all = (loaded ?? group.previewArtifacts).filter((artifact) => matches(artifact, group));
    for (const artifact of all) {
      counts.all += 1;
      counts[docKind(artifact)] += 1;
    }
    const items = input.filter === "all" ? all : all.filter((artifact) => docKind(artifact) === input.filter);
    if (complete && items.length === 0) continue;
    if (!complete && items.length === 0 && (input.filter !== "all" || terms.length > 0)) continue;
    groups.push({
      issueId: group.issue.id,
      identifier: group.issue.identifier,
      title: group.issue.title,
      status: facts?.status ?? null,
      assigneeAgentId: facts?.assigneeAgentId ?? null,
      closed,
      items,
      complete,
      count: complete || input.filter !== "all" || terms.length > 0 ? items.length : group.count,
    });
  }
  return { groups, counts, itemCount: groups.reduce((sum, group) => sum + group.count, 0) };
}

/** Groups that hold more than their previews, so they load in full. */
export function incompleteGroups(groups: readonly CompanyArtifactGroup[]) {
  return groups.filter((group) => group.previewArtifacts.length < group.count).map((group) => group.issue.id);
}

/** "3 items in 2 tasks". */
export function docSummary(view: Pick<DocGroupsView, "groups" | "itemCount">) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(view.itemCount, "item")} in ${plural(view.groups.length, "task")}`;
}
