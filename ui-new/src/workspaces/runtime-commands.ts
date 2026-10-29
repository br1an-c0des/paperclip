import type { WorkspaceCommandDefinition, WorkspaceRuntimeService } from "@paperclipai/shared";

/*
 * The services and jobs a workspace's runtime config defines (`config.workspaceRuntime`), matched to
 * the services that have run, for starting a service that has never run and running a job once
 * (`POST /execution-workspaces/:id/runtime-commands/:action`). The reading and matching follow the
 * shared package's `listWorkspaceCommandDefinitions` and `matchWorkspaceRuntimeServiceToCommand`
 * (packages/shared/src/workspace-commands.ts), and the grouping the old UI's
 * `buildWorkspaceRuntimeControlSections` (ui/src/components/WorkspaceRuntimeControls.tsx). ui-new
 * imports the shared package's types only, so the logic is kept here; check it at each sync.
 *
 * - A config lists `commands` (each a service unless `kind: "job"`), or else `services` and `jobs`.
 * - A command's id is its own, else its kind and slugged name, made unique.
 * - A running service matches the command with the same config index, else the best score on port,
 *   name, command and folder. One the config no longer defines shows apart, to be stopped.
 */

type Command = Omit<WorkspaceCommandDefinition, "rawConfig" | "source"> & { source: WorkspaceCommandDefinition["source"] };

export type RuntimeControl = {
  key: string;
  title: string;
  kind: "service" | "job";
  /** The service's status, "stopped" for one that hasn't run, or "run once" for a job. */
  status: string;
  healthStatus: WorkspaceRuntimeService["healthStatus"] | null;
  command: string | null;
  cwd: string | null;
  port: number | null;
  url: string | null;
  workspaceCommandId: string | null;
  runtimeServiceId: string | null;
  serviceIndex: number | null;
  /** Why it can't be started or run, if it can't. */
  disabledReason: string | null;
};

export type RuntimeControlSections = { services: RuntimeControl[]; jobs: RuntimeControl[]; otherServices: RuntimeControl[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readPort(value: unknown): number | null {
  if (isRecord(value) && value.type === "auto") return null;
  const candidate = isRecord(value) ? value.value : value;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 && candidate <= 65_535 ? candidate : null;
}

function slugify(value: string | null | undefined) {
  const slug = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

function entries(runtime: Record<string, unknown>, key: "commands" | "services" | "jobs") {
  const raw = runtime[key];
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

/** The commands a runtime config defines, services first. */
export function commandDefinitions(runtime: Record<string, unknown> | null | undefined): Command[] {
  if (!runtime) return [];
  const seen = new Set<string>();
  let nextService = 0;
  const build = (entry: Record<string, unknown>, kind: "service" | "job", key: "commands" | "services" | "jobs", index: number): Command => {
    const fallback = kind === "job" ? `Job ${index + 1}` : `Service ${index + 1}`;
    const name = readText(entry.name) ?? readText(entry.label) ?? readText(entry.title) ?? fallback;
    let id = slugify(readText(entry.id)) ?? (slugify(name) ? `${kind}:${slugify(name)}` : `${kind}:${index + 1}`);
    if (seen.has(id)) id = `${id}-${key}-${index + 1}`;
    seen.add(id);
    return {
      id,
      name,
      kind,
      command: readText(entry.command),
      cwd: readText(entry.cwd),
      port: readPort(entry.port),
      lifecycle: kind === "service" ? (entry.lifecycle === "ephemeral" ? "ephemeral" : "shared") : null,
      serviceIndex: kind === "service" ? nextService++ : null,
      disabledReason: readText(entry.disabledReason),
      source: { type: "paperclip", key, index },
    };
  };
  const commands = entries(runtime, "commands");
  if (commands.length > 0) return commands.map((entry, index) => build(entry, entry.kind === "job" ? "job" : "service", "commands", index));
  return [
    ...entries(runtime, "services").map((entry, index) => build(entry, "service", "services", index)),
    ...entries(runtime, "jobs").map((entry, index) => build(entry, "job", "jobs", index)),
  ];
}

type Candidate = Pick<WorkspaceRuntimeService, "configIndex" | "serviceName" | "command" | "cwd" | "port" | "exposure">;

/** How well a running service matches a command; below 1 is no match. */
export function matchScore(command: Pick<Command, "serviceIndex" | "name" | "command" | "cwd" | "port">, service: Candidate) {
  // A service exposed over HTTPS runs a rewritten command, so its command can't be compared.
  const exposed = service.exposure?.provider === "tailscale_https";
  if (command.command && service.command && service.command !== command.command && !exposed) return -1;
  if (command.port !== null && service.port != null && service.port !== command.port) return -1;
  if (command.serviceIndex !== null && service.configIndex !== null && service.configIndex !== undefined) {
    if (service.configIndex !== command.serviceIndex) return -1;
    return 100 + (command.port !== null && service.port === command.port ? 8 : 0);
  }
  let score = 0;
  if (command.port !== null && service.port === command.port) score += 8;
  if (service.serviceName === command.name) score += 4;
  if ((service.command ?? null) === (command.command ?? null)) score += 4;
  if (command.cwd && service.cwd && (service.cwd === command.cwd || service.cwd.endsWith(`/${command.cwd}`))) score += 2;
  return score;
}

const ACTIVE = new Set(["provisioning", "starting", "running"]);

export function isActiveService(status: string) {
  return ACTIVE.has(status);
}

/**
 * The workspace's services and jobs to control. `canRun` is false when the workspace has no folder
 * on this machine, so nothing can be started in it.
 */
export function runtimeControls(input: {
  runtime: Record<string, unknown> | null | undefined;
  services: readonly WorkspaceRuntimeService[] | null | undefined;
  canRun: boolean;
}): RuntimeControlSections {
  const services: RuntimeControl[] = [];
  const jobs: RuntimeControl[] = [];
  const matched = new Set<string>();
  const running = [...(input.services ?? [])];
  const cantRun = input.canRun ? null : "This workspace has no folder on this machine to run it in.";
  for (const command of commandDefinitions(input.runtime)) {
    if (command.kind === "job") {
      jobs.push({
        key: `command:${command.id}`,
        title: command.name,
        kind: "job",
        status: "run once",
        healthStatus: null,
        command: command.command,
        cwd: command.cwd,
        port: null,
        url: null,
        workspaceCommandId: command.id,
        runtimeServiceId: null,
        serviceIndex: null,
        disabledReason: command.disabledReason ?? (command.command ? cantRun : "This job has no command."),
      });
      continue;
    }
    let best: WorkspaceRuntimeService | null = null;
    let bestScore = 0;
    for (const service of running) {
      const score = matchScore(command, service);
      if (score > bestScore) {
        best = service;
        bestScore = score;
      }
    }
    if (best) matched.add(best.id);
    services.push({
      key: `command:${command.id}`,
      title: command.name,
      kind: "service",
      status: best?.status ?? "stopped",
      healthStatus: best?.healthStatus ?? null,
      command: best?.command ?? command.command,
      cwd: best?.cwd ?? command.cwd,
      port: best?.port ?? command.port,
      url: best?.url ?? null,
      workspaceCommandId: command.id,
      runtimeServiceId: best?.id ?? null,
      serviceIndex: command.serviceIndex,
      disabledReason: command.disabledReason ?? cantRun,
    });
  }
  const otherServices = running
    .filter((service) => !matched.has(service.id) && ACTIVE.has(service.status))
    .map(
      (service): RuntimeControl => ({
        key: `runtime:${service.id}`,
        title: service.serviceName,
        kind: "service",
        status: service.status,
        healthStatus: service.healthStatus,
        command: service.command,
        cwd: service.cwd,
        port: service.port,
        url: service.url,
        workspaceCommandId: null,
        runtimeServiceId: service.id,
        serviceIndex: service.configIndex ?? null,
        disabledReason: "The workspace's config no longer defines this service.",
      }),
    );
  return { services, jobs, otherServices };
}
