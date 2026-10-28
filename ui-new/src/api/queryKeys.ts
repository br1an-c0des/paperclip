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
  /*
   * Agents. The live events refresh `detail(agentId)` on any agent change, so everything about one
   * agent (its settings sections, runtime state, sessions, keys…) sits under that key and refreshes
   * with it. The project-access key is the one the task notices already use.
   */
  agents: {
    list: (companyId: string) => ["agents", companyId] as const,
    detail: (agentId: string) => ["agents", "detail", agentId] as const,
    /** One part of an agent: "runtime-state", "task-sessions", "keys", "config-revisions", "skills"… */
    part: (agentId: string, part: string, ...rest: string[]) => ["agents", "detail", agentId, part, ...rest] as const,
    projectAccess: (agentId: string) => ["agents", "detail", agentId, "project-access"] as const,
    instructionsBundle: (agentId: string) => ["agents", "detail", agentId, "instructions-bundle"] as const,
    instructionsFile: (agentId: string, path: string) => ["agents", "detail", agentId, "instructions-bundle", "file", path] as const,
    instructionHistory: (agentId: string, path: string) => ["agents", "detail", agentId, "instructions-bundle", "history", path] as const,
    instructionCandidates: (agentId: string) => ["agents", "detail", agentId, "instructions-bundle", "candidates"] as const,
    runs: (companyId: string, agentId: string) => ["heartbeat-runs", companyId, "agent", agentId] as const,
    costs: (companyId: string, from: string, to: string) => ["costs", companyId, "by-agent", from, to] as const,
    costsByModel: (companyId: string, from: string, to: string) => ["costs", companyId, "by-agent-model", from, to] as const,
    adapters: (companyId: string, environmentId: string | null) => ["adapters", "availability", companyId, environmentId ?? "__default__"] as const,
    /** A harness's model catalog; narrowed catalogs (`adapterModelKeyOptions`) sit under the harness's key. */
    adapterModels: (companyId: string, adapterType: string, options?: Record<string, unknown>) =>
      options
        ? (["agents", companyId, "adapter-models", adapterType, options] as const)
        : (["agents", companyId, "adapter-models", adapterType] as const),
    primary: (companyId: string) => ["primary-agent", companyId, "me"] as const,
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
    /** The runner goal for the task's assignee, or for the agent the composer is about to hand it to. */
    runnerGoal: (issueId: string, agentId: string | null) => ["issues", "detail", issueId, "runner-goal", agentId ?? "__assignee__"] as const,
    /** Your thumbs up and down on the task's agent output. */
    feedbackVotes: (issueId: string) => ["issues", "detail", issueId, "feedback-votes"] as const,
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
  /**
   * Company activity. Called as a function it's the prefix the live events refresh on every
   * `activity.logged`, which also reaches the Activity page's log (src/activity/). The page's costs
   * sit under `["costs", companyId]`, which cost events refresh; the by-project and by-agent spend
   * reuse `costs` and `agents.costs` so the project and agent pages share them. Commentary isn't
   * pushed by the live events, so it's refetched on focus.
   */
  activity: Object.assign((companyId: string) => ["activity", companyId] as const, {
    log: (companyId: string, filters: string) => ["activity", companyId, "log", filters] as const,
    commentary: (companyId: string, filters: string) => ["agent-commentary", companyId, "list", filters] as const,
    commentaryEntry: (companyId: string, id: string) => ["agent-commentary", companyId, "detail", id] as const,
    costSummary: (companyId: string, from?: string, to?: string) => ["costs", companyId, "summary", from ?? "all", to ?? "now"] as const,
    /** Apart from `heartbeats`, which every run's progress refreshes; refetched when a live run changes. */
    runs: (companyId: string, agentId: string | null) => ["activity-runs", companyId, agentId ?? "__all__"] as const,
  }),
  dashboard: (companyId: string) => ["dashboard", companyId] as const,
  /**
   * The organization pages (boards 19, 20). Called as a function it's the reporting tree, which the
   * live events refresh with the agents. Activity sits under `["activity", companyId]`, which the
   * live events reach. The run history is the company run list workload reads
   * (`workload.runs`), and your primary agent is `agents.primary`. The bulk edit's catalogs sit under
   * the tree's key; each is put together from `agents.adapterModels` and AI-connection requests.
   */
  org: Object.assign((companyId: string) => ["org", companyId] as const, {
    activity: (companyId: string) => ["activity", companyId, "org"] as const,
    builtInAgents: (companyId: string) => ["built-in-agents", companyId] as const,
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
  /**
   * Apps and tools (src/apps/). Everything sits under `["tools", companyId]`, one connection's
   * parts under its `connection(companyId, id)` key, so the live events refresh the whole area
   * with one prefix on any tool activity.
   */
  tools: {
    all: (companyId: string) => ["tools", companyId] as const,
    gallery: (companyId: string) => ["tools", companyId, "gallery"] as const,
    applications: (companyId: string) => ["tools", companyId, "applications"] as const,
    connections: (companyId: string) => ["tools", companyId, "connections"] as const,
    attention: (companyId: string) => ["tools", companyId, "attention"] as const,
    profiles: (companyId: string) => ["tools", companyId, "profiles"] as const,
    policies: (companyId: string) => ["tools", companyId, "policies"] as const,
    actionRequests: (companyId: string, status: string) => ["tools", companyId, "action-requests", status] as const,
    emailInboxes: (companyId: string) => ["tools", companyId, "email-inboxes"] as const,
    connection: (companyId: string, connectionId: string) => ["tools", companyId, "connection", connectionId] as const,
    /** One part of a connection: "catalog", "installs", "grants". */
    connectionPart: (companyId: string, connectionId: string, part: string) =>
      ["tools", companyId, "connection", connectionId, part] as const,
    gateways: (companyId: string) => ["tools", companyId, "gateways"] as const,
    /** The tool-call audit, filtered (a gateway's or an agent's calls). */
    activity: (companyId: string, filter: string) => ["tools", companyId, "activity", filter] as const,
    /** The profiles, tools and installed connections an agent's runs get. */
    effective: (companyId: string, agentId: string) => ["tools", companyId, "effective", agentId] as const,
    profileNewTools: (companyId: string, profileId: string) => ["tools", companyId, "profile-new-tools", profileId] as const,
  },
  /** Paperclip's MCP endpoint for outside assistants (src/auth/McpConnect.tsx, Apps → Assistants). */
  mcp: {
    setup: ["mcp-setup"] as const,
    connections: ["mcp-connections"] as const,
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
  /**
   * The Workspaces tab (src/workspaces/): every workspace in the company, open or closed, under the
   * same `["workspace-overview", companyId]` prefix as a project's, so one invalidation reaches both.
   * A workspace's close readiness (and git state) sits apart, by workspace.
   */
  workspaces: {
    overview: (companyId: string, view: "open" | "closed") => ["workspace-overview", companyId, "__all__", view] as const,
    closeReadiness: (workspaceId: string) => ["execution-workspaces", "close-readiness", workspaceId] as const,
  },
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

  /*
   * Agent chat (M5, boards 12, 13; src/chat/). Your chats sit under `["agent-chats", companyId]`,
   * as in the old UI. The chat itself is a task, so its messages, requests and queue use
   * `issues.section(chatId, …)` and refresh with the task. Hand-offs, reports and Up next are task
   * lists, under `issues.list(companyId)`, which every task event refreshes; the agent's activity
   * sits under `activity(companyId)`, which every activity event refreshes.
   */
  /*
   * The skill library (M6, src/skills/), in the old UI's `["company-skills", companyId]` shape. A
   * skill's detail, versions and files sit under its id so editing a file refreshes them together.
   * Sources sit apart; syncing or removing one refreshes the library too.
   */
  skills: {
    all: (companyId: string) => ["company-skills", companyId] as const,
    list: (companyId: string) => ["company-skills", companyId, "list"] as const,
    detail: (companyId: string, skillId: string) => ["company-skills", companyId, "skill", skillId] as const,
    versions: (companyId: string, skillId: string) => ["company-skills", companyId, "skill", skillId, "versions"] as const,
    file: (companyId: string, skillId: string, path: string) => ["company-skills", companyId, "skill", skillId, "file", path] as const,
    sources: (companyId: string) => ["skill-sources", companyId] as const,
  },

  chat: {
    list: (companyId: string) => ["agent-chats", companyId, "list"] as const,
    detail: (companyId: string, agentId: string) => ["agent-chats", companyId, "agent", agentId] as const,
    handoffs: (companyId: string, chatId: string) => ["issues", companyId, "chat-handoffs", chatId] as const,
    reports: (companyId: string, agentId: string) => ["issues", companyId, "agent-reports", agentId] as const,
    upNext: (companyId: string, agentId: string) => ["issues", companyId, "agent-up-next", agentId] as const,
    activity: (companyId: string, agentId: string) => ["activity", companyId, "agent", agentId] as const,
    /** A chat reply's run events, as the live reply reads them. */
    replyEvents: (runId: string) => ["heartbeat-run", runId, "chat-reply-events"] as const,
  },

  /*
   * Company settings (M6, boards 21–25 and 30; src/settings/company/), in the old UI's shapes so
   * its live-event rules apply. The company itself is `companies.all`; secrets, user secret
   * definitions, budgets and environments share `projectSettings`' keys. Plugin pages sit under
   * `["plugins"]`, which the live events refresh on any plugin change.
   */
  companySettings: {
    members: (companyId: string) => ["access", "company-members", companyId] as const,
    invites: (companyId: string) => ["access", "invites", "paginated-v1", companyId] as const,
    joinRequests: (companyId: string) => ["access", "join-requests", companyId, "pending_approval"] as const,
    decisionModel: (companyId: string) => ["decision-model", companyId] as const,
    fastResponse: (companyId: string) => ["fast-response", companyId] as const,
    fastResponseModels: (companyId: string, connectionId: string) => ["fast-response-models", companyId, connectionId] as const,
    promptInjection: (companyId: string) => ["prompt-injection-prevention", companyId] as const,
    promptInjectionModels: (companyId: string, connectionId: string) => ["prompt-injection-models", companyId, connectionId] as const,
    observability: (companyId: string) => ["agent-observability", companyId] as const,
    secretUsage: (secretId: string) => ["secrets", "usage", secretId] as const,
    secretProviders: (companyId: string) => ["secret-providers", companyId] as const,
    secretProviderConfigs: (companyId: string) => ["secret-provider-configs", companyId] as const,
    userSecretCoverage: (companyId: string, definitionId: string) => ["user-secret-definitions", companyId, definitionId, "coverage"] as const,
    mySecrets: (companyId: string) => ["my-user-secrets", companyId] as const,
    secretProposals: (companyId: string) => ["secret-proposals", companyId, "pending"] as const,
    exportFidelity: (companyId: string) => ["companies", companyId, "export-fidelity"] as const,
    pluginPages: ["plugins", "ui-contributions"] as const,
    /** The whole instance settings (`GET /instance/settings`), for the instance-wide default environment. */
    instanceSettings: ["instance", "settings"] as const,
  },

  /*
   * App settings (M6, boards 28–30; src/settings/app/), in the old UI's shapes: harnesses under
   * `["adapters"]`, which also reaches the hiring menus' availability (`agents.adapters`); plugins
   * under `["plugins"]`, which the live events refresh; people under `["access"]`; the whole
   * organization directory under `["companies"]`, so anything refreshing companies refreshes it.
   * The general and experimental settings use `instance`, and harness usage counts each company's
   * `agents.list`.
   */
  instanceSettings: {
    adapters: ["adapters"] as const,
    plugins: ["plugins"] as const,
    bundledPlugins: ["plugins", "examples"] as const,
    profile: ["auth", "profile"] as const,
    adminUsers: (query: string) => ["access", "admin-users", query] as const,
    userCompanyAccess: (userId: string) => ["access", "user-company-access", userId] as const,
    companyDirectory: ["companies", "directory"] as const,
    /** The latest version of an npm package, for an installed harness's Update button. */
    npmLatest: (packageName: string) => ["npm-latest-version", packageName] as const,
  },

  /*
   * Plugin hosting (src/plugins/, decision G). Everything sits under `["plugins"]`, which the live
   * events refresh when a plugin is installed, turned on or off, upgraded or removed. The UI
   * contributions are the same entry company settings' plugin pages read.
   */
  plugins: {
    uiContributions: ["plugins", "ui-contributions"] as const,
    /** Whether a plugin's task side panel is available for the agent running a task. */
    panelAvailability: (pluginId: string, slotId: string, agentId: string, runId: string) =>
      ["plugins", "panel-availability", pluginId, slotId, agentId, runId] as const,
    /** One plugin's record, health, runtime dashboard, logs and configuration in a company (App settings → Plugins). */
    detail: (pluginId: string) => ["plugins", "detail", pluginId] as const,
    health: (pluginId: string) => ["plugins", "detail", pluginId, "health"] as const,
    dashboard: (pluginId: string) => ["plugins", "detail", pluginId, "dashboard"] as const,
    logs: (pluginId: string) => ["plugins", "detail", pluginId, "logs"] as const,
    config: (pluginId: string, companyId: string) => ["plugins", "detail", pluginId, "config", companyId] as const,
  },

  /** The current Paperclip announcement for a signed-in person (src/shell/Announcements.tsx). */
  announcement: (userId: string) => ["announcements", "current", userId] as const,
};
