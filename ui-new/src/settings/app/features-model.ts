import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceFeatureKey,
  PatchInstanceExperimentalSettings,
  WorktreeCleanupMode,
  WorktreeCleanupStatus,
} from "@paperclipai/shared";

// Kept in step with WORKTREE_CLEANUP_MODES in @paperclipai/shared (imported as a type only here).
const WORKTREE_CLEANUP_MODES: readonly WorktreeCleanupMode[] = ["off", "strict", "restore_points"];

/*
 * App settings → General → Features (decision 32): plain switches for the experimental flags the
 * server enforces and someone may still want to change. Decision 12 sorted every flag: the UI-only
 * ones are dropped or built into ui-new and get no switch; the server-enforced ones stay instance
 * settings that ui-new follows, and these are their switches. The rest are left out on purpose, each
 * with its reason in LEFT_OUT, so a flag upstream adds or renames fails features-model.test.ts until
 * it's sorted here.
 *
 * Agent chat (`enableAgentChat`) has no switch: upstream made it a compatibility key the server
 * always reads as on (#19360, U57), so it's built in like Connections (once Apps).
 *
 * Switches save with `PATCH /api/instance/settings/experimental`, the flag's key and its new value.
 * Two kinds of requirement:
 *
 * - A plain requirement (OpenAI Dot needs Assistant connections): the switch can't be turned on
 *   while what it needs is off. It can still be turned off.
 * - A linked one (Status cards needs Summaries), as in the old Experimental page: turning the flag on
 *   turns on what it needs, and turning that off turns the flag off, in the same request.
 *
 * Keys Paperclip Cloud manages (`managedKeys`) and keys an operator hides
 * (`PAPERCLIP_HIDDEN_SETTINGS`, which the server also refuses to change) are fixed: a fixed key is
 * shown locked or not at all, and a switch whose linked change would touch one is locked too.
 */

export type FeatureFlag = {
  key: InstanceFeatureKey;
  label: string;
  help: string;
  /** Flags that must be on for this one to work. */
  requires?: InstanceFeatureKey[];
  /** Turning this on turns on what it requires; turning one of those off turns this off. */
  linked?: boolean;
};

export type FeatureGroup = {
  title: string;
  flags: FeatureFlag[];
  /** The group also holds the worktree cleanup choice (step 4b part 3), which isn't a switch. */
  worktreeCleanup?: true;
};

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: "Tasks and workspaces",
    worktreeCleanup: true,
    flags: [
      {
        key: "enableCases",
        label: "Cases",
        help: "Durable work products that tasks create and iterate on. Tasks show their case, New task can start one, and agents get the case API. Turning this off keeps case data.",
      },
      {
        key: "enableExternalObjects",
        label: "External objects",
        help: "Finds links in tasks to pull requests, tickets and other outside work, and shows their status.",
      },
      {
        key: "enableLegacyComposerSubmit",
        label: "Command/Ctrl+Enter to send",
        help: "Task replies and new tasks send with Command/Ctrl+Enter, and Enter adds a new line. When off, Enter sends and Shift+Enter adds a new line.",
      },
    ],
  },
  {
    title: "Agents",
    flags: [
      {
        key: "enableNativeRunner",
        label: "Paperclip Runner",
        help: "Lets agents run on the Paperclip Runner, with authenticated runner ingress when a sandbox needs it. Turning this off hides the choice; runs already on it aren't affected.",
      },
      {
        key: "enableManagedSandboxOnly",
        label: "Managed environment only",
        help: "Hides the local environment and runs every agent in the platform-managed environment.",
      },
      {
        key: "enableBuiltInAgents",
        label: "Built-in agents",
        help: "Shows the agents Paperclip manages itself, with their roster badges and setup controls.",
      },
      {
        key: "enableBetaSkills",
        label: "Beta skills",
        help: "Lets agents pin beta releases of the Paperclip core skill. Turning this off returns every agent to the live skill and keeps their saved pins.",
      },
      {
        key: "enableSimplifiedEnglishInteractions",
        label: "Simplified English requests",
        help: "Agents write confirmations, questions and suggested tasks in ASD-STE100 Simplified Technical English, with brief context on what each choice does.",
      },
      {
        key: "enableFirstTaskPlanProposal",
        label: "Plan the first task",
        help: "When someone's first request is a single task, the chief of staff writes a short plan document and a checklist instead of a one-card confirmation. Applies to organizations created after the change.",
      },
    ],
  },
  {
    title: "Connected agents",
    flags: [
      {
        key: "enableOpenAiDot",
        label: "OpenAI Dot",
        help: "Adds OpenAI Dot as an agent choice. Needs an authenticated instance with a public HTTPS address. Turning this off blocks Dot calls and new work; saved connections are kept.",
        requires: ["enablePublicMcp"],
      },
      {
        key: "enableGrokBot",
        label: "Grok Bot",
        help: "Connects an existing Grok Bot as an agent. Needs authenticated public HTTPS, and its spending isn't reported. Turning this off blocks Grok calls and new work.",
        requires: ["enablePublicMcp", "enableNativeRunner"],
      },
      {
        key: "enableMuse",
        label: "Muse",
        help: "Connects your personal Meta Muse through its background receiver. Needs authenticated public HTTPS, and its usage and cost aren't reported. Turning this off blocks new work.",
        requires: ["enableNativeRunner"],
      },
    ],
  },
  {
    title: "Connections",
    flags: [
      {
        key: "enablePublicMcp",
        label: "Assistant connections (MCP)",
        help: "Lets Codex, Claude and other assistants connect as a person to review work, delegate tasks and add feedback. Needs an authenticated instance with a public address. Turning this off blocks assistant calls; work already delegated continues.",
      },
      {
        key: "enableChatConnectors",
        label: "Chat connectors",
        help: "Connect agents to Slack, Discord, Microsoft Teams and Telegram conversations. Turning this off hides their setup; existing connections keep running.",
      },
      {
        key: "enableGitHubReviewBots",
        label: "GitHub review bots",
        help: "Connect agents to GitHub with their own App identity to review pull requests and answer issues. Turning this off hides their setup; existing bots keep running.",
      },
      {
        key: "enableMemoryConnectors",
        label: "Memory connectors",
        help: "Connect Mem0, Zep, Supermemory, Cognee and Honcho for long-term memory. Turning this off hides their setup; existing connections keep running.",
      },
      {
        key: "enableFastResponses",
        label: "Fast responses",
        help: "Lets agents send a short acknowledgement while they start work.",
      },
      {
        key: "enableGoogleWorkspaceConnector",
        label: "Google Workspace connector",
        help: "Offers Paperclip's own Google Workspace connector while Google's app verification is pending. When off, Google apps come through Composio and Arcade instead.",
      },
      {
        key: "enableAiConnectionRouters",
        label: "AI connection routers",
        help: "Lets plugin connections choose task-pinned accounts and harnesses.",
      },
      {
        key: "enableMcpTasks",
        label: "Durable app actions (MCP Tasks)",
        help: "Connected apps that support MCP Tasks run long actions, such as CI runs or deploys, as tasks Paperclip keeps track of, so a timeout, restart or deploy doesn't lose the result or start the work twice. Turning this off stops new tasks; apps then answer as before.",
      },
    ],
  },
  {
    title: "Status and diagnostics",
    flags: [
      {
        key: "enableSummaries",
        label: "Summaries",
        help: "Summarizer-written status on project and workspace pages, with refresh and history. Turning this off keeps summary data.",
      },
      {
        key: "enableStatusCards",
        label: "Status cards",
        help: "The shared status-card board and its API. Turning this off keeps card data.",
        requires: ["enableSummaries"],
        linked: true,
      },
      {
        key: "enableServerInfoDebugView",
        label: "Server info",
        help: "Shows the server's last restart and running commit in the account menu.",
      },
    ],
  },
];

/** Every flag decision 12 keeps out of the card, and why. */
export const LEFT_OUT: Partial<Record<InstanceFeatureKey, string>> = {
  // Dropped (decision 12): ui-new leaves the feature out or replaces it with its own design.
  enableStreamlinedUi: "Dropped: ui-new is its own shell.",
  enableStreamlinedLeftNavigation: "Dropped: the old UI's sidebar; it retired the switch too.",
  enableClassicTaskInterface: "Dropped: one task interface.",
  enableCombinedInboxTasks: "Dropped: Inbox stays separate from Tasks.",
  enableDecisions: "Dropped: the Inbox takes its place.",
  enableGoalsSidebarLink: "Dropped: there's no Goals page.",
  enableArtifactsV1: "Dropped: the artifact boards set the presentation.",
  enableConferenceRoomChat: "Dropped: team chat has no surface.",
  // Built in (decision 12): ui-new always has the feature.
  enableApps: "Built in: a compatibility key; Connections (once Apps) is always on.",
  enableAgentChat: "Built in: a compatibility key the server always reads as on (U57, upstream #19360).",
  enableMcpAggregators: "Built in: a compatibility key the server always reads as on.",
  enableEnvironments: "Built in: Environments is a company settings section.",
  enableIssuePlanDecompositions: "Built in: shown in a task's history.",
  enableExperimentalFileViewer: "Built in: the task panel's file browser.",
  enableIsolatedWorkspaces: "Built in: per-task worktrees are always available (step 4b part 3); the server reads it as on.",
  enableIsolatedWorkspacesByDefault: "Built in: a project with a git checkout gives each new task its own worktree unless it opts out (step 4b part 3).",
  // Maintainer and developer tools.
  enableSmokeLab: "Maintainer tooling.",
  enablePaperclipDeveloperMode: "Maintainer tooling.",
  autoRestartDevServerWhenIdle: "Local development only.",
  // Internal, Cloud-only or not wired up; the old page hides them too.
  enableWorktreeRunExecution: "Only for worktree preview instances.",
  enableRunnerPreviewIngress: "A compatibility key; runner ingress follows Paperclip Runner.",
  enableSandboxDuplexBridge: "An operator kill switch for the sandbox transport.",
  enableWorkspaceBranchReconcileForward: "An operator kill switch for workspace recovery.",
  enableWorkspaceDirtyQuarantineRepair: "An operator kill switch for workspace recovery.",
  enableOwnerInstanceAdmin: "Paperclip Cloud only; inert on self-hosted instances.",
  enablePaperclipNotebook: "A managed rollout; nothing reads it yet.",
  remoteWorkspaceStorageEnabled: "An operator setting for remote workspace storage; the old page doesn't show it.",
};

const FLAGS = new Map(FEATURE_GROUPS.flatMap((group) => group.flags.map((flag) => [flag.key, flag] as const)));

export function featureFlag(key: InstanceFeatureKey): FeatureFlag | undefined {
  return FLAGS.get(key);
}

export function featureLabel(key: InstanceFeatureKey) {
  return FLAGS.get(key)?.label ?? key;
}

/** The flags that list this one as a linked requirement (Summaries → Status cards). */
function linkedDependents(key: InstanceFeatureKey) {
  return [...FLAGS.values()].filter((flag) => flag.linked && flag.requires?.includes(key));
}

/** The operator key that hides a flag's switch, as `PAPERCLIP_HIDDEN_SETTINGS` writes it. */
export function hiddenFeatureKey(key: InstanceFeatureKey) {
  return `instance.experimental.${key}`;
}

export type FeatureContext = {
  settings: InstanceExperimentalSettingsWithManaged | undefined;
  hidden: ReadonlySet<string>;
  /** Instance admins only. */
  editable: boolean;
};

const isOn = (settings: FeatureContext["settings"], key: InstanceFeatureKey) => settings?.[key] === true;
const isManaged = (settings: FeatureContext["settings"], key: InstanceFeatureKey) => settings?.managedKeys?.[key]?.managed === true;
const isFixed = (context: FeatureContext, key: InstanceFeatureKey) =>
  isManaged(context.settings, key) || context.hidden.has(hiddenFeatureKey(key)) || context.hidden.has("instance.experimental");

/** The groups and flags to show: an operator can hide a flag, or the whole card with `instance.experimental`. */
export function visibleFeatureGroups(hidden: ReadonlySet<string>): FeatureGroup[] {
  if (hidden.has("instance.experimental")) return [];
  return FEATURE_GROUPS.map((group) => {
    const flags = group.flags.filter((flag) => !hidden.has(hiddenFeatureKey(flag.key)));
    const cleanup = group.worktreeCleanup && !hidden.has(WORKTREE_CLEANUP_HIDDEN_KEY);
    return { title: group.title, flags, ...(cleanup ? { worktreeCleanup: true as const } : {}) };
  }).filter((group) => group.flags.length > 0 || group.worktreeCleanup);
}

// ---------------------------------------------------------------------------------------------
// Cleaning up finished worktrees (step 4b part 3)
//
// Upstream's git workspace expiration sweep, behind `experimental.worktreeCleanup`: off by
// default, or one of its two modes. `GET /instance/settings/worktree-cleanup` says what's in force:
// never saved, the sweep follows the environment variables an operator set. It saves with the same
// PATCH as the switches; the server refuses restore points when they can't work here.

export const WORKTREE_CLEANUP_HIDDEN_KEY = "instance.experimental.worktreeCleanup";

export const WORKTREE_CLEANUP_LABELS: Record<WorktreeCleanupMode, string> = {
  off: "Off",
  strict: "Only when everything is pushed",
  restore_points: "Save a restore point, then remove",
};

export type WorktreeCleanupOption = { value: WorktreeCleanupMode; label: string; disabled: boolean };

/** The choices, with restore points unavailable (unless in force already) when their prerequisites fail. */
export function worktreeCleanupOptions(status: WorktreeCleanupStatus | undefined): WorktreeCleanupOption[] {
  return WORKTREE_CLEANUP_MODES.map((value) => ({
    value,
    label: value === "restore_points" && status && !status.restorePoints.available ? `${WORKTREE_CLEANUP_LABELS[value]} (unavailable)` : WORKTREE_CLEANUP_LABELS[value],
    disabled: value === "restore_points" && !!status && !status.restorePoints.available && status.mode !== "restore_points",
  }));
}

const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;

/** What each mode does, with the day counts in force, for the row's "i" tip. */
export function worktreeCleanupInfo(status: WorktreeCleanupStatus | undefined): string {
  const d = status?.days;
  const strict = `Only when everything is pushed: removes a finished task's worktree ${d ? days(d.strictDelay) : "a day"} after its task tree closes, when the remote can rebuild it exactly. Unpushed or uncommitted work keeps it.`;
  const idle = d && d.idle > 0 ? ` An open task's worktree goes after ${days(d.idle)} with nothing happening.` : "";
  const restore = `Save a restore point, then remove: also removes worktrees with unpushed or uncommitted work, ${d ? days(d.restorePointDelay) : "3 days"} after the task tree closes, saving an encrypted restore point to file storage first${d ? `, kept ${days(d.retention)}` : ""}.${idle} A later run or a comment on the task brings it back.`;
  return `Whether Paperclip removes finished tasks' worktrees. Off keeps them. ${strict} ${restore} Either way a worktree with a live run is never touched. The day counts are environment variables (PAPERCLIP_GIT_RESTORE_POINT_TERMINAL_DELAY_DAYS, _IDLE_DAYS, _RETENTION_DAYS).`;
}

/** The state line under the choice: the environment fallback, a dry run, or why restore points can't be picked. */
export function worktreeCleanupNote(status: WorktreeCleanupStatus | undefined): string | null {
  if (!status) return null;
  const notes: string[] = [];
  if (status.source === "environment" && status.mode !== "off") {
    notes.push(`Set by the server's environment variables${status.dryRun ? ", as a dry run: nothing is removed yet" : ""}. Choosing here replaces them.`);
  }
  if (!status.restorePoints.available && status.restorePoints.reason) notes.push(`Restore points are unavailable: ${status.restorePoints.reason}`);
  return notes.length ? notes.join(" ") : null;
}

export type FeatureRowState = {
  checked: boolean;
  managed: boolean;
  /** Each requirement and whether it's on. */
  requirements: { key: InstanceFeatureKey; label: string; on: boolean }[];
  disabled: boolean;
  /** Why the switch can't be changed, beyond not being an admin or the settings still loading. */
  note: string | null;
};

const listLabels = (keys: InstanceFeatureKey[]) => {
  const labels = keys.map(featureLabel);
  return labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

export function featureRowState(flag: FeatureFlag, context: FeatureContext): FeatureRowState {
  const { settings } = context;
  const checked = isOn(settings, flag.key);
  const managed = isManaged(settings, flag.key);
  const requirements = (flag.requires ?? []).map((key) => ({ key, label: featureLabel(key), on: isOn(settings, key) }));
  const unmet = requirements.filter((requirement) => !requirement.on).map((requirement) => requirement.key);
  let note: string | null = null;
  if (managed) {
    note = "Managed by Paperclip Cloud.";
  } else if (!checked && unmet.length) {
    if (!flag.linked) note = `Turn on ${listLabels(unmet)} first.`;
    else if (unmet.some((key) => isFixed(context, key))) note = `Needs ${listLabels(unmet)}, which can't be changed here.`;
  } else if (checked) {
    const locked = linkedDependents(flag.key).filter((dependent) => isOn(settings, dependent.key) && isFixed(context, dependent.key));
    if (locked.length) note = `${listLabels(locked.map((dependent) => dependent.key))} needs this on.`;
  }
  return { checked, managed, requirements, disabled: !context.editable || !settings || note !== null, note };
}

/**
 * The PATCH for one switch: its key and new value, plus the linked changes. Turning Status cards on
 * also turns on Summaries; turning Summaries off also turns off Status cards.
 */
export function featurePatch(flag: FeatureFlag, value: boolean, settings: FeatureContext["settings"]): PatchInstanceExperimentalSettings {
  const patch: PatchInstanceExperimentalSettings = { [flag.key]: value };
  if (value && flag.linked) {
    for (const key of flag.requires ?? []) if (!isOn(settings, key)) patch[key] = true;
  }
  if (!value) {
    for (const dependent of linkedDependents(flag.key)) if (isOn(settings, dependent.key)) patch[dependent.key] = false;
  }
  return patch;
}

/** A linked change a switch makes beyond its own, for its help line ("Also turns on Summaries."). */
export function linkedNote(flag: FeatureFlag, settings: FeatureContext["settings"]): string | null {
  const checked = isOn(settings, flag.key);
  const also = Object.keys(featurePatch(flag, !checked, settings)).filter((key) => key !== flag.key) as InstanceFeatureKey[];
  if (!also.length) return null;
  return `${checked ? "Turning this off also turns off" : "Turning this on also turns on"} ${listLabels(also)}.`;
}
