import type { BudgetPolicyUpsertInput, Issue } from "@paperclipai/shared";
import { reply, type MockApi } from "./mock-api";
import * as world from "./world";

/*
 * The default answers for every request the smoke journeys make. Reads come from world.ts; writes
 * answer the way the server would (the updated record, a new id), so the UI moves on as it would
 * after a real save. Tests override any of these with `api.get(...)` / `api.post(...)`.
 *
 * Grouped by API area (ui-new/src/api/*). Missing one? The failing test names the request.
 */

/** A transparent 1×1 PNG, for avatars and logos. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export type MockOptions = {
  /** `authenticated` (default): sign-in, session, board access. `local_trusted`: no sign-in. */
  deploymentMode?: "authenticated" | "local_trusted";
  /** Start signed out (authenticated mode only); signing in through `/auth` signs you in. */
  signedOut?: boolean;
};

/** The records the default handlers serve and change: a fresh copy of world.ts per test. */
export type MockDb = ReturnType<typeof createDb>;

function createDb() {
  return {
    issues: structuredClone(world.ISSUES),
    comments: structuredClone(world.COMMENTS),
    interactions: structuredClone(world.INTERACTIONS),
    attention: structuredClone(world.ATTENTION),
    budgetPolicies: [world.budgetPolicy()],
  };
}

let nextId = 100;
const newId = (kind: string) => `${kind}-m7-new-${nextId++}`;

export function installDefaultHandlers(api: MockApi, options: MockOptions = {}): MockDb {
  const deploymentMode = options.deploymentMode ?? "authenticated";
  let signedIn = !options.signedOut;
  const db = createDb();
  const findIssue = (ref: string) => db.issues.find((i) => i.id === ref || i.identifier?.toLowerCase() === ref.toLowerCase());
  const issueOr404 = (ref: string) => findIssue(ref) ?? reply(404, { error: "Issue not found" });

  // Health and session -------------------------------------------------------------------------
  api.get("/health", () => ({
    status: "ok",
    version: "0.0.0-e2e",
    commit: null,
    deploymentMode,
    deploymentExposure: "private",
    authReady: true,
    bootstrapStatus: "ready",
    bootstrapInviteActive: false,
  }));
  api.get("/auth/get-session", () => (signedIn ? world.SESSION : reply(401, null)));
  api.post("/auth/sign-in/email", () => {
    signedIn = true;
    return { redirect: false, token: "e2e", user: world.USER };
  });
  api.post("/auth/sign-out", () => {
    signedIn = false;
    return { success: true };
  });
  api.get("/cli-auth/me", () => ({
    user: world.USER,
    userId: world.USER.id,
    isInstanceAdmin: true,
    companyIds: world.COMPANIES.map((c) => c.id),
    source: "session",
  }));

  // Companies ----------------------------------------------------------------------------------
  api.get("/companies", () => world.COMPANIES);
  api.get("/companies/stats", () =>
    Object.fromEntries(world.COMPANIES.map((c) => [c.id, { agentCount: c.id === world.COMPANY_ID ? world.AGENTS.length : 0, issueCount: c.id === world.COMPANY_ID ? world.ISSUES.length : 0 }])),
  );
  api.get("/companies/:companyId", ({ params }) => world.COMPANIES.find((c) => c.id === params.companyId) ?? reply(404, { error: "Company not found" }));

  api.get("/companies/:companyId/dashboard", ({ params }) => ({
    companyId: params.companyId,
    agents: { active: 0, running: 0, paused: world.AGENTS.length, error: 0 },
    tasks: { open: 3, inProgress: 1, blocked: 0, done: 1 },
    costs: { monthSpendCents: 1_250, monthBudgetCents: 50_000, monthUtilizationPercent: 2.5 },
    pendingApprovals: 0,
    budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
    runActivity: [],
  }));
  api.get("/companies/:companyId/org", () => [
    {
      id: world.CEO_ID,
      name: "M7 test Chief",
      role: "ceo",
      status: "paused",
      reports: [{ id: world.AGENT_ID, name: "M7 test Builder", role: "engineer", status: "paused", reports: [] }],
    },
  ]);
  api.get("/companies/:companyId/activity", () => [
    {
      id: "activity-m7-1",
      companyId: world.COMPANY_ID,
      actorType: "user",
      actorId: world.USER.id,
      actorName: world.USER.name,
      action: "issue.created",
      entityType: "issue",
      entityId: world.ISSUE_ID,
      agentId: null,
      runId: null,
      details: { identifier: `${world.PREFIX}-1`, title: world.ISSUES[0]!.title },
      createdAt: "2026-11-15T15:30:00.000Z",
    },
  ]);
  api.get("/companies/:companyId/user-directory", () => ({
    users: [{ principalId: world.USER.id, status: "active", membershipRole: "owner", user: world.USER }],
  }));
  api.get("/companies/:companyId/budgets/overview", ({ params }) => ({
    companyId: params.companyId,
    policies: db.budgetPolicies.filter((p) => p.companyId === params.companyId),
    activeIncidents: [],
    pausedAgentCount: 0,
    pausedProjectCount: 0,
    pendingApprovalCount: 0,
  }));
  api.post("/companies/:companyId/budgets/policies", ({ params, body }) => {
    const input = body as BudgetPolicyUpsertInput;
    const existing = db.budgetPolicies.find((p) => p.scopeType === input.scopeType && p.scopeId === input.scopeId && p.windowKind === input.windowKind);
    const amount = input.amount ?? existing?.amount ?? 0;
    const policy = world.budgetPolicy({
      ...existing,
      companyId: params.companyId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      windowKind: input.windowKind ?? "calendar_month_utc",
      amount,
      remainingAmount: Math.max(amount - (existing?.observedAmount ?? 0), 0),
      warnPercent: input.warnPercent ?? existing?.warnPercent ?? 80,
      hardStopEnabled: input.hardStopEnabled ?? existing?.hardStopEnabled ?? true,
    });
    db.budgetPolicies = [...db.budgetPolicies.filter((p) => p !== existing), policy];
    return policy;
  });
  api.get("/companies/:companyId/costs/by-project", () => []);

  // Your preferences --------------------------------------------------------------------------
  api.get("/workspace-preferences/me", () => ({ userId: world.USER.id, coordinatorWorkspaceEnabled: false, timeZone: "UTC", updatedAt: null }));
  api.get("/sidebar-preferences/me", () => ({ orderedIds: [], updatedAt: null }));
  api.get("/companies/:companyId/sidebar-preferences/me", () => ({ orderedIds: [], updatedAt: null }));
  api.get("/companies/:companyId/resource-memberships/me", () => ({
    projectMemberships: {},
    agentMemberships: {},
    starredProjectIds: [],
    starredAgentIds: [],
    starredDocumentIds: [],
    projectStarredAt: {},
    agentStarredAt: {},
    documentStarredAt: {},
    updatedAt: null,
  }));
  api.get("/companies/:companyId/primary-agent/me", ({ params }) => ({ companyId: params.companyId, userId: world.USER.id, primaryAgentId: world.CEO_ID, initialized: true }));
  api.get("/announcements/current", () => null);

  // Instance and plugins ----------------------------------------------------------------------
  api.get("/instance/settings/experimental", () => ({}));
  api.get("/instance/settings/worktree-cleanup", () => ({
    saved: null,
    mode: "off",
    source: "environment",
    dryRun: false,
    restorePoints: { available: true, reason: null },
    days: { strictDelay: 1, restorePointDelay: 3, idle: 7, retention: 90 },
  }));
  api.get("/instance/settings/general", () => ({
    censorUsernameInLogs: false,
    feedbackDataSharingPreference: "prompt",
    backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
  }));
  api.get("/plugins/ui-contributions", () => []);

  // Agents and runs ---------------------------------------------------------------------------
  api.get("/agent-avatars/*", () => reply(200, PIXEL, "image/png"));
  api.get("/agents/:agentId/runtime-state", () => null);
  api.get("/agents/:agentId", ({ params }) => {
    const found = world.AGENTS.find((a) => a.id === params.agentId || a.urlKey === params.agentId);
    if (!found) return reply(404, { error: "Agent not found" });
    return { ...found, chainOfCommand: [], access: { membership: null, grants: [] } };
  });
  api.get("/companies/:companyId/adapters/:adapterType/models", () => [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
  ]);
  api.get("/companies/:companyId/agents", ({ params }) => (params.companyId === world.COMPANY_ID ? world.AGENTS : []));
  api.get("/companies/:companyId/live-runs", () => []);
  api.get("/companies/:companyId/heartbeat-runs", () => [
    {
      id: world.RUN_ID,
      agentId: world.AGENT_ID,
      status: "succeeded",
      invocationSource: "assignment",
      issueId: world.ISSUE_ID,
      startedAt: "2026-11-15T15:30:00.000Z",
      finishedAt: "2026-11-15T15:34:00.000Z",
      createdAt: "2026-11-15T15:30:00.000Z",
      error: null,
    },
  ]);
  // The run modal
  api.get("/heartbeat-runs/:runId", ({ params }) =>
    params.runId === world.RUN_ID
      ? { ...world.run(), startedAt: "2026-11-15T15:30:00.000Z", finishedAt: "2026-11-15T15:34:00.000Z", createdAt: "2026-11-15T15:30:00.000Z", updatedAt: "2026-11-15T15:34:00.000Z", lastOutputAt: "2026-11-15T15:34:00.000Z", runtimeMode: "legacy" }
      : reply(404, { error: "Run not found" }),
  );
  api.get("/heartbeat-runs/:runId/events", ({ params, query }) =>
    Number(query.get("afterSeq") ?? 0) > 0
      ? []
      : [
          {
            id: 1,
            companyId: world.COMPANY_ID,
            runId: params.runId,
            agentId: world.AGENT_ID,
            seq: 1,
            eventType: "assistant.message",
            stream: "stdout",
            level: "info",
            color: null,
            message: "M7 test Wrote the landing page draft.",
            payload: null,
            createdAt: "2026-11-15T15:33:00.000Z",
          },
        ],
  );
  api.get("/heartbeat-runs/:runId/workspace-operations", () => []);
  api.get("/heartbeat-runs/:runId/log", ({ params }) => ({
    runId: params.runId,
    store: "local_file",
    logRef: `${params.runId}.ndjson`,
    content: `${JSON.stringify({ ts: "2026-11-15T15:33:00.000Z", stream: "stdout", chunk: "M7 test Wrote the landing page draft.\n", seq: 1 })}\n`,
  }));
  api.get("/companies/:companyId/provider-traces", () => []);
  api.get("/companies/:companyId/tools/runs/:runId/decisions", ({ params }) => ({ runId: params.runId, decisions: [] }));
  api.get("/companies/:companyId/chats", () => db.issues.filter((i) => i.conversationAgentId));
  api.get("/companies/:companyId/chats/:agentRef", ({ params }) => {
    const found = world.AGENTS.find((a) => a.id === params.agentRef || a.urlKey === params.agentRef);
    return db.issues.find((i) => found && i.conversationAgentId === found.id) ?? null;
  });

  // Projects ----------------------------------------------------------------------------------
  api.get("/companies/:companyId/projects", ({ params }) => (params.companyId === world.COMPANY_ID ? world.PROJECTS : []));
  api.get("/companies/:companyId/workspace-overview", () => ({ items: [], total: 0, limit: 50, offset: 0, hasMore: false, nextOffset: null }));
  api.get("/companies/:companyId/artifacts", ({ query }) => {
    const artifacts = world.ARTIFACTS.filter((a) => !query.get("projectId") || a.project?.id === query.get("projectId"));
    if (query.get("groupBy") !== "task") return { artifacts, nextCursor: null };
    const groups = [...new Set(artifacts.map((a) => a.issue.id))].map((issueId) => {
      const inGroup = artifacts.filter((a) => a.issue.id === issueId);
      return {
        id: `task:${issueId}`,
        groupBy: "task",
        issue: inGroup[0]!.issue,
        title: inGroup[0]!.issue.title,
        count: inGroup.length,
        mediaKinds: [...new Set(inGroup.map((a) => a.mediaKind))],
        previewArtifacts: inGroup,
        updatedAt: inGroup[0]!.updatedAt,
        href: inGroup[0]!.href,
      };
    });
    return { artifacts, groups, nextCursor: null };
  });

  // Tasks -------------------------------------------------------------------------------------
  api.get("/companies/:companyId/labels", () => []);
  api.get("/companies/:companyId/routines", () => []);
  api.get("/companies/:companyId/issues", ({ params, query }) => (params.companyId === world.COMPANY_ID ? filterIssues(db.issues, query) : []));
  api.get("/companies/:companyId/issues/summaries", ({ query }) => {
    const ids = (query.get("ids") ?? "").split(",");
    return db.issues.filter((i) => ids.includes(i.id));
  });
  api.get("/issues/:id/tree-control/state", () => ({ activePauseHold: null }));
  api.get("/issues/:id/tree-holds", () => []);
  api.get("/issues/:id/browsers", () => []);
  api.get("/issues/:id/accepted-plan-decompositions", () => []);
  api.get("/companies/:companyId/email/tasks/:issueId", () => null);
  api.get("/issues/:ref", ({ params }) => issueOr404(params.ref!));
  api.patch("/issues/:ref", ({ params, body }) => {
    const found = findIssue(params.ref!);
    if (!found) return reply(404, { error: "Issue not found" });
    const { comment: commentBody, ...patch } = (body ?? {}) as Record<string, unknown>;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    if (typeof commentBody === "string") {
      const added = world.comment({ id: newId("comment"), issueId: found.id, authorType: "user", authorAgentId: null, authorUserId: world.USER.id, body: commentBody, createdAt: new Date() });
      db.comments.push(added);
      return { ...found, comment: added };
    }
    return found;
  });
  api.post("/companies/:companyId/issues", ({ params, body }) => {
    const input = (body ?? {}) as Partial<Issue>;
    const number = db.issues.length + 1;
    const created = world.issue({ ...input, id: newId("issue"), companyId: params.companyId, issueNumber: number, identifier: `${world.PREFIX}-${number}` });
    db.issues.push(created);
    return created;
  });
  api.get("/issues/:id/comments", ({ params }) => {
    const issue = findIssue(params.id!);
    return db.comments.filter((c) => c.issueId === issue?.id);
  });
  api.post("/issues/:id/comments", ({ params, body }) => {
    const issue = findIssue(params.id!);
    const input = (body ?? {}) as { body?: string; clientRequestId?: string };
    const added = world.comment({
      id: newId("comment"),
      issueId: issue?.id ?? params.id!,
      authorType: "user",
      authorAgentId: null,
      authorUserId: world.USER.id,
      body: input.body ?? "",
      clientRequestId: input.clientRequestId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.comments.push(added);
    return added;
  });
  api.get("/issues/:id/interactions", ({ params }) => {
    const issue = findIssue(params.id!);
    return db.interactions.filter((i) => i.issueId === issue?.id);
  });
  api.post("/issues/:id/interactions/:interactionId/respond", ({ params, body }) => {
    const found = db.interactions.find((i) => i.id === params.interactionId);
    if (!found) return reply(404, { error: "Interaction not found" });
    Object.assign(found, { status: "answered", result: { version: 1, ...(body as object) }, resolvedAt: new Date().toISOString() });
    return found;
  });
  api.get("/issues/:id/recent-comments", ({ params }) => {
    const issue = findIssue(params.id!);
    const comments = db.comments.filter((c) => c.issueId === issue?.id);
    return { latestCommentId: comments.at(-1)?.id ?? null, oldestCommentId: comments[0]?.id ?? null, comments, hasMore: false };
  });
  api.get("/issues/:id/approvals", () => []);
  api.get("/issues/:id/feedback-votes", () => []);
  api.get("/issues/:id/queued-comments", ({ params }) => ({
    issueId: params.id,
    queueId: null,
    state: null,
    targetRunId: null,
    revision: "0",
    protocol: "legacy",
    steeringDisposition: "unsupported",
    entries: [],
  }));
  api.get("/issues/:id/runner-goal", ({ params, query }) => ({
    issueId: params.id,
    agentId: query.get("agentId"),
    adapterType: "claude_local",
    sessionId: null,
    capability: {
      availability: "unsupported",
      actions: [],
      autonomousUpdates: false,
      persistentAcrossResume: false,
      maxObjectiveChars: 0,
      tokenBudgetControl: false,
      usageReporting: false,
    },
    goal: null,
    workingNow: false,
    activeRunId: null,
    pendingAction: null,
    revision: 0,
    observedAt: null,
  }));
  api.get("/issues/:id/activity", () => []);
  api.get("/issues/:id/runs", () => [world.issueRun()]);
  api.get("/issues/:id/live-runs", () => []);
  api.get("/issues/:id/active-run", () => null);
  api.get("/issues/:id/documents", () => []);
  api.get("/issues/:id/attachments", () => []);
  api.get("/issues/:id/work-products", () => []);
  api.get("/issues/:id/cost-summary", () => null);
  api.get("/issues/:id/context-usage", () => null);

  // Inbox (attention) -------------------------------------------------------------------------
  api.get("/companies/:companyId/attention", ({ params }) => attentionFeed(params.companyId!, params.companyId === world.COMPANY_ID ? db.attention : []));
  api.post("/companies/:companyId/inbox-dismissals", ({ params, body }) => {
    const input = (body ?? {}) as { itemKey: string; kind?: "dismiss" | "snooze"; snoozedUntil?: string; fingerprint?: string };
    const now = new Date().toISOString();
    const kind = input.kind ?? "dismiss";
    const card = db.attention.find((a) => a.dismissalKey === input.itemKey);
    if (card) card.dismissal = { kind, dismissedAt: now, snoozedUntil: input.snoozedUntil ?? null, isActive: true } as typeof card.dismissal;
    return {
      id: newId("dismissal"),
      companyId: params.companyId,
      userId: world.USER.id,
      itemKey: input.itemKey,
      kind,
      dismissedAt: now,
      snoozedUntil: input.snoozedUntil ?? null,
      fingerprint: input.fingerprint ?? null,
      createdAt: now,
      updatedAt: now,
    };
  });
  api.get("/companies/:companyId/inbox/mine", () => ({
    userId: world.USER.id,
    issues: db.issues.filter((i) => i.createdByUserId === world.USER.id && i.status !== "done"),
    contextIssues: [],
    failureRuns: [],
    failureIssueIds: [],
  }));

  return db;
}

/** The task list's filters the journeys use: project, parent, status, assignee, a search. */
function filterIssues(issues: Issue[], query: URLSearchParams) {
  // Chats aren't tasks to the lists.
  let found = issues.filter((i) => !i.hiddenAt && !i.conversationAgentId);
  const projectId = query.get("projectId");
  if (projectId) found = found.filter((i) => i.projectId === projectId);
  const parentId = query.get("parentId");
  if (parentId) found = found.filter((i) => i.parentId === parentId);
  if (query.get("createdFromIssueId")) found = [];
  const originKind = query.get("originKind");
  if (originKind) found = found.filter((i) => (i.originKind ?? "manual") === originKind);
  const status = query.get("status");
  if (status) found = found.filter((i) => status.split(",").includes(i.status));
  const displayStatus = query.get("displayStatus");
  if (displayStatus) found = found.filter((i) => displayStatus.split(",").includes(i.displayStatus ?? i.status));
  const agentId = query.get("participantAgentId") ?? query.get("assigneeAgentId");
  if (agentId) found = found.filter((i) => i.assigneeAgentId === agentId);
  const q = query.get("q")?.toLowerCase();
  if (q) found = found.filter((i) => i.title.toLowerCase().includes(q) || !!i.identifier?.toLowerCase().includes(q));
  const offset = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? 500);
  return found.slice(offset, offset + limit);
}

export function attentionFeed(companyId: string, items: unknown[]) {
  return {
    companyId,
    generatedAt: "2026-11-16T09:00:00.000Z",
    totalCount: items.length,
    deskBadgeCount: items.length,
    viewCounts: { mine: items.length, unassigned: 0, company: items.length, archived: 0 },
    nextCursor: null,
    countsBySourceKind: {},
    items,
    receipts: [],
  };
}
