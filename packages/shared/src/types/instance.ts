import type { FeedbackDataSharingPreference } from "./feedback.js";

export const DAILY_RETENTION_PRESETS = [3, 7, 14] as const;
export const WEEKLY_RETENTION_PRESETS = [1, 2, 4] as const;
export const MONTHLY_RETENTION_PRESETS = [1, 3, 6] as const;
export interface BackupRetentionPolicy {
  dailyDays: (typeof DAILY_RETENTION_PRESETS)[number];
  weeklyWeeks: (typeof WEEKLY_RETENTION_PRESETS)[number];
  monthlyMonths: (typeof MONTHLY_RETENTION_PRESETS)[number];
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicy = {
  dailyDays: 7,
  weeklyWeeks: 4,
  monthlyMonths: 1,
};

/**
 * Instance-wide execution policy.
 *
 * - `"any"` (default / absent): unrestricted — any environment driver (local,
 *   ssh, sandbox) may run agents. Preserves single-tenant / local-trusted
 *   behavior.
 * - `"kubernetes"`: force ALL agent execution onto the Kubernetes
 *   sandbox-provider environment and REFUSE local/in-process execution. Used by
 *   shared cloud (cloud_tenant) instances so untrusted tenant agents can never
 *   run in the server process or on an unsandboxed local/ssh adapter.
 */
export type InstanceExecutionMode = "kubernetes" | "any";

export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
  feedbackDataSharingPreference: FeedbackDataSharingPreference;
  backupRetention: BackupRetentionPolicy;
  /**
   * Execution policy. Absent/`"any"` = unrestricted; `"kubernetes"` forces the
   * Kubernetes sandbox provider and denies local/ssh execution.
   */
  executionMode?: InstanceExecutionMode;
}

export interface InstanceExperimentalSettings {
  enableEnvironments: boolean;
  /**
   * Exposes the experimental Paperclip Runner adapter for new selections.
   * Existing native runs ignore later flag changes so they remain recoverable.
   */
  enableNativeRunner: boolean;
  enableAiConnectionRouters: boolean;
  /**
   * Hide the local environment and run all agents in the platform-managed
   * sandbox environment. Run selection refuses local while this is on.
   */
  enableManagedSandboxOnly: boolean;
  /**
   * Retired switch (step 4b part 3): per-task worktrees are always available, so the server always
   * reads this as on. The stored key is accepted and ignored.
   */
  enableIsolatedWorkspaces: boolean;
  /** Enroll eligible native sandbox workspaces in remote, snapshot-backed storage. */
  remoteWorkspaceStorageEnabled: boolean;
  /**
   * Retired switch (step 4b part 3), always read as on: a project with a git checkout gives each
   * new task its own worktree unless the project explicitly chose otherwise
   * (`applyDefaultIsolatedExecutionWorkspacePolicy`). The stored key is accepted and ignored.
   */
  enableIsolatedWorkspacesByDefault: boolean;
  enableStreamlinedLeftNavigation: boolean;
  /**
   * Use the streamlined shell, navigation, and contextual-sidebar experience.
   * Missing legacy values default on; the retired left-navigation preference
   * remains separate so an old opt-out cannot disable the broader UI.
   */
  enableStreamlinedUi: boolean;
  /** @deprecated Compatibility key only. Apps is always enabled. */
  enableApps: boolean;
  /** Exposes chat connector setup and Board surfaces; existing delivery continues when hidden. */
  enableChatConnectors: boolean;
  /** Show GitHub review bot setup and management independently of chat connectors. */
  enableGitHubReviewBots: boolean;
  /** Allow person-authorized assistant tools and task event delivery. */
  enablePublicMcp: boolean;
  /** Enable the standalone Dot choice and dedicated agent MCP connection independently of the general Runner rollout. */
  enableOpenAiDot: boolean;
  /** Enable experimental Grok Bot agents; requires MCP and the managed/native Runner. */
  enableGrokBot: boolean;
  enableMuse: boolean;
  /** @deprecated Compatibility key only. MCP aggregators are always enabled. */
  enableMcpAggregators: boolean;
  /** Show experimental memory connection setup. Existing connections remain usable. */
  enableMemoryConnectors: boolean;
  enablePaperclipNotebook: boolean;
  /** Show and allow the built-in Google Workspace connector while its Google verification is pending. */
  enableGoogleWorkspaceConnector: boolean;
  enableCases: boolean;
  enableAgentChat: boolean;
  /** Reorganized left nav, Inbox-as-Tasks-views, and the chat agent rail + task cards. */
  enableCombinedInboxTasks: boolean;
  /** The artifact presentation from the artifact directions lab (MVP V1) on the Artifacts page, the panel's Artifacts tab and the task thread. */
  enableArtifactsV1: boolean;
  enableConferenceRoomChat: boolean;
  enableClassicTaskInterface: boolean;
  /** Require Cmd/Ctrl+Enter to submit task replies and new tasks. */
  enableLegacyComposerSubmit: boolean;
  enableIssuePlanDecompositions: boolean;
  enableExperimentalFileViewer: boolean;
  enableExternalObjects: boolean;
  enableSmokeLab: boolean;
  enableBuiltInAgents: boolean;
  enableBetaSkills: boolean;
  enableSummaries: boolean;
  enableStatusCards: boolean;
  enableDecisions: boolean;
  /** Show company connection settings and allow contextual fast-response acknowledgements. */
  enableFastResponses: boolean;
  enableGoalsSidebarLink: boolean;
  enableServerInfoDebugView: boolean;
  /** Shows internal Paperclip maintainer tools and observability links. */
  enablePaperclipDeveloperMode: boolean;
  /**
   * Instructs agents to write user-interaction content (confirmations,
   * questions, suggested tasks, checkbox prompts) in ASD-STE100 Simplified
   * Technical English with brief decision context. Prompt-side only; no
   * behavior change outside interaction wording.
   */
  enableSimplifiedEnglishInteractions: boolean;
  /**
   * When the user's first onboarding request is a single task, the chief of
   * staff proposes with a short plan document and a checkbox card instead of a
   * one-card confirmation. Read once, when the onboarding first task is created;
   * flipping it later does not change an existing first task.
   */
  enableFirstTaskPlanProposal: boolean;
  autoRestartDevServerWhenIdle: boolean;
  enableWorkspaceBranchReconcileForward: boolean;
  enableWorkspaceDirtyQuarantineRepair: boolean;
  /**
   * On cloud-managed instances, grant the stack owner instance-admin access
   * to their own dedicated instance. Elevation is computed per request at the
   * trusted-header auth boundary (owner stack role + this flag); no
   * `instance_user_roles` row is ever written. Inert on self-hosted
   * instances, which have no trusted cloud tenant path.
   */
  enableOwnerInstanceAdmin: boolean;
  /**
   * Kill switch for the sandbox duplex command-stream bridge. Default off. The
   * host reads this per run before it selects the callback bridge transport.
   * Off forces the file bridge for every run with no manifest change and no
   * redeploy.
   */
  enableSandboxDuplexBridge: boolean;
  /**
   * MCP Tasks: long provider tool calls become durable tasks that survive
   * timeouts, restarts, and deploys. Default off: the extension is not
   * declared, so behavior matches a client without it.
   */
  enableMcpTasks: boolean;
  /**
   * @deprecated Compatibility-only. Provider WebSocket ingress now follows
   * enableNativeRunner and this value has no runtime effect.
   */
  enableRunnerPreviewIngress: boolean;
  /**
   * Worktree preview instances (`PAPERCLIP_IN_WORKTREE=true`) suppress the
   * heartbeat run engine by default so previews never self-execute tasks. When
   * this is enabled the worktree-instance scheduling suppression is lifted so
   * runs actually execute inside the preview. Ignored outside a worktree.
   */
  enableWorktreeRunExecution: boolean;
  /**
   * Server-managed cutoff recorded when worktree run execution is enabled in
   * this instance. Client PATCH payloads must not control this value.
   */
  worktreeRunExecutionActivatedAt: string | null;
  /**
   * Server-managed instance id captured with the cutoff so copied settings rows
   * from another instance fail closed.
   */
  worktreeRunExecutionActivationInstanceId: string | null;
  /**
   * How the terminal workspace reaper treats finished tasks' git worktrees (step 4b part 3): see
   * `WorktreeCleanupMode`. Absent when never saved: the reaper then keeps upstream's
   * environment-driven rules (the merged-and-clean archive and compaction always on,
   * `PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED` and `PAPERCLIP_GIT_RESTORE_POINTS_ENABLED` for
   * expiration, the environment's day counts). Once saved, the setting and the four values below
   * rule, and a mode runs for real, never as a dry run. Other workspaces keep upstream's rules.
   */
  worktreeCleanup?: WorktreeCleanupMode | null;
  /** Days to wait after a task's tree closes before archiving or expiring its worktree (default 1). */
  worktreeCleanupWaitDays?: number | null;
  /** Remove installed dependencies and build output from finished worktrees (default on). */
  worktreeCleanupRemoveBuildOutput?: boolean | null;
  /** Restore points mode: save the restore point this many days after the tree closes (default 3). */
  worktreeRestorePointAfterDays?: number | null;
  /** Restore points mode: also remove an open task's worktree idle this many days; 0 never (default 7). */
  worktreeRestorePointIdleDays?: number | null;
}

export const WORKTREE_CLEANUP_MODES = ["off", "merged", "strict", "restore_points"] as const;
/**
 * `off`: the reaper leaves task worktrees alone (no archive, compaction or expiration); closing one
 * by hand still works. `merged`: archive a worktree once its work is merged into the base and it's
 * clean. `strict`: also remove one the remote can rebuild exactly (pushed, nothing local).
 * `restore_points`: also remove one with unpushed or uncommitted work, after saving an encrypted
 * restore point.
 */
export type WorktreeCleanupMode = (typeof WORKTREE_CLEANUP_MODES)[number];

/** The worktree cleanup values a saved mode uses when the value itself was never saved. */
export const WORKTREE_CLEANUP_DEFAULTS = {
  waitDays: 1,
  removeBuildOutput: true,
  restorePointAfterDays: 3,
  restorePointIdleDays: 7,
} as const;

/** The worktree cleanup values in force. */
export interface WorktreeCleanupValues {
  waitDays: number;
  removeBuildOutput: boolean;
  restorePointAfterDays: number;
  restorePointIdleDays: number;
}

/** `GET /api/instance/settings/worktree-cleanup`: the cleanup setting and what is in force. */
export interface WorktreeCleanupStatus {
  /** The saved mode, or null when never saved (the environment variables decide). */
  saved: WorktreeCleanupMode | null;
  /** The mode the reaper uses now. Never saved, `merged` unless the environment enables expiration. */
  mode: WorktreeCleanupMode;
  source: "setting" | "environment";
  /** Only the environment fallback can be a dry run (`PAPERCLIP_GIT_CACHE_EXPIRATION_DRY_RUN`). */
  dryRun: boolean;
  restorePoints: { available: boolean; reason: string | null };
  /**
   * The values in force: the saved ones (or `WORKTREE_CLEANUP_DEFAULTS`), or the environment's when
   * never saved. In the environment fallback, strict expiration's wait is upstream's fixed 1 day.
   */
  values: WorktreeCleanupValues;
  /** How long restore points are kept (`PAPERCLIP_GIT_RESTORE_POINT_RETENTION_DAYS`, environment only). */
  retentionDays: number;
}

/**
 * Boolean feature-flag keys of the experimental settings — the only keys a
 * cloud managed-config overlay may target. Server-managed bookkeeping fields
 * (activation cutoffs, lookback hours) are excluded by construction.
 */
export type ManagedExperimentalFeatureKey = {
  [K in keyof InstanceExperimentalSettings]-?: InstanceExperimentalSettings[K] extends boolean
    ? K
    : never;
}[keyof InstanceExperimentalSettings];

export const PAPERCLIP_CLOUD_MANAGED_BY = "paperclip-cloud" as const;

/** Per-key metadata attached to settings responses for cloud-overlaid keys. */
export interface ManagedSettingMetadata {
  managed: true;
  managedBy: typeof PAPERCLIP_CLOUD_MANAGED_BY;
}

/**
 * Experimental settings as returned by the settings API. On cloud-managed
 * instances (`PAPERCLIP_MANAGED_CONFIG` present) `managedKeys` lists every key
 * whose value is overlaid by the harness; self-hosted responses omit it.
 */
export interface InstanceExperimentalSettingsWithManaged extends InstanceExperimentalSettings {
  managedKeys?: Partial<Record<ManagedExperimentalFeatureKey, ManagedSettingMetadata>>;
}

export interface InstanceSettings {
  id: string;
  defaultEnvironmentId: string | null;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettingsWithManaged;
  createdAt: Date;
  updatedAt: Date;
}
