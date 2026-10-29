import type { Agent, Issue, IssueAccessGrant, IssueAccessGrantSource } from "@paperclipai/shared";

/*
 * The share sheet's rules (`tasks/privacy`), after ui/src/components/IssueShareSheet.tsx and
 * ui/src/lib/issuePrivacy.ts: who can see a private task and why, who can be added, and which
 * access can be taken back here.
 */

/** Why a grant gives access, in the sheet's words. */
export const SOURCE_LABELS: Record<IssueAccessGrantSource, string> = {
  owner: "Task owner",
  explicit: "Shared directly",
  assignment: "Through assignment",
  project: "Through the project",
};

/** The grants still in force. */
export function activeGrants(grants: readonly IssueAccessGrant[]) {
  return grants.filter((grant) => grant.revokedAt === null);
}

/**
 * Whether the sheet can take this access back: a grant made here or through assignment. Project
 * access is managed on the project, and inherited access where it comes from.
 */
export function canRevoke(grant: IssueAccessGrant) {
  return !grant.inherited && (grant.source === "explicit" || grant.source === "assignment");
}

/** People and agents who already hold their own grant, keyed `user:<id>` or `agent:<id>`, so they're not offered again. */
export function grantedKeys(grants: readonly IssueAccessGrant[]) {
  return new Set(activeGrants(grants).filter((grant) => !grant.inherited && grant.source !== "project").map((grant) => `${grant.subjectType}:${grant.subjectId}`));
}

/** Who can see the task because of their role, not a grant: its owner and its assignee. */
export type RoleRow = { key: string; kind: "user" | "agent"; id: string; role: string };

export function roleRows(task: Pick<Issue, "responsibleUserId" | "assigneeAgentId" | "assigneeUserId">): RoleRow[] {
  const rows: RoleRow[] = [];
  const add = (kind: "user" | "agent", id: string | null, role: string) => {
    if (id && !rows.some((row) => row.key === `${kind}:${id}`)) rows.push({ key: `${kind}:${id}`, kind, id, role });
  };
  add("user", task.responsibleUserId, "Owner");
  add("agent", task.assigneeAgentId, "Assignee");
  add("user", task.assigneeUserId, "Assignee");
  return rows;
}

/**
 * An agent other people also use (its visibility isn't "private"). Its memory and workspace can
 * carry what it saw here into later runs for others, so the sheet warns before sharing with it.
 */
export function isSharedAgent(agent: Pick<Agent, "permissions">) {
  const permissions = agent.permissions as unknown;
  if (!permissions || typeof permissions !== "object") return true;
  const policy = (permissions as Record<string, unknown>).authorizationPolicy;
  if (!policy || typeof policy !== "object") return true;
  const visibility = (policy as Record<string, unknown>).agentVisibility;
  if (!visibility || typeof visibility !== "object") return true;
  return (visibility as Record<string, unknown>).mode !== "private";
}
