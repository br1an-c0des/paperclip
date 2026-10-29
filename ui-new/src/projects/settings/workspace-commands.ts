import type { ProjectWorkspace } from "@paperclipai/shared";

/*
 * A project workspace's commands JSON (`runtimeConfig.workspaceRuntime`), as the old workspace
 * page edits it (ui/src/pages/ProjectWorkspaceDetail.tsx, "Advanced runtime JSON"): Paperclip
 * derives the workspace's services and jobs from it, and task checkouts inherit it unless they
 * override it. The text must be a JSON object, or empty to clear it. The server merges
 * `runtimeConfig`, so sending only `workspaceRuntime` keeps the desired service states.
 */

/** The old page's placeholder: one service and one job in the `commands` form. */
export const COMMANDS_EXAMPLE = `{
  "commands": [
    {
      "id": "web",
      "name": "web",
      "kind": "service",
      "command": "pnpm dev",
      "cwd": ".",
      "port": { "type": "auto" },
      "readiness": { "type": "http", "urlTemplate": "http://127.0.0.1:\${port}" },
      "expose": { "type": "url", "urlTemplate": "http://127.0.0.1:\${port}" },
      "lifecycle": "shared",
      "reuseScope": "project_workspace"
    },
    {
      "id": "db-migrate",
      "name": "db:migrate",
      "kind": "job",
      "command": "pnpm db:migrate",
      "cwd": "."
    }
  ]
}`;

/** The saved commands as editable text: pretty JSON, or empty when there are none. */
export function commandsText(workspace?: Pick<ProjectWorkspace, "runtimeConfig">): string {
  const runtime = workspace?.runtimeConfig?.workspaceRuntime;
  if (!runtime || Object.keys(runtime).length === 0) return "";
  return JSON.stringify(runtime, null, 2);
}

export type ParsedCommands = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string };

/** Empty text clears the commands; anything else must parse to a JSON object. */
export function parseCommands(text: string): ParsedCommands {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "The workspace commands must be a JSON object, such as { \"commands\": [ … ] }." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: `The workspace commands aren't valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * What to add to a workspace's create or update request for the commands: nothing when they're
 * unchanged (compared as parsed JSON, so reformatting isn't a change), or a problem to show.
 */
export function commandsRequest(
  workspace: Pick<ProjectWorkspace, "runtimeConfig"> | undefined,
  text: string,
): { kind: "none" } | { kind: "problem"; message: string } | { kind: "set"; data: { runtimeConfig: { workspaceRuntime: Record<string, unknown> | null } } } {
  const parsed = parseCommands(text);
  if (!parsed.ok) return { kind: "problem", message: parsed.error };
  const before = parseCommands(commandsText(workspace));
  const same = before.ok && JSON.stringify(before.value) === JSON.stringify(parsed.value);
  if (same) return { kind: "none" };
  return { kind: "set", data: { runtimeConfig: { workspaceRuntime: parsed.value } } };
}

export type CommandEntry = { name: string; kind: "service" | "job" };

/** The named commands, for the workspace's row: `commands` entries, or the legacy `services` list. */
export function commandEntries(workspace: Pick<ProjectWorkspace, "runtimeConfig">): CommandEntry[] {
  const runtime = workspace.runtimeConfig?.workspaceRuntime;
  if (!runtime) return [];
  const list = (key: string) => (Array.isArray(runtime[key]) ? (runtime[key] as unknown[]) : []);
  const name = (entry: Record<string, unknown>, index: number) =>
    [entry.name, entry.id, entry.command].find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? `Command ${index + 1}`;
  const records = (items: unknown[]) => items.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry));
  const commands = records(list("commands")).map((entry, index) => ({ name: name(entry, index), kind: entry.kind === "job" ? ("job" as const) : ("service" as const) }));
  if (commands.length > 0) return commands;
  return records(list("services")).map((entry, index) => ({ name: name(entry, index), kind: "service" as const }));
}
