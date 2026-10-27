/*
 * Query keys, in the shapes ui/src/lib/queryKeys.ts uses, so the live-events invalidation rules can
 * be ported from the old UI one to one. Company-scoped keys put the company ID second, which lets
 * one `invalidateQueries({ queryKey: [area, companyId] })` reach every query for that company.
 *
 * Add keys here as each screen's API module is ported.
 */

export const queryKeys = {
  health: ["health"] as const,
  auth: {
    session: ["auth", "session"] as const,
  },
  access: {
    currentBoardAccess: ["access", "current-board-access"] as const,
    userDirectory: (companyId: string) => ["access", "company-user-directory", companyId] as const,
  },
  instance: {
    experimentalSettings: ["instance", "experimental-settings"] as const,
    generalSettings: ["instance", "general-settings"] as const,
  },
  companies: {
    /** Prefix for everything company-shaped. */
    all: ["companies"] as const,
    /** The list is per account: a different account is a different entry. */
    list: (userId: string | null) => ["companies", "list", userId ?? "anonymous"] as const,
    detail: (companyId: string) => ["companies", companyId] as const,
    stats: ["companies", "stats"] as const,
  },
  agents: {
    list: (companyId: string) => ["agents", companyId] as const,
    detail: (agentId: string) => ["agents", "detail", agentId] as const,
    adapterModels: (companyId: string, adapterType: string) =>
      ["agents", companyId, "adapter-models", adapterType] as const,
  },
  issues: {
    /** Prefix for every task list in a company. */
    list: (companyId: string) => ["issues", companyId] as const,
    /** One task list: the whole company, a project, or a task's subtasks. */
    view: (companyId: string, scope: { projectId?: string; parentId?: string }) =>
      ["issues", companyId, "view", scope.projectId ?? "__all__", scope.parentId ?? "__all__"] as const,
    detail: (issueId: string) => ["issues", "detail", issueId] as const,
    /**
     * A task panel section's data (comments, activity, runs, documents…), under the task's detail
     * key so that anything refreshing the task refreshes its sections too.
     */
    section: (issueId: string, section: string, ...rest: string[]) => ["issues", "detail", issueId, section, ...rest] as const,
    search: (companyId: string, q: string, limit: number) => ["issues", companyId, "search", q, limit] as const,
    labels: (companyId: string) => ["issues", companyId, "labels"] as const,
  },
  projects: {
    /** Prefix for every project query in a company. */
    all: (companyId: string) => ["projects", companyId] as const,
    list: (companyId: string) => ["projects", companyId, "list"] as const,
  },
  goals: {
    list: (companyId: string) => ["goals", companyId] as const,
  },
  executionWorkspaces: {
    /** The company's execution workspaces in brief, for the task list's workspace filter and groups. */
    summaryList: (companyId: string) => ["execution-workspaces", companyId, "summary", {}] as const,
  },
  activity: (companyId: string) => ["activity", companyId] as const,
  dashboard: (companyId: string) => ["dashboard", companyId] as const,
  /**
   * The organization pages (boards 19, 20). Called as a function it's the reporting tree, which the
   * live events refresh with the agents. The rest sit under prefixes the live events already reach:
   * runs under `["heartbeats", companyId]`, activity under `["activity", companyId]`, the bulk edit's
   * catalogs under the tree's own key.
   */
  org: Object.assign((companyId: string) => ["org", companyId] as const, {
    recentRuns: (companyId: string) => ["heartbeats", companyId, "org-recent"] as const,
    activity: (companyId: string) => ["activity", companyId, "org"] as const,
    builtInAgents: (companyId: string) => ["built-in-agents", companyId] as const,
    primaryAgent: (companyId: string) => ["primary-agent", companyId] as const,
    bulkCatalog: (companyId: string, agentIds: readonly string[], binding: string | null) =>
      ["org", companyId, "bulk-catalog", agentIds.join(","), binding ?? "current"] as const,
  }),
  liveRuns: (companyId: string) => ["live-runs", companyId] as const,
  /**
   * One run, for the run modal. The live-events socket refreshes `["heartbeat-run", runId]` on
   * `heartbeat.run.status`, so the run's events and trace refresh with it.
   */
  runs: {
    detail: (runId: string) => ["heartbeat-run", runId] as const,
    events: (runId: string) => ["heartbeat-run", runId, "events"] as const,
    providerTrace: (runId: string) => ["heartbeat-run", runId, "provider-trace"] as const,
    providerTraceMetadata: (companyId: string, runId: string) => ["provider-traces", companyId, runId] as const,
  },
  heartbeats: (companyId: string) => ["heartbeats", companyId] as const,
  /** The old UI's live events invalidate `["ai-connections", companyId]`, which reaches both. */
  aiConnections: {
    list: (companyId: string) => ["ai-connections", companyId] as const,
    activeRuns: (companyId: string, connectionId: string) =>
      ["ai-connections", companyId, connectionId, "active-runs"] as const,
  },
  sidebarBadges: (companyId: string) => ["sidebar-badges", companyId] as const,
  /**
   * The Inbox (board 14). The feed keeps the old UI's `["attention", companyId]` prefix; an approval
   * sits under `["approvals", companyId]`, which answering a card and the live events refresh; your
   * tasks sit under the company's task lists, so task changes refresh Updates.
   */
  inbox: {
    attention: (companyId: string) => ["attention", companyId] as const,
    feed: (companyId: string) => ["attention", companyId, "with-dismissed"] as const,
    approval: (companyId: string, approvalId: string) => ["approvals", companyId, "detail", approvalId] as const,
    approvalIssues: (companyId: string, approvalId: string) => ["approvals", companyId, "detail", approvalId, "issues"] as const,
    tasks: (companyId: string) => ["issues", companyId, "inbox", "mine"] as const,
    tasksWithArchived: (companyId: string) => ["issues", companyId, "inbox", "with-archived"] as const,
  },
  /**
   * The Search page (src/search/). The old UI keys company search `["company-search", companyId, …]`;
   * the rest of the key is the request, filters and sort included, without the page offset.
   */
  search: {
    all: (companyId: string) => ["company-search", companyId] as const,
    results: (companyId: string, request: string) => ["company-search", companyId, request] as const,
  },

  /*
   * The project pages (M4): the dashboard's spend and checkouts, the Docs tab's
   * artifacts, and New project's repositories. Shapes follow ui/src/lib/queryKeys.ts.
   */
  /** Spend by project in a range; no range is all time. */
  costs: (companyId: string, from?: string, to?: string) => ["costs", companyId, from ?? "all", to ?? "now"] as const,
  workspaceOverview: (companyId: string, projectId: string) => ["workspace-overview", companyId, projectId] as const,
  projectRepositories: (companyId: string) => ["project-repositories", companyId] as const,
  artifacts: {
    /** A project's artifacts grouped by task, or one task's group in full. */
    project: (companyId: string, projectId: string, groupIssueId?: string) =>
      ["artifacts", companyId, "project", projectId, groupIssueId ?? "__groups__"] as const,
  },

  /*
   * Project settings (M4, boards 10 and 11), in the old UI's shapes so its live-event rules apply:
   * a project by id or URL key (archived ones aren't in the list), its private-project members and
   * Git authorization, the company's budgets, secrets and environments, and your memberships.
   */
  projectSettings: {
    detail: (key: string) => ["projects", "detail", key] as const,
    accessMembers: (projectId: string) => ["projects", "access-members", projectId] as const,
    gitAuthorization: (companyId: string, projectId: string) => ["project-git-authorization", companyId, projectId] as const,
    budgets: (companyId: string) => ["budgets", "overview", companyId] as const,
    secrets: (companyId: string) => ["secrets", companyId] as const,
    userSecretDefinitions: (companyId: string) => ["user-secret-definitions", companyId] as const,
    environments: (companyId: string) => ["environments", companyId] as const,
    memberships: (companyId: string) => ["resource-memberships", companyId, "me"] as const,
  },

  /*
   * Recurring tasks (routines, M4). Everything sits under `["routines"]`, which the live events
   * refresh on any routine, trigger or run activity, as in the old UI; folders too, since moving a
   * recurring task changes both. The company's secrets use `projectSettings.secrets`.
   */
  routines: {
    all: ["routines"] as const,
    list: (companyId: string, projectId?: string) => ["routines", "list", companyId, projectId ?? "__all__"] as const,
    detail: (routineId: string) => ["routines", "detail", routineId] as const,
    runs: (routineId: string) => ["routines", "runs", routineId] as const,
    revisions: (routineId: string) => ["routines", "revisions", routineId] as const,
    folders: (companyId: string) => ["routines", "folders", companyId] as const,
  },

  /*
   * Agent workload (M4 and M5, boards 31–33). The run history sits apart from `heartbeats`, which
   * the live events refresh on every run's progress; the workload views refetch it when a run
   * starts, queues or finishes instead (src/workload/use-workload.ts).
   */
  workload: {
    runs: (companyId: string) => ["workload", companyId, "runs"] as const,
    builtInAgents: (companyId: string) => ["workload", companyId, "built-in-agents"] as const,
  },
};
