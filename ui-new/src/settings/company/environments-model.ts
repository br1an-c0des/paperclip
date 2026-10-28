import type { Environment, EnvironmentDeleteBlastRadius } from "@paperclipai/shared";

/*
 * Environments (board 30's outline): where the organization's agents run. The list, the
 * instance-wide default, each one's probe, archive and delete. Creating and editing environments, custom images and the terminal
 * come later.
 */

const DRIVER_LABEL: Record<string, string> = { local: "This machine", ssh: "SSH", sandbox: "Sandbox", plugin: "Plugin" };

export function driverLabel(driver: string) {
  return DRIVER_LABEL[driver] ?? driver;
}

function meta(environment: Pick<Environment, "metadata">) {
  return (environment.metadata ?? {}) as Record<string, unknown>;
}

export function isManaged(environment: Pick<Environment, "metadata">) {
  return meta(environment).managedByPaperclip === true;
}

/*
 * The default environment is instance-wide (`defaultEnvironmentId` in `GET /instance/settings`),
 * while environments are per organization: agents in every organization that haven't picked one
 * run there. No default, or one this organization can't see, means the local environment.
 */
export function effectiveDefaultId(defaultEnvironmentId: string | null | undefined, environments: readonly Environment[] | undefined) {
  const list = environments ?? [];
  if (defaultEnvironmentId && list.some((environment) => environment.id === defaultEnvironmentId)) return defaultEnvironmentId;
  const local = list.filter((environment) => environment.driver === "local" && environment.status === "active");
  return (local.find(isManaged) ?? local[0])?.id ?? null;
}

/** What `PATCH /instance/settings` gets to make an environment the default: local is the fallback, null. */
export function defaultPatchId(environment: Pick<Environment, "id" | "driver">) {
  return environment.driver === "local" ? null : environment.id;
}

/** Active ones first (the default leading), then archived, each by name. */
export function sortEnvironments(environments: readonly Environment[] | undefined, defaultId: string | null) {
  return [...(environments ?? [])].sort(
    (a, b) =>
      Number(a.status === "archived") - Number(b.status === "archived") ||
      Number(b.id === defaultId) - Number(a.id === defaultId) ||
      a.name.localeCompare(b.name),
  );
}

const BLOCKED: Record<string, string> = {
  managed_local: "It's the built-in local environment.",
  instance_default: "It's the instance's default environment.",
  reusable_sandbox_lease: "Sandboxes kept for reuse still depend on it. Close their workspaces first.",
  pending_sandbox_cleanup: "A sandbox is still being cleaned up. Try again shortly.",
};

/** Why a delete isn't allowed, or what it would affect when it is. */
export function deleteSummary(radius: EnvironmentDeleteBlastRadius): { allowed: boolean; lines: string[] } {
  if (!radius.canDelete) return { allowed: false, lines: radius.deleteBlockedReasons.map((reason) => BLOCKED[reason] ?? reason) };
  const refs = radius.staticReferences;
  const lines: string[] = [];
  const count = (value: number, one: string, many: string) => value > 0 && lines.push(`${value} ${value === 1 ? one : many}`);
  count(refs.agentDefaultCount, "agent runs there by default", "agents run there by default");
  count(refs.projectSelectionCount, "project uses it", "projects use it");
  count(refs.issueSelectionCount, "task uses it", "tasks use it");
  count(refs.executionWorkspaceSelectionCount, "workspace uses it", "workspaces use it");
  count(refs.secretBindingCount, "secret is bound to it", "secrets are bound to it");
  if (radius.activeRuntimeUse.hasActiveRuntimeUse) lines.push("It's in use right now.");
  return { allowed: true, lines };
}
