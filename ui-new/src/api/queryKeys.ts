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
  activity: (companyId: string) => ["activity", companyId] as const,
  dashboard: (companyId: string) => ["dashboard", companyId] as const,
  org: (companyId: string) => ["org", companyId] as const,
  liveRuns: (companyId: string) => ["live-runs", companyId] as const,
  heartbeats: (companyId: string) => ["heartbeats", companyId] as const,
  sidebarBadges: (companyId: string) => ["sidebar-badges", companyId] as const,
};
