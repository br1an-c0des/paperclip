import type {
  CompanyPortabilityAdapterOverride,
  CompanyPortabilityEnvInput,
  CompanyPortabilityPreviewResult,
} from "@paperclipai/shared";
import type { AdapterInfo } from "@/api/agents";
import { ApiError } from "@/api/client";
import type { CompanyImportJobAccepted, CompanyImportJobStatus } from "@/api/companies";
import { harnessLabel, harnessType, runnerCapable } from "@/agents/agent-model";
import { ADAPTER_AGNOSTIC_KEYS, harnessChangeChoices } from "@/agents/harness-model";

/*
 * What an import asks before it runs, beyond the package itself (the old Import page,
 * ui/src/pages/CompanyImport.tsx):
 *
 * - Where the package comes from: an uploaded zip or a GitHub address (`source: { type: "github" }`,
 *   read by the server; a tree or blob address picks a folder or a COMPANY.md).
 * - Which of its files come in (`selectedFiles`), grouped by their top folder.
 * - Each imported agent's harness (`adapterOverrides`): kept, or moved to another installed one. An
 *   agent whose harness isn't installed here moves to the CEO's (or the first installed) unless
 *   another is picked, as the old page does.
 * - Values for the package's environment inputs (`secretValues`, keyed `agent:<slug>:<KEY>`,
 *   `project:<slug>:<KEY>` or `<KEY>`): secret ones are stored as new company secrets, plain ones
 *   written into the agent or project. The server refuses the import while a required one is empty.
 * - The running job's id, kept in sessionStorage so a reload picks the import up again
 *   (`GET /companies/import/jobs/:id`); jobs live in server memory, so a 404 means it's gone.
 */

// ---------------------------------------------------------------------------------------------
// GitHub address

/** The address the server reads: https only, at least owner and repository. */
export function githubAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function githubProblem(value: string): string | null {
  const address = githubAddress(value);
  if (!address) return "Enter a GitHub address.";
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "That isn't a web address.";
  }
  if (url.protocol !== "https:") return "Use an https:// address.";
  if (url.pathname.split("/").filter(Boolean).length < 2) return "Include the owner and repository, such as github.com/owner/repo.";
  return null;
}

/** "acme/agents" from a GitHub address, for labels. */
export function githubLabel(value: string) {
  try {
    const parts = new URL(githubAddress(value)).pathname.split("/").filter(Boolean);
    return parts.slice(0, 2).join("/").replace(/\.git$/i, "") || value.trim();
  } catch {
    return value.trim();
  }
}

// ---------------------------------------------------------------------------------------------
// Files

export type FileGroup = { key: string; label: string; paths: string[] };

/** The package's files grouped by top folder (agents, projects, skills, tasks…); root files first. */
export function fileGroups(paths: readonly string[]): FileGroup[] {
  const groups = new Map<string, string[]>();
  for (const path of [...paths].sort()) {
    const slash = path.indexOf("/");
    const key = slash === -1 ? "" : path.slice(0, slash);
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([key, list]) => ({ key, label: key === "" ? "Package files" : key, paths: list }));
}

/** The company file's path in the package (`COMPANY.md`), if it has one. */
export function companyFilePath(preview: Pick<CompanyPortabilityPreviewResult, "manifest">) {
  const path = preview.manifest.company?.path;
  if (!path) return null;
  return path.endsWith(".md") ? path : `${path}.md`;
}

/**
 * The files ticked when a preview arrives: all of them, less the company file when merging into an
 * organization that would otherwise take the package's name and description.
 */
export function defaultCheckedFiles(preview: CompanyPortabilityPreviewResult, into: boolean): Set<string> {
  const checked = new Set(Object.keys(preview.files));
  const company = companyFilePath(preview);
  if (into && preview.plan.companyAction === "update" && company) checked.delete(company);
  return checked;
}

/** `selectedFiles` for the request: left out when every file is picked (the server's default). */
export function selectedFilesPayload(checked: ReadonlySet<string>, all: readonly string[]): string[] | undefined {
  if (all.every((path) => checked.has(path))) return undefined;
  return [...checked].filter((path) => all.includes(path)).sort();
}

// ---------------------------------------------------------------------------------------------
// Harnesses

export type ImportAgent = {
  slug: string;
  name: string;
  /** The package's harness ("claude_local", "codex_local"…), whatever runner carries it. */
  harness: string;
  harnessLabel: string;
  /** The package's adapter type: the harness itself, or `paperclip_runner` carrying it. */
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  /** Not installed (or turned off) here; null while the list is unknown. */
  missing: boolean | null;
  /** The harness it moves to unless another is picked, when its own is missing. */
  fallback: string | null;
};

/** The harnesses an imported agent can be moved to: installed, loaded and on. */
export function importHarnessChoices(adapters: readonly AdapterInfo[] | undefined) {
  return harnessChangeChoices(adapters, "");
}

/** Every agent the import creates or updates, with its harness and whether it's installed here. */
export function importAgents(
  preview: Pick<CompanyPortabilityPreviewResult, "manifest" | "plan">,
  adapters: readonly AdapterInfo[] | undefined,
  ceoHarness: string | null,
): ImportAgent[] {
  const skipped = new Set(preview.plan.agentPlans.filter((plan) => plan.action === "skip").map((plan) => plan.slug));
  const choices = adapters ? importHarnessChoices(adapters).map((choice) => choice.type) : null;
  const installed = adapters ? new Set(adapters.filter((adapter) => !adapter.disabled && adapter.loaded !== false).map((adapter) => adapter.type)) : null;
  return preview.manifest.agents
    .filter((agent) => !skipped.has(agent.slug))
    .map((agent) => {
      const config = (agent.adapterConfig ?? {}) as Record<string, unknown>;
      const harness = harnessType(agent.adapterType, config);
      // A Runner agent needs the Runner itself; any other needs its own harness.
      const missing = installed ? !installed.has(agent.adapterType) : null;
      const fallback = missing && choices ? (ceoHarness && choices.includes(ceoHarness) ? ceoHarness : (choices[0] ?? null)) : null;
      return { slug: agent.slug, name: agent.name, harness, harnessLabel: harnessLabel(harness), adapterType: agent.adapterType, adapterConfig: config, missing, fallback };
    });
}

/** The harness an agent ends up with: the pick, else the fallback, else its own. */
export function effectiveHarness(agent: ImportAgent, pick: string | undefined) {
  return pick ?? agent.fallback ?? agent.harness;
}

/**
 * `adapterOverrides` for the import: only agents that move to another harness, or whose own can't
 * run here. The new config keeps
 * the harness-agnostic keys (instructions, env, prompt, timeouts) and the model given, as a harness
 * change on the agent page does; harnesses the Paperclip Runner can carry get the runner the
 * server recommends.
 */
export function adapterOverrides(
  agents: readonly ImportAgent[],
  picks: Readonly<Record<string, string | undefined>>,
  models: Readonly<Record<string, string | undefined>>,
): Record<string, CompanyPortabilityAdapterOverride> | undefined {
  const overrides: Record<string, CompanyPortabilityAdapterOverride> = {};
  for (const agent of agents) {
    const next = effectiveHarness(agent, picks[agent.slug]);
    // Kept as packaged, unless what carries it (a missing Runner) isn't here.
    if (next === agent.harness && !agent.missing) continue;
    const adapterConfig: Record<string, unknown> = {};
    for (const key of ADAPTER_AGNOSTIC_KEYS) if (agent.adapterConfig[key] !== undefined) adapterConfig[key] = agent.adapterConfig[key];
    const model = models[agent.slug]?.trim();
    if (model) adapterConfig.model = model;
    overrides[agent.slug] = { adapterType: next, adapterConfig, ...(runnerCapable(next) ? { runner: "auto" as const } : {}) };
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

/** OpenCode refuses an agent without a model; the old form asks for one too. */
export function harnessNeedsModel(harness: string) {
  return harness === "opencode_local";
}

// ---------------------------------------------------------------------------------------------
// Environment values

/** The key the server reads a value under (company-portability.ts `envInputScopedKey`). */
export function envInputKey(input: Pick<CompanyPortabilityEnvInput, "key" | "agentSlug" | "projectSlug">) {
  if (input.agentSlug) return `agent:${input.agentSlug}:${input.key}`;
  if (input.projectSlug) return `project:${input.projectSlug}:${input.key}`;
  return input.key;
}

/** The inputs the import will ask about: those of agents and projects it brings in. */
export function importEnvInputs(preview: Pick<CompanyPortabilityPreviewResult, "envInputs" | "plan">): CompanyPortabilityEnvInput[] {
  const skippedAgents = new Set(preview.plan.agentPlans.filter((plan) => plan.action === "skip").map((plan) => plan.slug));
  const skippedProjects = new Set(preview.plan.projectPlans.filter((plan) => plan.action === "skip").map((plan) => plan.slug));
  const seen = new Set<string>();
  return preview.envInputs.filter((input) => {
    if (input.agentSlug && skippedAgents.has(input.agentSlug)) return false;
    if (input.projectSlug && skippedProjects.has(input.projectSlug)) return false;
    const key = envInputKey(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "For agent cto", "For project website", "For the organization". */
export function envInputScope(input: Pick<CompanyPortabilityEnvInput, "agentSlug" | "projectSlug">, names: { agents: Record<string, string>; projects: Record<string, string> }) {
  if (input.agentSlug) return `For ${names.agents[input.agentSlug] ?? input.agentSlug}`;
  if (input.projectSlug) return `For project ${names.projects[input.projectSlug] ?? input.projectSlug}`;
  return "For the organization";
}

/** Plain inputs start from the package's default; secret ones start empty. */
export function initialEnvValues(inputs: readonly CompanyPortabilityEnvInput[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of inputs) values[envInputKey(input)] = input.kind === "plain" ? (input.defaultValue ?? "") : "";
  return values;
}

export function missingRequired(inputs: readonly CompanyPortabilityEnvInput[], values: Readonly<Record<string, string>>) {
  return inputs.filter((input) => input.requirement === "required" && !(values[envInputKey(input)] ?? "").trim());
}

/** `secretValues` for the request: only filled-in values. */
export function secretValuesPayload(inputs: readonly CompanyPortabilityEnvInput[], values: Readonly<Record<string, string>>) {
  const out: Record<string, string> = {};
  for (const input of inputs) {
    const key = envInputKey(input);
    const value = values[key] ?? "";
    if (value.trim()) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// The running job, across a reload

export type StoredImportJob = {
  jobId: string;
  /** What's being imported, for the resumed card: a file name or a GitHub address. */
  label: string;
  target: "new" | "existing";
};

const STORAGE_PREFIX = "paperclip:company-import-job";
const storageKey = (companyId: string) => `${STORAGE_PREFIX}:${companyId}`;

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): KeyValueStore | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function storeImportJob(companyId: string, job: StoredImportJob, store: KeyValueStore | null = session()) {
  try {
    store?.setItem(storageKey(companyId), JSON.stringify(job));
  } catch {
    // Polling still works without storage; only picking it up after a reload is lost.
  }
}

export function readImportJob(companyId: string, store: KeyValueStore | null = session()): StoredImportJob | null {
  try {
    const raw = store?.getItem(storageKey(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredImportJob>;
    if (typeof parsed.jobId === "string" && parsed.jobId) {
      return { jobId: parsed.jobId, label: typeof parsed.label === "string" ? parsed.label : "the package", target: parsed.target === "existing" ? "existing" : "new" };
    }
    store?.removeItem(storageKey(companyId));
  } catch {
    // Unreadable entries are dropped below.
    try {
      store?.removeItem(storageKey(companyId));
    } catch {
      // Storage unavailable.
    }
  }
  return null;
}

export function clearImportJob(companyId: string, store: KeyValueStore | null = session()) {
  try {
    store?.removeItem(storageKey(companyId));
  } catch {
    // Storage unavailable.
  }
}

/** A 409 from an import start: this person's earlier import is still running, so watch that one. */
export function runningJobFrom(error: unknown): CompanyImportJobAccepted | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { job?: { id?: unknown }; statusUrl?: unknown } | null;
  const id = body?.job?.id;
  if (typeof id !== "string" || !id) return null;
  return { job: { id, status: "running" }, statusUrl: typeof body?.statusUrl === "string" ? body.statusUrl : `/companies/import/jobs/${id}` };
}

export class ImportJobGoneError extends Error {
  constructor() {
    super("The server no longer knows this import; it may have restarted while it ran. Check the organization list before importing again.");
    this.name = "ImportJobGoneError";
  }
}

const temporary = (error: unknown) =>
  (error instanceof ApiError && [429, 502, 503, 504].includes(error.status)) || (error instanceof TypeError && /fetch|network|load failed/i.test(error.message));

/**
 * Polls a job until it settles. Network hiccups and 5xx gateways keep waiting (the job runs on the
 * server regardless); a 404 means the server lost it. Resolves the finished job, or null when
 * `stopped()` turns true.
 */
export async function watchImportJob(
  jobId: string,
  calls: { get: (jobId: string) => Promise<CompanyImportJobStatus>; wait: (ms: number) => Promise<void>; stopped: () => boolean },
  firstWait = 2000,
): Promise<CompanyImportJobStatus["job"] | null> {
  let wait = firstWait;
  for (;;) {
    await calls.wait(wait);
    if (calls.stopped()) return null;
    let status: CompanyImportJobStatus;
    try {
      status = await calls.get(jobId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new ImportJobGoneError();
      if (temporary(error)) {
        wait = 3000;
        continue;
      }
      throw error;
    }
    if (status.job.status === "failed") throw new Error(status.job.error?.message ?? "The import failed.");
    if (status.job.status === "succeeded") return status.job;
    wait = status.retryAfterMs ?? 2000;
  }
}

/** Waits, holding off while the tab is hidden: the job runs on the server either way. */
export async function pollDelay(ms: number) {
  do {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  } while (typeof document !== "undefined" && document.hidden);
}
