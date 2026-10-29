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
  sandboxProvider: string;
  sandboxConfig: Record<string, unknown>;
};

export function emptyEnvironmentForm(): EnvironmentForm {
  return {
    name: "",
    description: "",
    driver: "ssh",
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
    if (!form.sshHost.trim()) return "Enter the SSH host.";
    if (!form.sshUsername.trim()) return "Enter the SSH username.";
    if (!form.sshRemoteWorkspacePath.trim()) return "Enter the remote workspace path.";
    const port = Number(form.sshPort || "22");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "The port is a number from 1 to 65535.";
  }
  if (form.driver === "sandbox" && (!form.sandboxProvider.trim() || form.sandboxProvider === "fake")) return "Pick a sandbox provider.";
  return null;
}

export type SandboxProviderOption = { provider: string; displayName: string; description?: string; configSchema: JsonSchemaNode | null };

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
    return host ? `${user ? `${user}@` : ""}${host}` : null;
  }
  if (environment.driver === "sandbox") {
    const detail = ["template", "image", "region", "workspacePath"].map((key) => text(config[key]).trim()).find(Boolean);
    if (isManaged(environment)) return detail ?? null;
    return [`${providerName ?? (text(config.provider) || "sandbox")} sandbox`, detail].filter(Boolean).join(" · ");
  }
  return null;
}
