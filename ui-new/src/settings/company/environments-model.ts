import type { AgentEnvConfig, Environment, EnvironmentCapabilities, EnvironmentDeleteBlastRadius } from "@paperclipai/shared";
import type { EnvironmentInput } from "@/api/environments";
import type { JsonSchemaNode } from "@/plugins/schema-form";

/*
 * Environments (board 30's outline): where the organization's agents run. The list, the
 * instance-wide default, each one's probe, archive and delete, and the form that creates and edits
 * one (ui/src/pages/CompanyEnvironments.tsx): an SSH host or a sandbox provider's settings, and the
 * variables runs there get. Custom images and the terminal are on hold (decision 39, D7).
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

/**
 * A plugin environment the managed config declares (#19490): marked `managedByPaperclip` like the
 * managed sandbox and the local slot, plus `managedPluginEnvironment: "<pluginKey>:<driverKey>"`.
 * It is never the managed sandbox, which is a `sandbox` row.
 */
export function isManagedPluginEnvironment(environment: Pick<Environment, "metadata">) {
  const marker = meta(environment).managedPluginEnvironment;
  return typeof marker === "string" && marker.length > 0;
}

/**
 * What Edit can change. A managed row keeps its name and settings, but its variables are the
 * organization's (the managed sandbox's env-vars contract), except on a managed plugin row: the
 * server hides its variables and refuses edits to them on a cloud-managed instance. A plugin row
 * someone made keeps its plugin settings (this page has no form for them), so only its variables.
 */
export function editScope(environment: Pick<Environment, "driver" | "metadata">): "all" | "variables" | "none" {
  if (isManagedPluginEnvironment(environment)) return "none";
  return isManaged(environment) || environment.driver === "plugin" ? "variables" : "all";
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
  pending_sandbox_cleanup: "A sandbox is still being cleaned up. Try again shortly.",
};

/**
 * Why a delete isn't allowed, or what it would affect when it is. Kept sandboxes are the one block
 * a person can lift: with `destroyLeases` the delete destroys them first, as the old page's consent
 * box does; `leaseConsent` says that's the only thing in the way. Some of them may be a failed
 * run's workspace copy, the only copy of its files (`retain_on_failure`, #20085), and the summary
 * says destroying one loses them.
 */
export function deleteSummary(radius: EnvironmentDeleteBlastRadius, destroyLeases = false): { allowed: boolean; lines: string[]; leaseConsent: boolean } {
  const leaseOnly = radius.deleteBlockedReasons.length > 0 && radius.deleteBlockedReasons.every((reason) => reason === "reusable_sandbox_lease");
  const kept = keptSandboxes(radius);
  if (!radius.canDelete && !(leaseOnly && destroyLeases)) {
    if (leaseOnly) {
      // Closing a workspace frees a sandbox kept for reuse, not a failed run's copy.
      const next = kept.recovery === kept.total ? `Destroy ${kept.total === 1 ? "it" : "them"} with the delete to go ahead.` : "Close their workspaces first, or destroy them with the delete.";
      return { allowed: false, leaseConsent: true, lines: [`${reusableLeaseLine(radius)} ${next}`, ...recoveryLine(kept)] };
    }
    return {
      allowed: false,
      leaseConsent: false,
      lines: radius.deleteBlockedReasons.map((reason) => (reason === "reusable_sandbox_lease" ? reusableLeaseLine(radius) : (BLOCKED[reason] ?? reason))),
    };
  }
  const refs = radius.staticReferences;
  const lines: string[] = [];
  const count = (value: number, one: string, many: string) => value > 0 && lines.push(`${value} ${value === 1 ? one : many}`);
  count(refs.agentDefaultCount, "agent runs there by default", "agents run there by default");
  count(refs.projectSelectionCount, "project uses it", "projects use it");
  count(refs.issueSelectionCount, "task uses it", "tasks use it");
  count(refs.executionWorkspaceSelectionCount, "workspace uses it", "workspaces use it");
  count(refs.secretBindingCount, "secret is bound to it", "secrets are bound to it");
  if (leaseOnly) lines.push(`${reusableLeaseLine(radius)} ${kept.total === 1 ? "It's" : "They're"} destroyed with it.`, ...recoveryLine(kept));
  if (radius.activeRuntimeUse.hasActiveRuntimeUse) lines.push("It's in use right now.");
  return { allowed: true, lines, leaseConsent: leaseOnly };
}

/** How many sandboxes the environment keeps, and how many of them hold a failed run's files. */
export function keptSandboxes(radius: EnvironmentDeleteBlastRadius) {
  const holders = radius.reusableSandboxLeaseHolders ?? [];
  const total = radius.reusableSandboxLeaseCount || holders.length;
  const recovery = Math.min(total, holders.filter((holder) => holder.leasePolicy === "retain_on_failure").length);
  return { total, recovery };
}

/**
 * "2 sandboxes are kept for reuse (Workspace A, PAP-12)." Once one of them is a failed run's
 * workspace copy, "for reuse" no longer fits: "3 sandboxes are kept (…).", or when all of them are,
 * "A failed run's workspace copy is kept for file recovery (PAP-12)."
 */
export function reusableLeaseLine(radius: EnvironmentDeleteBlastRadius) {
  const { total, recovery } = keptSandboxes(radius);
  const holders = [...new Set((radius.reusableSandboxLeaseHolders ?? []).map((holder) => holder.executionWorkspaceName ?? holder.issueIdentifier).filter(Boolean))];
  const named = holders.length ? ` (${holders.slice(0, 3).join(", ")}${holders.length > 3 ? "…" : ""})` : "";
  if (recovery > 0 && recovery === total) {
    return `${total === 1 ? "A failed run's workspace copy is" : `${total} failed runs' workspace copies are`} kept for file recovery${named}.`;
  }
  return `${total === 1 ? "A sandbox is" : `${total} sandboxes are`} kept${recovery ? "" : " for reuse"}${named}.`;
}

/**
 * The old page's warning (#20085): "1 of them is a failed run's workspace copy kept for file
 * recovery; destroying it loses the files only it holds." Its plural keeps the singular noun; this
 * one agrees ("2 of them are failed runs' workspace copies …").
 */
function recoveryLine({ total, recovery }: { total: number; recovery: number }): string[] {
  if (!recovery) return [];
  if (recovery === total) return [`Destroying ${total === 1 ? "it loses the files only it holds" : "them loses the files only they hold"}.`];
  return [
    recovery === 1
      ? "1 of them is a failed run's workspace copy kept for file recovery; destroying it loses the files only it holds."
      : `${recovery} of them are failed runs' workspace copies kept for file recovery; destroying them loses the files only they hold.`,
  ];
}

/** The consent box's label. */
export function leaseConsentLabel(radius: EnvironmentDeleteBlastRadius) {
  const { total, recovery } = keptSandboxes(radius);
  if (!recovery) return "Destroy the sandboxes kept for reuse. Work left in them is lost.";
  if (recovery === total) return total === 1 ? "Destroy the failed run's workspace copy. The files only it holds are lost." : "Destroy the failed runs' workspace copies. The files only they hold are lost.";
  return `Destroy the kept sandboxes, including ${recovery === 1 ? "a failed run's workspace copy" : `${recovery} failed runs' workspace copies`}. Work and files left in them are lost.`;
}

/** The success toast's note: "Destroyed 2 sandboxes kept for reuse." */
export function destroyedSandboxesNote(destroyed: number, radius: EnvironmentDeleteBlastRadius | undefined) {
  if (!destroyed) return null;
  const forReuse = !radius || keptSandboxes(radius).recovery === 0;
  return `Destroyed ${destroyed === 1 ? "1 sandbox" : `${destroyed} sandboxes`}${forReuse ? " kept for reuse" : ""}.`;
}

/**
 * The organization's agents whose default environment this is, other than terminated ones. Agents
 * in other organizations (environments are instance-wide) can't be listed here; they fall back to
 * the instance default.
 */
export function agentsOnEnvironment<T extends { status: string; defaultEnvironmentId?: string | null }>(agents: readonly T[] | undefined, environmentId: string) {
  return (agents ?? []).filter((agent) => agent.status !== "terminated" && agent.defaultEnvironmentId === environmentId);
}

/** Where those agents can move: another active, non-local environment; or the default (`null`). */
export function reassignTargets(environments: readonly Environment[] | undefined, environmentId: string) {
  return (environments ?? []).filter((environment) => environment.id !== environmentId && environment.status === "active" && environment.driver !== "local");
}

/** Agents it can't name (other organizations, terminated ones) when the server counts more. */
export function unlistedAgentCount(radius: EnvironmentDeleteBlastRadius, listed: number) {
  return Math.max(0, radius.staticReferences.agentDefaultCount - listed);
}

// ---------------------------------------------------------------------------------------------
// Creating and editing

export type EnvironmentFormDriver = "local" | "ssh" | "sandbox";

/** The form's fields, as the old page's `EnvironmentFormState`; variables are edited as rows apart. */
export type EnvironmentForm = {
  name: string;
  description: string;
  driver: EnvironmentFormDriver;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshRemoteWorkspacePath: string;
  /** A pasted key; it's stored as a secret on save and never read back. */
  sshPrivateKey: string;
  /** Or one of the company's secrets. */
  sshPrivateKeySecretId: string;
  sshKnownHosts: string;
  sshStrictHostKeyChecking: boolean;
  /**
   * How Paperclip reaches the host (U156): directly, or through one of the company's Tailscale
   * networks, which saves the tailnet and the machine's stable id. The host is the machine's
   * current address, looked up again for each run.
   */
  sshNetwork: SshNetwork;
  tailscaleConnectionId: string;
  tailscaleDeviceId: string;
  /**
   * Run on the remote user's own provider sign-in instead of the agent's AI account (U157,
   * `useHostAuth`). New environments start off; saved ones without the field are on.
   */
  sshUseHostAuth: boolean;
  sandboxProvider: string;
  sandboxConfig: Record<string, unknown>;
};

export type SshNetwork = "direct" | "tailscale";

/** A new environment; `tailscaleConnectionId` starts it on that tailnet (from Connections → Tailscale). */
export function emptyEnvironmentForm(options: { tailscaleConnectionId?: string } = {}): EnvironmentForm {
  return {
    name: "",
    description: "",
    driver: "ssh",
    sshNetwork: options.tailscaleConnectionId ? "tailscale" : "direct",
    tailscaleConnectionId: options.tailscaleConnectionId ?? "",
    tailscaleDeviceId: "",
    sshUseHostAuth: false,
    sshHost: "",
    sshPort: "22",
    sshUsername: "",
    sshRemoteWorkspacePath: "",
    sshPrivateKey: "",
    sshPrivateKeySecretId: "",
    sshKnownHosts: "",
    sshStrictHostKeyChecking: true,
    sandboxProvider: "",
    sandboxConfig: {},
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The form for a saved environment. A saved private key is never sent back, so its field starts empty. */
export function environmentForm(environment: Environment): EnvironmentForm {
  const base = { ...emptyEnvironmentForm(), name: environment.name, description: environment.description ?? "" };
  const config = environment.config ?? {};
  if (environment.driver === "ssh") {
    const ref = config.privateKeySecretRef as { secretId?: unknown } | null | undefined;
    return {
      ...base,
      driver: "ssh",
      sshHost: text(config.host),
      sshPort: typeof config.port === "number" ? String(config.port) : text(config.port) || "22",
      sshUsername: text(config.username),
      sshRemoteWorkspacePath: text(config.remoteWorkspacePath),
      sshPrivateKeySecretId: ref && typeof ref === "object" && typeof ref.secretId === "string" ? ref.secretId : "",
      sshKnownHosts: text(config.knownHosts),
      sshStrictHostKeyChecking: typeof config.strictHostKeyChecking === "boolean" ? config.strictHostKeyChecking : true,
      sshNetwork: config.network === "tailscale" ? "tailscale" : "direct",
      tailscaleConnectionId: text(config.tailscaleConnectionId),
      tailscaleDeviceId: text(config.tailscaleDeviceId),
      // Saved before #21248: no field means the remote machine's own sign-in.
      sshUseHostAuth: config.useHostAuth !== false,
    };
  }
  if (environment.driver === "sandbox") {
    const { provider, ...rest } = config;
    return { ...base, driver: "sandbox", sandboxProvider: text(provider).trim() || "fake", sandboxConfig: rest };
  }
  return { ...base, driver: "local" };
}

/** What `POST /companies/:id/environments`, `PATCH /environments/:id` and `probe-config` get. */
export function environmentPayload(form: EnvironmentForm, envVars: AgentEnvConfig): EnvironmentInput {
  const pastedKey = form.sshPrivateKey.trim();
  const config =
    form.driver === "ssh"
      ? {
          useHostAuth: form.sshUseHostAuth,
          ...(form.sshNetwork === "tailscale"
            ? { network: "tailscale", tailscaleConnectionId: form.tailscaleConnectionId, tailscaleDeviceId: form.tailscaleDeviceId }
            : { network: "direct" }),
          host: form.sshHost.trim(),
          port: Number.parseInt(form.sshPort || "22", 10) || 22,
          username: form.sshUsername.trim(),
          remoteWorkspacePath: form.sshRemoteWorkspacePath.trim(),
          privateKey: pastedKey || null,
          privateKeySecretRef:
            pastedKey || !form.sshPrivateKeySecretId ? null : { type: "secret_ref", secretId: form.sshPrivateKeySecretId, version: "latest" },
          knownHosts: form.sshKnownHosts.trim() || null,
          strictHostKeyChecking: form.sshStrictHostKeyChecking,
        }
      : form.driver === "sandbox"
        ? { provider: form.sandboxProvider.trim(), ...form.sandboxConfig }
        : {};
  return { name: form.name.trim(), description: form.description.trim() || null, driver: form.driver, config, envVars };
}

/** Why the form can't be saved or probed yet, or null. Sandbox settings are checked against their schema apart. */
export function environmentFormProblem(form: EnvironmentForm): string | null {
  if (!form.name.trim()) return "Give the environment a name.";
  if (form.driver === "ssh") {
    if (form.sshNetwork === "tailscale" && !form.tailscaleConnectionId) return "Pick a Tailscale network.";
    if (form.sshNetwork === "tailscale" && !form.tailscaleDeviceId) return "Pick a Tailscale machine.";
    if (!form.sshHost.trim()) return "Enter the SSH host.";
    if (!form.sshUsername.trim()) return "Enter the SSH username.";
    if (!form.sshRemoteWorkspacePath.trim()) return "Enter the remote workspace path.";
    const port = Number(form.sshPort || "22");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "The port is a number from 1 to 65535.";
  }
  if (form.driver === "sandbox" && (!form.sandboxProvider.trim() || form.sandboxProvider === "fake")) return "Pick a sandbox provider.";
  return null;
}

/**
 * Switching the network starts the connection over, as the old form does: the tailnet, machine,
 * host, key and known hosts belong to the old route. Switching to Direct also drops the saved
 * Tailscale machine on save.
 */
export function networkPatch(network: SshNetwork): Partial<EnvironmentForm> {
  return { sshNetwork: network, tailscaleConnectionId: "", tailscaleDeviceId: "", sshHost: "", sshPrivateKey: "", sshPrivateKeySecretId: "", sshKnownHosts: "" };
}

/** A new tailnet or machine: its address, and a key and known hosts that must be paired again. */
export function machinePatch(selection: { connectionId: string; deviceId: string; host: string }): Partial<EnvironmentForm> {
  return {
    tailscaleConnectionId: selection.connectionId,
    tailscaleDeviceId: selection.deviceId,
    sshHost: selection.host,
    sshPrivateKey: "",
    sshPrivateKeySecretId: "",
    sshKnownHosts: "",
  };
}

/**
 * Why Test waits, or null. The server resolves a Tailscale machine through the saved connection, so
 * a Tailscale draft is tested from the list once it's saved.
 */
export function draftTestBlock(form: Pick<EnvironmentForm, "driver" | "sshNetwork">): string | null {
  return form.driver === "ssh" && form.sshNetwork === "tailscale" ? "Save it first, then test it from the list." : null;
}

export type SandboxProviderOption ={ provider: string; displayName: string; description?: string; configSchema: JsonSchemaNode | null };

/**
 * The sandbox providers a new environment can use: installed providers that can run agents, without
 * the built-in test provider, by name. A saved environment's provider stays listed even when its
 * plugin is gone, so editing it doesn't silently switch providers.
 */
export function sandboxProviders(capabilities: EnvironmentCapabilities | undefined, current?: string): SandboxProviderOption[] {
  const options: SandboxProviderOption[] = Object.entries(capabilities?.sandboxProviders ?? {})
    .filter(([provider, capability]) => provider !== "fake" && capability.supportsRunExecution)
    .map(([provider, capability]) => ({
      provider,
      displayName: capability.displayName || provider,
      description: capability.description,
      configSchema:
        capability.configSchema && typeof capability.configSchema === "object" && !Array.isArray(capability.configSchema)
          ? (capability.configSchema as JsonSchemaNode)
          : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (current && current !== "fake" && !options.some((option) => option.provider === current)) {
    options.push({ provider: current, displayName: current, configSchema: null });
  }
  return options;
}

/** The second line of a list row: where an SSH environment points, or its sandbox provider. */
export function environmentSummary(environment: Environment, providerName?: string): string | null {
  const config = environment.config ?? {};
  if (environment.driver === "ssh") {
    const host = text(config.host);
    const user = text(config.username);
    const where = host ? `${user ? `${user}@` : ""}${host}` : null;
    return config.network === "tailscale" ? [where, "via Tailscale"].filter(Boolean).join(" ") : where;
  }
  if (environment.driver === "sandbox") {
    const detail = ["template", "image", "region", "workspacePath"].map((key) => text(config[key]).trim()).find(Boolean);
    if (isManaged(environment)) return detail ?? null;
    return [`${providerName ?? (text(config.provider) || "sandbox")} sandbox`, detail].filter(Boolean).join(" · ");
  }
  if (environment.driver === "plugin") {
    const plugin = text(config.pluginKey).trim();
    return plugin ? [plugin, text(config.driverKey).trim()].filter(Boolean).join(" · ") : null;
  }
  return null;
}
