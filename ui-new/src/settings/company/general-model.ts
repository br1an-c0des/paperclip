import type {
  Company,
  InteractionResolverGovernance,
  IssueThreadInteractionCanonicalResolverPolicy,
  IssueThreadInteractionResolverPolicy,
} from "@paperclipai/shared";
import type { CompanyPatch } from "@/api/companies";

/*
 * General (board 21): the organization's name, description and default owner, and the agent
 * requests table, which sets who may answer each kind of request (the company's
 * `interactionResolverGovernance`, ported from ui/src/components/InteractionGovernancePanel.tsx).
 *
 * The board draws one "Who can answer" per kind and says a task can tighten it, not loosen it:
 * that is the kind's cap. The old panel also sets a default audience for new requests, kept here as
 * a second choice in the same menu, so nothing the old page could set is lost.
 */

/** A text field's edit: the patch, or null when nothing changed. A blank name keeps the old one. */
export function nameEdit(company: Pick<Company, "name">, value: string): CompanyPatch | null {
  const name = value.trim();
  return name && name !== company.name ? { name } : null;
}

export function descriptionEdit(company: Pick<Company, "description">, value: string): CompanyPatch | null {
  const description = value.trim() || null;
  return description !== (company.description ?? null) ? { description } : null;
}

export type GovernanceKind = keyof InteractionResolverGovernance;

/** The kinds of agent request, in the board's order, with an example of each. */
export const REQUEST_KINDS: readonly { kind: GovernanceKind; label: string; example: string }[] = [
  { kind: "ask_user_questions", label: "Questions", example: "“Which exchanges should I backfill first?”" },
  { kind: "request_confirmation", label: "Confirmations", example: "“OK to merge the backtest refactor?”" },
  { kind: "request_checkbox_confirmation", label: "Checklists", example: "“Tick each step before the migration runs.”" },
  { kind: "request_item_verdicts", label: "Item reviews", example: "“Keep or drop each of these 12 signals.”" },
  { kind: "suggest_tasks", label: "Suggested tasks", example: "“Split the dashboard work into three tasks.”" },
];

export type Audience = IssueThreadInteractionCanonicalResolverPolicy;

/** Widest first: Anyone is the product default, so it's stored as no override. */
export const AUDIENCES: readonly { value: Audience; label: string; effect: string }[] = [
  { value: "anyone", label: "Anyone", effect: "People or any agent, including the one that asked." },
  { value: "not_creator", label: "Anyone except the asking agent", effect: "Someone other than the agent that asked." },
  { value: "human_only", label: "People only", effect: "A person in the organization. Agents are turned away." },
];

export function audienceLabel(value: Audience) {
  return AUDIENCES.find((entry) => entry.value === value)!.label;
}

/** A stored policy as one of the three audiences; the old `board_*` aliases map onto them. */
export function canonicalAudience(policy: IssueThreadInteractionResolverPolicy | undefined): Audience {
  if (!policy || policy === "board_or_agents") return "anyone";
  if (policy === "board_only") return "human_only";
  return policy;
}

/** Who may answer a kind (its cap), and what new requests ask for (its default). */
export function kindAudience(governance: InteractionResolverGovernance | null | undefined, kind: GovernanceKind) {
  const entry = governance?.[kind];
  return { cap: canonicalAudience(entry?.cap), start: canonicalAudience(entry?.defaultPolicy) };
}

/**
 * Sets a kind's cap or default, immutably, keeping the stored object sparse: "anyone" removes the
 * override, and a kind with neither is dropped.
 */
export function setKindAudience(
  governance: InteractionResolverGovernance | null | undefined,
  kind: GovernanceKind,
  field: "cap" | "defaultPolicy",
  value: Audience,
): InteractionResolverGovernance {
  const next: InteractionResolverGovernance = { ...(governance ?? {}) };
  const entry = { ...(next[kind] ?? {}) };
  if (value === "anyone") delete entry[field];
  else entry[field] = value;
  if (entry.cap === undefined && entry.defaultPolicy === undefined) delete next[kind];
  else next[kind] = entry;
  return next;
}

const NARROWNESS: Record<Audience, number> = { anyone: 0, not_creator: 1, human_only: 2 };

/** The default only matters when it's narrower than the cap; otherwise the cap wins. */
export function startsNarrower(audience: { cap: Audience; start: Audience }) {
  return NARROWNESS[audience.start] > NARROWNESS[audience.cap];
}
