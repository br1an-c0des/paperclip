import type { ChatExecutionDefaults, Project, TaskWorkspaceSelection } from "@paperclipai/shared";

/*
 * Task defaults for chat endpoints (src/apps/chat/TaskDefaults.tsx): which project and workspace a
 * new conversation's task gets, for the whole endpoint or one channel or repository. A key left out
 * inherits (the endpoint's defaults, then the project's or the task's); `null` clears it. Rules
 * follow ui/src/pages/apps/chat/ChatExecutionDefaults.tsx.
 */

/** The select's value for a workspace choice. */
export function workspaceKey(value: TaskWorkspaceSelection | null | undefined): string {
  if (value === undefined) return "inherit";
  if (value === null) return "clear";
  if (value.kind === "task_directory") return "task";
  if (value.kind === "existing") return `existing:${value.workspaceId}`;
  return `source:${value.projectWorkspaceId}:${value.mode}`;
}

export function projectKey(defaults: ChatExecutionDefaults) {
  return defaults.projectId === undefined ? "inherit" : (defaults.projectId ?? "none");
}

/** Every workspace a task may start in: its own folder, a project's checkout or folder, or an existing one. */
export function workspaceChoices(
  projects: ReadonlyArray<Pick<Project, "workspaces">>,
  existing: ReadonlyArray<{ id: string }>,
): Map<string, TaskWorkspaceSelection> {
  const choices = new Map<string, TaskWorkspaceSelection>();
  choices.set("task", { kind: "task_directory" });
  for (const project of projects) {
    for (const source of project.workspaces ?? []) {
      for (const mode of ["managed_isolated", "shared"] as const) {
        choices.set(`source:${source.id}:${mode}`, { kind: "configured_source", projectWorkspaceId: source.id, mode });
      }
    }
  }
  for (const workspace of existing) choices.set(`existing:${workspace.id}`, { kind: "existing", workspaceId: workspace.id });
  return choices;
}

export function withProject(defaults: ChatExecutionDefaults, key: string): ChatExecutionDefaults {
  const { projectId: _previous, ...rest } = defaults;
  if (key === "inherit") return rest;
  return { ...rest, projectId: key === "none" ? null : key };
}

export function withWorkspace(defaults: ChatExecutionDefaults, key: string, choices: Map<string, TaskWorkspaceSelection>): ChatExecutionDefaults {
  const { workspace: _previous, ...rest } = defaults;
  if (key === "inherit") return rest;
  if (key === "clear") return { ...rest, workspace: null };
  const workspace = choices.get(key);
  return workspace ? { ...rest, workspace } : defaults;
}

/** What to save: nothing set means no defaults at all. */
export function defaultsPayload(defaults: ChatExecutionDefaults): ChatExecutionDefaults | null {
  return Object.keys(defaults).length > 0 ? defaults : null;
}
