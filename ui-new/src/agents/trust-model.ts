import type { AgentPermissions, LowTrustBoundary, TrustAuthorizationPolicy, TrustPreset } from "@paperclipai/shared";
import type { AgentPermissionUpdate } from "@/api/agents";

/*
 * An agent's trust preset and its low-trust boundary, ported from the old UI's
 * ui/src/lib/trust-policy-ui.ts. The constants mirror packages/shared/src/trust-policy.ts (ui-new
 * imports the shared package with `import type` only); check them at each upstream sync.
 *
 * Standard trust works across the company within its permissions. Low-trust review contains an
 * agent meant for hostile input (pull request review, outside content): it reads and changes only
 * the work inside its boundary, and its raw output is quarantined until a trusted reviewer promotes
 * it. This editor sets one boundary target (a project, a root task or one task), as upstream's
 * community edition does; boundaries with more targets come from the API or the EE extension and
 * are shown read-only, except that the project access list adds projects.
 */

const STANDARD = "standard" as const;
const LOW_TRUST = "low_trust_review" as const;
const LOW_TRUST_VERSION = 1 as const;
const QUARANTINE = "quarantine" as const;

export type BoundaryTarget = { type: "project" | "root_issue" | "issue"; id: string };

export const TRUST_PRESETS: { value: TrustPreset; label: string; description: string }[] = [
  { value: STANDARD, label: "Standard", description: "Works across the organization within its permissions. The default for normal work." },
  {
    value: LOW_TRUST,
    label: "Low trust, with review",
    description: "Contained for untrusted input such as pull request review: a narrow Paperclip API, and output quarantined until someone trusted promotes it.",
  },
];

export const BOUNDARY_TYPES: { value: BoundaryTarget["type"]; label: string; description: string }[] = [
  { value: "project", label: "A project", description: "Its tasks and repositories" },
  { value: "root_issue", label: "A task and its subtasks", description: "Everything under one task" },
  { value: "issue", label: "One task", description: "Only that task" },
];

export function trustPreset(permissions: Partial<AgentPermissions> | null | undefined): TrustPreset {
  return permissions?.trustPreset === LOW_TRUST ? LOW_TRUST : STANDARD;
}

export function lowTrustBoundary(permissions: Partial<AgentPermissions> | null | undefined): LowTrustBoundary | null {
  const boundary = permissions?.authorizationPolicy?.trustBoundary;
  return boundary?.mode === LOW_TRUST ? boundary : null;
}

function targetCount(boundary: LowTrustBoundary | null | undefined) {
  return (boundary?.projectIds?.length ?? 0) + (boundary?.rootIssueId ? 1 : 0) + (boundary?.issueIds?.length ?? 0);
}

/** True when the boundary names anything; a low-trust agent without one is denied everything. */
export function boundaryHasScope(boundary: LowTrustBoundary | null | undefined) {
  return targetCount(boundary) > 0;
}

/** The boundary's one target, when it has exactly one. */
export function boundaryTarget(boundary: LowTrustBoundary | null | undefined): BoundaryTarget | null {
  if (!boundary || targetCount(boundary) !== 1) return null;
  if (boundary.projectIds?.[0]) return { type: "project", id: boundary.projectIds[0] };
  if (boundary.rootIssueId) return { type: "root_issue", id: boundary.rootIssueId };
  if (boundary.issueIds?.[0]) return { type: "issue", id: boundary.issueIds[0] };
  return null;
}

/** Whether this single-target editor can change the boundary (more targets came from elsewhere). */
export function boundaryEditable(boundary: LowTrustBoundary | null | undefined) {
  return targetCount(boundary) <= 1;
}

function reviewPolicy(existing: TrustAuthorizationPolicy | null | undefined): TrustAuthorizationPolicy {
  return {
    ...(existing ?? {}),
    trustPreset: LOW_TRUST,
    reviewPreset: { id: LOW_TRUST, version: LOW_TRUST_VERSION, rawOutputDisposition: QUARANTINE },
  };
}

/**
 * The permissions with a preset applied (`buildPermissionsForTrustPreset`). Going to low trust drops
 * hiring authority (it's on by default for standard agents); going back to standard sends an
 * explicit policy without the trust keys, since the endpoint merges and an omitted policy would
 * keep the old boundary.
 */
export function withPreset(permissions: Partial<AgentPermissions> | null | undefined, preset: TrustPreset): Partial<AgentPermissions> {
  const current = permissions ?? {};
  if (preset === LOW_TRUST) {
    return { ...current, canCreateAgents: false, trustPreset: LOW_TRUST, authorizationPolicy: reviewPolicy(current.authorizationPolicy) };
  }
  const policy = { ...(current.authorizationPolicy ?? {}) } as TrustAuthorizationPolicy;
  delete policy.trustPreset;
  delete policy.reviewPreset;
  delete policy.trustBoundary;
  return { ...current, trustPreset: STANDARD, authorizationPolicy: policy };
}

/** The permissions with the boundary set to one target, in this company. */
export function withBoundaryTarget(permissions: Partial<AgentPermissions> | null | undefined, companyId: string, target: BoundaryTarget): Partial<AgentPermissions> {
  const current = withPreset(permissions, LOW_TRUST);
  const policy = current.authorizationPolicy ?? {};
  const { projectIds: _projects, rootIssueId: _root, issueIds: _issues, ...rest } = policy.trustBoundary ?? { mode: LOW_TRUST };
  const trustBoundary: LowTrustBoundary = {
    ...rest,
    mode: LOW_TRUST,
    companyId,
    ...(target.type === "project" ? { projectIds: [target.id] } : {}),
    ...(target.type === "root_issue" ? { rootIssueId: target.id } : {}),
    ...(target.type === "issue" ? { issueIds: [target.id] } : {}),
  };
  return { ...current, authorizationPolicy: { ...reviewPolicy(policy), trustBoundary } };
}

/** The permissions with the boundary's target cleared, keeping its other limits. */
export function withoutBoundaryTarget(permissions: Partial<AgentPermissions> | null | undefined): Partial<AgentPermissions> {
  const current = withPreset(permissions, LOW_TRUST);
  const policy = current.authorizationPolicy ?? {};
  if (!policy.trustBoundary) return current;
  const { projectIds: _projects, rootIssueId: _root, issueIds: _issues, ...rest } = policy.trustBoundary;
  return { ...current, authorizationPolicy: { ...policy, trustBoundary: { ...rest, mode: LOW_TRUST } } };
}

/**
 * The `PATCH /agents/:id/permissions` body for new trust settings: the three switches as they are,
 * then the preset, its policy and (from the preset) hiring authority, as the old page sends it.
 */
export function trustUpdate(switches: AgentPermissionUpdate, next: Partial<AgentPermissions>): AgentPermissionUpdate {
  return {
    ...switches,
    canCreateAgents: next.canCreateAgents ?? switches.canCreateAgents,
    trustPreset: next.trustPreset === LOW_TRUST ? LOW_TRUST : STANDARD,
    authorizationPolicy: next.authorizationPolicy,
  };
}

/** The policy's limits in words, for "View policy". */
export function policyRows(permissions: Partial<AgentPermissions> | null | undefined, name: (target: BoundaryTarget) => string) {
  const boundary = lowTrustBoundary(permissions);
  const count = (list: readonly unknown[] | undefined, one: string, many: string) => (list?.length ? `${list.length} ${list.length === 1 ? one : many}` : "None");
  const policy = permissions?.authorizationPolicy ?? {};
  const custom = Object.keys(policy).some((key) => !["trustPreset", "reviewPreset", "trustBoundary"].includes(key));
  return [
    { label: "Preset", value: "Low-trust review, version 1" },
    { label: "Raw output", value: "Quarantined from agents with more trust" },
    {
      label: "Projects",
      value: boundary?.projectIds?.length ? boundary.projectIds.map((id) => name({ type: "project", id })).join(", ") : "None",
    },
    { label: "Task and subtasks", value: boundary?.rootIssueId ? name({ type: "root_issue", id: boundary.rootIssueId }) : "None" },
    { label: "Single tasks", value: count(boundary?.issueIds, "task", "tasks") },
    { label: "Agents it may reach", value: count(boundary?.allowedAgentIds, "agent", "agents") },
    { label: "Tools", value: boundary?.allowedToolClasses?.join(", ") || "None" },
    { label: "Secrets", value: count(boundary?.allowedSecretBindingIds, "binding", "bindings") },
    { label: "Promotes output to", value: boundary?.outputPromotionTarget?.issueId ? name({ type: "issue", id: boundary.outputPromotionTarget.issueId }) : "Not set" },
    { label: "Other policy fields", value: custom ? "Kept as they are" : "None" },
  ];
}
