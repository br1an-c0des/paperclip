import type {
  AttentionAlreadyClosedDetails,
  AttentionAudience,
  AttentionAudienceReason,
  AttentionCloseMode,
  AttentionItem,
  AttentionReceipt,
  AttentionReceiptOutcome,
} from "@paperclipai/shared";

/*
 * Personal request routing (upstream #20959, U133): who a request is *for*, apart from who may
 * answer it (the resolver policy, which the server checks on every answer).
 *
 * - Every card has an `audience`: a person (`user`), the claimable Unassigned pool (`pool`), or the
 *   company's operators (`company`; a budget stop with a budget owner is both theirs and the
 *   company's, `alsoInCompany`). The Inbox reads the whole feed and sorts it into views here with
 *   the server's own rule (`audienceMatchesView` in server/src/services/attention.ts), so one cache
 *   feeds every view and the nav, and a step taken here moves every count at once.
 * - Views: For you (the default), Unassigned, Company and Everyone (`view=all`, every card you can
 *   read). The server's Archived view (what you archived or snoozed, whatever its audience) is the
 *   Inbox's Snoozed and Archived tabs.
 * - Claim makes an ownerless card yours; Transfer routes one to another person. Both store an
 *   addressee, which only task-thread requests have (`ATTENTION_CLAIMABLE_SOURCE_KINDS`).
 * - The Close… menu offers the card's `closeModes`: withdraw (for everyone; the request ends, never
 *   as an approval), archive (hidden for you until it changes) and snooze (hidden for you until a
 *   time). Hiding sends the card's `changeFingerprint`.
 * - Receipts: what someone else did with a request that was yours, on top of For you for a week.
 * - A 409 with `code: attention_already_closed` means someone else answered or closed it first.
 */

export type InboxView = "mine" | "unassigned" | "company" | "all";

export const INBOX_VIEWS: readonly { view: InboxView; label: string }[] = [
  { view: "mine", label: "For you" },
  { view: "unassigned", label: "Unassigned" },
  { view: "company", label: "Company" },
  { view: "all", label: "Everyone" },
];

export const DEFAULT_VIEW: InboxView = "mine";

/** The view a `?view=` names; For you for anything else (the server's `archived` is a tab here). */
export function viewFromParam(value: string | string[] | null | undefined): InboxView {
  const raw = Array.isArray(value) ? value[0] : value;
  return INBOX_VIEWS.find((entry) => entry.view === raw)?.view ?? DEFAULT_VIEW;
}

/** Whether a card shows in a view, by the server's rule. */
export function inView(audience: AttentionAudience | null | undefined, view: InboxView, youId: string | null): boolean {
  if (view === "all") return true;
  if (!audience) return false;
  if (view === "mine") return audience.kind === "user" && !!audience.userId && audience.userId === youId;
  if (view === "unassigned") return audience.kind === "pool";
  return audience.kind === "company" || audience.alsoInCompany === true;
}

export function filterByView<T extends Pick<AttentionItem, "audience">>(items: readonly T[], view: InboxView, youId: string | null): T[] {
  return view === "all" ? [...items] : items.filter((item) => inView(item.audience, view, youId));
}

/** How many of the items each view holds. */
export function viewCounts(items: readonly Pick<AttentionItem, "audience">[], youId: string | null): Record<InboxView, number> {
  const counts: Record<InboxView, number> = { mine: 0, unassigned: 0, company: 0, all: items.length };
  for (const item of items) {
    if (inView(item.audience, "mine", youId)) counts.mine += 1;
    if (inView(item.audience, "unassigned", youId)) counts.unassigned += 1;
    if (inView(item.audience, "company", youId)) counts.company += 1;
  }
  return counts;
}

/** "3 requests have no owner": For you's note pointing at Unassigned. */
export function unassignedNote(count: number) {
  return count === 1 ? "1 request has no owner" : `${count} requests have no owner`;
}

// ---------------------------------------------------------------------------------------------
// Who it's for

/** Only task-thread requests have an addressee, so only they can be claimed or transferred. */
const ROUTABLE = new Set<AttentionItem["sourceKind"]>(["issue_thread_interaction"]);

export function canRoute(item: Pick<AttentionItem, "sourceKind">) {
  return ROUTABLE.has(item.sourceKind);
}

/** Claim stores you as the owner: an ownerless card (Unassigned, or Company after a week) that can hold one. */
export function claimable(item: Pick<AttentionItem, "sourceKind" | "audience">) {
  const audience = item.audience;
  if (!audience || audience.userId) return false;
  return (audience.kind === "pool" || audience.kind === "company") && canRoute(item);
}

const REASON_TEXT: Record<AttentionAudienceReason, string | null> = {
  addressee: "Sent to you",
  conversation: "You started this chat",
  reviewer: "You're the reviewer",
  assignee: "Assigned to you",
  instigator: "You created the original task",
  requester: "You asked for this",
  escalation_owner: "You're the company's decision owner",
  project_owner: "You own this project's decisions",
  budget_owner: "You're the budget owner",
  none: null,
};

/**
 * The card's "Owner" line, as state: whose it is and why, or that nobody owns it.
 * - `mine`: yours, with why ("Assigned to you", "Transferred by Sam").
 * - `other`: someone else's; acting on it acts for them.
 * - `pool`: no owner yet; `claimable` when Claim can store one, else `why` says what to do.
 * - `company`: an operator alert, nobody's by design (or an ownerless card a week old).
 */
export type OwnerLine =
  | { kind: "mine"; text: string }
  | { kind: "other"; userId: string; name: string; text: string }
  | { kind: "pool"; text: string; claimable: boolean; why: string | null }
  | { kind: "company"; text: string; claimable: boolean; why: string | null };

export function ownerLine(
  item: Pick<AttentionItem, "sourceKind" | "audience" | "stale" | "relatedIssue" | "subject">,
  youId: string | null,
  personName: (id: string) => string,
): OwnerLine | null {
  const audience = item.audience;
  if (!audience) return null;
  if (audience.kind === "user" && audience.userId) {
    if (audience.userId !== youId) return { kind: "other", userId: audience.userId, name: personName(audience.userId), text: `For ${personName(audience.userId)}` };
    if (audience.transferredByUserId) {
      const by = audience.transferredByUserId === youId ? "you" : personName(audience.transferredByUserId);
      return { kind: "mine", text: `Transferred to you by ${by}` };
    }
    return { kind: "mine", text: REASON_TEXT[audience.reason] ?? "For you" };
  }
  const canClaim = claimable(item);
  const hasTask = !!item.relatedIssue || item.subject.kind === "issue";
  // Claim can't store an owner on this kind; assigning its task does.
  const why = canClaim ? null : hasTask ? "Assign its task to give it an owner." : "It has no task to assign, so it can't be claimed.";
  if (audience.kind === "pool") return { kind: "pool", text: "No owner yet", claimable: canClaim, why };
  const unowned = item.stale?.reason === "unowned";
  return {
    kind: "company",
    text: unowned ? "No owner for 7+ days" : "For the company's operators",
    claimable: canClaim,
    why: unowned ? why : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The Close… menu

export type CloseMenu = { withdraw: boolean; archive: boolean; snooze: boolean; transfer: boolean };

/** What the card's Close… menu offers: its `closeModes`, and Transfer where it can hold an owner. */
export function closeMenu(item: Pick<AttentionItem, "sourceKind" | "closeModes">): CloseMenu {
  const modes: readonly AttentionCloseMode[] = item.closeModes ?? [];
  return { withdraw: modes.includes("withdraw"), archive: modes.includes("archive"), snooze: modes.includes("snooze"), transfer: canRoute(item) };
}

/**
 * What withdrawing says it does. It ends the request for everyone and tells whoever asked; it's
 * never an approval. Acting on someone else's card does it for them.
 */
export function withdrawPrompt(owner: OwnerLine | null) {
  const base = "The request ends for everyone and the agent is told. It isn't approved.";
  return owner?.kind === "other" ? `This is for ${owner.name}. ${base}` : base;
}

/** The 409 the close, claim and transfer endpoints (and approval cancel) send when someone else was first. */
export function alreadyClosed(error: unknown): AttentionAlreadyClosedDetails | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (!body || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  return (details as { code?: unknown }).code === "attention_already_closed" ? (details as AttentionAlreadyClosedDetails) : null;
}

/** "Already answered by Sam". */
export function alreadyClosedText(details: AttentionAlreadyClosedDetails, youId: string | null, personName: (id: string) => string) {
  if (details.resolvedByUserId) return `Already answered by ${details.resolvedByUserId === youId ? "you" : personName(details.resolvedByUserId)}`;
  return details.resolvedByAgentId ? "Already answered by an agent" : "Already answered";
}

/** An item as a claim or transfer leaves it, for the cached feed until the next feed lands. */
export function withOwner(item: AttentionItem, userId: string, transferredBy: string | null): AttentionItem {
  return { ...item, audience: { kind: "user", userId, reason: "addressee", ...(transferredBy ? { transferredByUserId: transferredBy } : {}) } };
}

// ---------------------------------------------------------------------------------------------
// Receipts

const OUTCOME_TEXT: Record<AttentionReceiptOutcome, string> = {
  answered: "Answered",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  revision_requested: "Revision requested",
  decided: "Decided",
  withdrawn: "Withdrawn",
  skipped: "Skipped",
  transferred: "Transferred",
  kept_paused: "Kept paused",
  limit_raised: "Limit raised",
};

export function outcomeText(outcome: AttentionReceiptOutcome) {
  return OUTCOME_TEXT[outcome] ?? "Handled";
}

/** "Answered by Sam", "Transferred to Riley by Sam": a receipt's first words. */
export function receiptLine(receipt: Pick<AttentionReceipt, "outcome" | "actorUserId" | "transferredToUserId">, personName: (id: string) => string) {
  const verb = outcomeText(receipt.outcome);
  if (receipt.outcome === "transferred" && receipt.transferredToUserId) return `${verb} to ${personName(receipt.transferredToUserId)} by ${personName(receipt.actorUserId)}`;
  return `${verb} by ${personName(receipt.actorUserId)}`;
}

/** The receipts still to show: not dismissed here, not expired. */
export function liveReceipts(receipts: readonly AttentionReceipt[] | undefined, dismissed: ReadonlySet<string>, now: Date = new Date()) {
  return (receipts ?? []).filter((receipt) => !dismissed.has(receipt.dismissalKey) && !(Date.parse(receipt.expiresAt) <= now.getTime()));
}
