import type { ExternalObject, ExternalObjectMention, ExternalObjectMentionGroup, ExternalObjectSummary } from "@paperclipai/shared";

/*
 * External objects (`tasks/external-objects`, shown only while `enableExternalObjects` is on):
 * pull requests, tickets and other things outside Paperclip a task mentions, with their live status
 * from the plugin that tracks them. After ui/src/lib/external-objects.ts,
 * ui/src/hooks/useIssueExternalObjects.ts and the list's filter in ui/src/lib/issue-filters.ts.
 */

const CATEGORY_LABELS: Record<string, string> = {
  unknown: "Not yet resolved",
  open: "Open",
  waiting: "Waiting",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  blocked: "Blocked",
  closed: "Closed",
  archived: "Archived",
  auth_required: "Needs sign-in",
  rate_limited: "Rate limited",
  unreachable: "Unreachable",
};

const LIVENESS_LABELS: Record<string, string> = {
  unknown: "Not yet refreshed",
  fresh: "Fresh",
  stale: "Stale",
  auth_required: "Needs sign-in",
  rate_limited: "Rate limited",
  unreachable: "Unreachable",
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  github_pull_request: "GitHub",
  github_issue: "GitHub",
  hubspot: "HubSpot",
  linear: "Linear",
  jira: "Jira",
  notion: "Notion",
  asana: "Asana",
};

const TYPE_LABELS: Record<string, string> = { pull_request: "pull request", workflow_run: "workflow run" };

/** Higher needs more attention: danger first, muted last. */
const TONE_SEVERITY: Record<string, number> = { muted: 0, neutral: 1, success: 2, info: 3, warning: 4, danger: 5 };

export function providerLabel(providerKey: string | null | undefined) {
  if (!providerKey) return "External";
  return (
    PROVIDER_LABELS[providerKey] ??
    providerKey
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function typeLabel(objectType: string | null | undefined) {
  if (!objectType) return "object";
  return TYPE_LABELS[objectType] ?? objectType.replace(/_/g, " ");
}

/** The object's status in words: the provider's own label, or its category and freshness. */
export function statusLabel(object: Pick<ExternalObject, "providerKey" | "objectType" | "statusCategory" | "liveness" | "statusLabel">) {
  const own = object.statusLabel?.trim();
  if (own) return own;
  const genericUrl = object.providerKey === "url" && object.objectType === "link";
  if (object.statusCategory === "unknown" && object.providerKey && object.objectType && !genericUrl) {
    return object.liveness === "fresh" ? "Status unavailable" : (LIVENESS_LABELS[object.liveness] ?? object.liveness.replace(/_/g, " "));
  }
  return CATEGORY_LABELS[object.statusCategory] ?? object.statusCategory.replace(/_/g, " ");
}

/** A short name: the provider's key for it ("PR #12", "ENG-4"), else "GitHub pull request". */
export function objectName(object: Pick<ExternalObject, "providerKey" | "objectType" | "displayKey" | "sanitizedCanonicalUrl">) {
  const key = object.displayKey?.trim();
  if (key) return key;
  if (object.providerKey === "github" && object.sanitizedCanonicalUrl) {
    try {
      const [, , , kind, number] = new URL(object.sanitizedCanonicalUrl).pathname.split("/");
      if (number && kind === "pull") return `PR #${number}`;
      if (number && kind === "issues") return `Issue #${number}`;
    } catch {
      // Not a URL; fall through.
    }
  }
  if (object.providerKey === "url" && object.objectType === "link") return "Link";
  return `${providerLabel(object.providerKey)} ${typeLabel(object.objectType)}`;
}

/** The design system's tone for an object's status. */
export function statusTone(object: Pick<ExternalObject, "statusCategory" | "statusTone" | "statusLabel" | "statusIconKey">) {
  if (object.statusIconKey === "git-merge" || object.statusLabel?.trim().toLowerCase() === "merged") return "violet";
  switch (object.statusTone) {
    case "danger":
      return "red";
    case "warning":
      return "amber";
    case "success":
      return "green";
    case "info":
      return "run";
    default:
      return "neutral";
  }
}

function sourceLabel(mention: ExternalObjectMention) {
  switch (mention.sourceKind) {
    case "title":
      return "Title";
    case "description":
      return "Description";
    case "comment":
      return "Comment";
    case "document":
      return mention.documentKey ? `Document ${mention.documentKey}` : "Document";
    case "property":
      return mention.propertyKey ? `Property ${mention.propertyKey}` : "Property";
    case "plugin":
      return "Plugin";
    default:
      return "Source";
  }
}

export type ExternalObjectRow = { object: ExternalObject; mentions: number; sources: string[] };

/** The objects a task mentions, most attention-worthy first; mentions nothing resolved are left out. */
export function externalObjectRows(groups: readonly ExternalObjectMentionGroup[]): ExternalObjectRow[] {
  return groups
    .filter((group): group is ExternalObjectMentionGroup & { object: ExternalObject } => group.object !== null)
    .map((group) => ({
      object: group.object,
      mentions: group.mentionCount ?? group.mentions.length,
      sources: group.sourceLabels?.length ? group.sourceLabels : [...new Set(group.mentions.map(sourceLabel))],
    }))
    .sort((a, b) => (TONE_SEVERITY[b.object.statusTone] ?? 0) - (TONE_SEVERITY[a.object.statusTone] ?? 0));
}

// --- The list's filter ----------------------------------------------------------------------------

/** The task list's external-object filter, in the old list's order. */
export const EXTERNAL_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "failed", label: "Any failed" },
  { value: "waiting", label: "Any waiting" },
  { value: "running", label: "Any running" },
  { value: "auth_required", label: "Needs sign-in" },
  { value: "rate_limited", label: "Rate limited" },
  { value: "unreachable", label: "Unreachable" },
  { value: "stale", label: "Stale" },
  { value: "none", label: "No external objects" },
];

function count(record: Record<string, number> | undefined, key: string) {
  return record?.[key] ?? 0;
}

/** Whether a task's summary matches one filter value (ui/src/lib/issue-filters.ts). */
export function matchesExternalStatus(summary: ExternalObjectSummary | null | undefined, value: string) {
  switch (value) {
    case "failed":
      return count(summary?.byStatusCategory, "failed") > 0 || count(summary?.byStatusCategory, "blocked") > 0;
    case "waiting":
    case "running":
      return count(summary?.byStatusCategory, value) > 0;
    case "auth_required":
      return (summary?.authRequiredCount ?? 0) > 0 || count(summary?.byLiveness, "auth_required") > 0;
    case "rate_limited":
      return count(summary?.byLiveness, "rate_limited") > 0;
    case "unreachable":
      return (summary?.unreachableCount ?? 0) > 0 || count(summary?.byLiveness, "unreachable") > 0;
    case "stale":
      return (summary?.staleCount ?? 0) > 0 || count(summary?.byLiveness, "stale") > 0;
    case "none":
      return (summary?.total ?? 0) === 0;
    default:
      return false;
  }
}
