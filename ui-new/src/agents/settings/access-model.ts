import {
  AGENT_ACCESS_ACTIONS,
  AGENT_ACCESS_LEVEL_ACTIONS,
  AGENT_ACCESS_LEVELS,
  DEFAULT_AGENT_ACCESS_LEVEL,
  resolveAgentAccess,
  type AgentAccess,
  type AgentAccessAction,
  type AgentAccessLevel,
  type AgentAccessOverride,
} from "@paperclipai/shared";

/*
 * An agent's access (step 4a, fork/step-4a-mcp-and-permissions.md section 2): a level, which allows
 * a fixed set of actions, and overrides that turn single actions on or off for this agent. It's
 * stored at `permissions.access` and saved whole with `PATCH /agents/:id/permissions`
 * `{ access: { level, overrides } }` (only a person may). An agent with nothing stored is at the
 * default level (worker). The level table and the action list are the shared module's, so the
 * card and the server can't disagree; this file only adds the words and the edits.
 *
 * An override is `true`, `false`, or `{ scope }` (allowed within a scope, set through the API). The
 * card never writes a scope; turning a scoped action off replaces it with `false`.
 */

export const ACCESS_LEVELS: readonly AgentAccessLevel[] = AGENT_ACCESS_LEVELS;
export const ACCESS_ACTIONS: readonly AgentAccessAction[] = AGENT_ACCESS_ACTIONS;

/** The level picker's words. A `Record` over the shared type, so a new level fails the typecheck here. */
export const LEVEL_WORDS: Record<AgentAccessLevel, { label: string; description: string }> = {
  read_only: { label: "Read only", description: "Reads tasks, projects and agents, and changes nothing." },
  worker: { label: "Worker", description: "Works its own tasks: comments, updates them, creates subtasks and asks the board." },
  manager: { label: "Manager", description: "Also changes and assigns anyone's tasks, and manages labels and projects." },
  admin: { label: "Admin", description: "Also configures and hires agents, and may call the whole API." },
};

/** Every action's words. */
export const ACTION_WORDS: Record<AgentAccessAction, { label: string; help: string }> = {
  "tasks:read": { label: "Read tasks", help: "Read tasks, comments, documents, projects, agents and labels, and search them." },
  "tasks:comment": { label: "Comment", help: "Comment on tasks it can read." },
  "tasks:update_own": {
    label: "Update its own tasks",
    help: "Change the status, fields, labels and documents of tasks assigned to it, created by it or below those, and archive them.",
  },
  "tasks:create": { label: "Create tasks", help: "Create tasks, create subtasks of its own tasks and assign them to anyone, and hand its own task off." },
  "requests:create": { label: "Ask the board", help: "Ask the board a question or request an approval." },
  "tasks:update_any": { label: "Update anyone's tasks", help: "Change and archive tasks it doesn't own." },
  "tasks:assign": { label: "Assign tasks", help: "Assign or reassign any task to agents and people." },
  "labels:manage": { label: "Manage labels", help: "Create, rename and delete the company's labels." },
  "projects:manage": { label: "Manage projects", help: "Create and update projects, goals and routines." },
  "agents:configure": { label: "Configure agents", help: "Change other agents' settings, instructions and skills." },
  "agents:create": { label: "Hire agents", help: "Create or hire agents." },
  "api:raw": { label: "Call the whole API", help: "Use call_api to make any Paperclip API request, beyond its tools." },
  "tasks:delete": { label: "Delete tasks", help: "Delete tasks for good. No level includes this; only turning it on here grants it." },
};

/** The agent's stored access, or the default level with no overrides when nothing is stored. */
export function storedAccess(permissions: { access?: AgentAccess | null } | null | undefined): AgentAccess {
  const access = permissions?.access;
  if (!access || !ACCESS_LEVELS.includes(access.level)) return { level: DEFAULT_AGENT_ACCESS_LEVEL };
  return { level: access.level, ...(access.overrides ? { overrides: { ...access.overrides } } : {}) };
}

/** Whether `level` allows `action` by itself. */
export function levelAllows(level: AgentAccessLevel, action: AgentAccessAction): boolean {
  return AGENT_ACCESS_LEVEL_ACTIONS[level].includes(action);
}

/** Actions no level includes, which only an override grants (`tasks:delete`). */
export function overrideOnly(action: AgentAccessAction): boolean {
  return !ACCESS_LEVELS.some((level) => levelAllows(level, action));
}

/** The lowest level that allows `action`, or null for an override-only action. */
export function lowestLevel(action: AgentAccessAction): AgentAccessLevel | null {
  return ACCESS_LEVELS.find((level) => levelAllows(level, action)) ?? null;
}

export type ActionRow = {
  action: AgentAccessAction;
  label: string;
  help: string;
  /** What the agent may do now: the override, else the level's default. A scope counts as allowed. */
  allowed: boolean;
  /** What the level alone gives. */
  levelDefault: boolean;
  /** The agent's own setting for the action, if any. */
  override: AgentAccessOverride | undefined;
  scoped: boolean;
  overrideOnly: boolean;
};

/** One row per action, in the shared order. */
export function actionRows(access: AgentAccess): ActionRow[] {
  const resolved = resolveAgentAccess(access);
  return ACCESS_ACTIONS.map((action) => {
    const override = access.overrides?.[action];
    const value = resolved[action];
    return {
      action,
      ...ACTION_WORDS[action],
      allowed: value === true || (typeof value === "object" && value !== null),
      levelDefault: levelAllows(access.level, action),
      override,
      scoped: typeof override === "object" && override !== null,
      overrideOnly: overrideOnly(action),
    };
  });
}

/**
 * The visible note under an action: what the level gives, or what its scope or override-only rule
 * means. It's state, so it stays out of the info tip; "Set for this agent" is shown beside it.
 */
export function defaultNote(row: ActionRow, level: AgentAccessLevel): string {
  if (row.scoped) return "Allowed within a scope set through the API.";
  if (row.overrideOnly) return row.override === undefined ? "Off unless turned on here." : "No level includes it.";
  return `${LEVEL_WORDS[level].label} has it ${row.levelDefault ? "on" : "off"}.`;
}

function tidy(level: AgentAccessLevel, overrides: Partial<Record<AgentAccessAction, AgentAccessOverride>>): AgentAccess {
  return Object.keys(overrides).length ? { level, overrides } : { level };
}

/**
 * A new level. Overrides that say what the new level already gives are dropped, since they'd change
 * nothing; scoped ones and the others stay.
 */
export function withLevel(access: AgentAccess, level: AgentAccessLevel): AgentAccess {
  const overrides: Partial<Record<AgentAccessAction, AgentAccessOverride>> = {};
  for (const [action, value] of Object.entries(access.overrides ?? {}) as [AgentAccessAction, AgentAccessOverride | undefined][]) {
    if (value === undefined) continue;
    if (typeof value === "boolean" && value === levelAllows(level, action)) continue;
    overrides[action] = value;
  }
  return tidy(level, overrides);
}

/**
 * One action turned on or off. A value the level already gives removes the override instead of
 * storing a copy of the default.
 */
export function withAction(access: AgentAccess, action: AgentAccessAction, allowed: boolean): AgentAccess {
  const overrides = { ...(access.overrides ?? {}) };
  if (allowed === levelAllows(access.level, action)) delete overrides[action];
  else overrides[action] = allowed;
  return tidy(access.level, overrides);
}

/** One action back to its level's default. */
export function withoutOverride(access: AgentAccess, action: AgentAccessAction): AgentAccess {
  const overrides = { ...(access.overrides ?? {}) };
  delete overrides[action];
  return tidy(access.level, overrides);
}

/** How many actions have the agent's own setting. */
export function overrideCount(access: AgentAccess): number {
  return Object.values(access.overrides ?? {}).filter((value) => value !== undefined).length;
}

/** The card's one-line state: the level, and how many actions are set for this agent. */
export function accessSummary(access: AgentAccess): string {
  const count = overrideCount(access);
  const level = LEVEL_WORDS[access.level].label;
  return count ? `${level}, with ${count === 1 ? "1 action" : `${count} actions`} set for this agent.` : `${level}.`;
}
