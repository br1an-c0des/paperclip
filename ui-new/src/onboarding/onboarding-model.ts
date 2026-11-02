import {
  aiProviderRoutingSchema,
  createAiConnectionSchema,
  type Agent,
  type AiConnectionList,
  type AiProviderRouting,
  type AiRuntimeConnectionBinding,
  type CreateAiConnection,
  type Goal,
  type Issue,
  type Project,
} from "@paperclipai/shared";
import { defaultProfile, emptySetup, isSetupDraft, unfinishedDrafts, type ProfileDraft, type SetupDraft } from "@/agents/new/new-agent-model";

/*
 * Onboarding's pure logic, after the old UI's wizard (ui/src/components/OnboardingWizard.tsx,
 * lib/onboarding-route.ts, lib/onboarding-launch.ts):
 *
 * 1. Organization: name it (`POST /companies`). Only a local board or an instance admin may; a
 *    Cloud-managed instance creates organizations in Cloud.
 * 2. First agent: a name, then harness, model, sign-in and environment, through New agent's own
 *    flow (src/agents/new/new-agent-model.ts): a paused setup draft saved as you go, a test, then the
 *    hire, marked `onboardingFirstAgent` so the server seeds its chief-of-staff instructions.
 * 3. First task: the company's "Onboarding" project and one task for the agent, marked
 *    `onboardingFirstTask` so the server writes its brief. Onboarding ends on that task.
 *
 * It resumes from the address: `/:prefix/onboarding` once the organization exists,
 * `?setupAgentId=` while the agent is a draft, `?agentId=` once it's hired. A company's newest
 * unfinished draft is picked up when the address names none.
 */

export type OnboardingStep = "organization" | "agent" | "model" | "task";

export const ONBOARDING_STEPS: readonly { key: OnboardingStep; label: string }[] = [
  { key: "organization", label: "Organization" },
  { key: "agent", label: "First agent" },
  { key: "model", label: "Harness and model" },
  { key: "task", label: "First task" },
];

export const DEFAULT_AGENT_NAME = "Chief of staff";
export const DEFAULT_TASK_TITLE = "Paperclip onboarding";
export const ONBOARDING_PROJECT_NAME = "Onboarding";

// ---------------------------------------------------------------------------------------------
// Who may create an organization

export type CompanyCreation = { allowed: boolean; reason: string; cloudUrl: string | null };

/**
 * `POST /companies` is open to a local board and an instance admin; a Cloud-managed instance refuses
 * it outright (`cloudCreateUrl` is "" when Cloud's address is unknown).
 */
export function companyCreation(input: { authenticated: boolean; instanceAdmin: boolean | undefined; cloudCreateUrl: string | null }): CompanyCreation {
  if (input.cloudCreateUrl !== null) {
    return {
      allowed: false,
      reason: input.cloudCreateUrl
        ? "Organizations on this Paperclip are created in Paperclip Cloud."
        : "Organizations are created in Paperclip Cloud, which this Paperclip can't reach right now. Try again from your Cloud portfolio.",
      cloudUrl: input.cloudCreateUrl || null,
    };
  }
  if (input.authenticated && !input.instanceAdmin) {
    return { allowed: false, reason: "Only an instance admin can create organizations. Ask one to create it, or to invite you to theirs.", cloudUrl: null };
  }
  return { allowed: true, reason: "", cloudUrl: null };
}

export function organizationNameProblem(name: string): string | null {
  if (!name.trim()) return "Give the organization a name.";
  if (name.trim().length > 100) return "Keep the name under 100 characters.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Where onboarding resumes

export type OnboardingEntry =
  | { step: "organization" }
  /** Resume a draft (`setupAgentId`), or start a new agent when there's none. */
  | { step: "agent" | "model"; draftId: string | null }
  | { step: "task"; agentId: string };

/**
 * The step to open on. Without a company it's the organization. With one: a hired agent named in the
 * address goes to the first task; a draft named in the address, or the company's newest unfinished
 * draft, to the harness step; otherwise a new agent.
 */
export function onboardingEntry(input: {
  hasCompany: boolean;
  agentId?: string;
  setupAgentId?: string;
  agents: readonly Pick<Agent, "id" | "status" | "pauseReason" | "createdAt">[] | undefined;
}): OnboardingEntry {
  if (!input.hasCompany) return { step: "organization" };
  const agents = input.agents ?? [];
  if (input.agentId) {
    const hired = agents.find((agent) => agent.id === input.agentId);
    if (hired && hired.status !== "terminated" && !isSetupDraft(hired)) return { step: "task", agentId: hired.id };
    if (hired && isSetupDraft(hired)) return { step: "model", draftId: hired.id };
  }
  if (input.setupAgentId) return { step: "model", draftId: input.setupAgentId };
  const draft = unfinishedDrafts(agents)[0];
  return draft ? { step: "model", draftId: draft.id } : { step: "agent", draftId: null };
}

/**
 * The first agent's profile: "Chief of staff" with a general role, as the old wizard names it (its
 * instructions come from the server), reporting to the CEO when the company already has one.
 */
export function onboardingProfile(agents: Parameters<typeof defaultProfile>[0], name = DEFAULT_AGENT_NAME): ProfileDraft {
  return { ...defaultProfile(agents, name), role: "general" };
}

// ---------------------------------------------------------------------------------------------
// The first task

function createdAt(goal: Pick<Goal, "createdAt">) {
  const time = new Date(goal.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** The company's goal the first task belongs to: the earliest active root company goal, then any. */
export function defaultGoalId(goals: readonly Pick<Goal, "id" | "level" | "parentId" | "status" | "createdAt">[]): string | null {
  const earliest = (list: readonly Pick<Goal, "id" | "createdAt">[]) => [...list].sort((a, b) => createdAt(a) - createdAt(b))[0]?.id ?? null;
  const company = goals.filter((goal) => goal.level === "company");
  const roots = company.filter((goal) => !goal.parentId);
  return earliest(roots.filter((goal) => goal.status === "active")) ?? earliest(roots) ?? earliest(company);
}

/** An "Onboarding" project left from an earlier attempt, to reuse instead of making a second. */
export function reusableProject<T extends Pick<Project, "name" | "status">>(projects: readonly T[]): T | null {
  return projects.find((project) => project.status !== "cancelled" && project.name.trim().toLowerCase() === ONBOARDING_PROJECT_NAME.toLowerCase()) ?? null;
}

export function projectPayload(goalId: string | null) {
  return { name: ONBOARDING_PROJECT_NAME, status: "in_progress" as const, ...(goalId ? { goalIds: [goalId] } : {}) };
}

/** The first task. No description: the server writes the brief for an `onboardingFirstTask`. */
export function firstTaskPayload(input: { title: string; agentId: string; projectId: string; goalId: string | null }) {
  return {
    title: input.title.trim() || DEFAULT_TASK_TITLE,
    assigneeAgentId: input.agentId,
    projectId: input.projectId,
    ...(input.goalId ? { goalId: input.goalId } : {}),
    status: "todo" as const,
    onboardingFirstTask: true,
  };
}

export type LaunchApi = {
  goals: (companyId: string) => Promise<Goal[]>;
  projects: (companyId: string) => Promise<Project[]>;
  createProject: (companyId: string, data: Record<string, unknown>) => Promise<Project>;
  createIssue: (companyId: string, data: Record<string, unknown>) => Promise<Issue>;
};

/**
 * Makes the first task: finds the goal, reuses or creates the Onboarding project, then creates the
 * task. Returns the task's reference for its address (`/:prefix/issues/:ref`).
 */
export async function launchFirstTask(api: LaunchApi, input: { companyId: string; agentId: string; title: string }) {
  const goalId = defaultGoalId(await api.goals(input.companyId));
  const existing = reusableProject(await api.projects(input.companyId));
  const project = existing ?? (await api.createProject(input.companyId, projectPayload(goalId)));
  const issue = await api.createIssue(input.companyId, firstTaskPayload({ title: input.title, agentId: input.agentId, projectId: project.id, goalId }));
  return { issueRef: issue.identifier ?? issue.id, projectId: project.id };
}

/** Where onboarding ends: the first task's page, where the agent's conversation starts. */
export function onboardingTaskHref(prefix: string, issueRef: string) {
  return `/${prefix}/issues/${encodeURIComponent(issueRef)}`;
}

// ---------------------------------------------------------------------------------------------
// The first agent's harnesses

/**
 * The harnesses onboarding offers: Claude Code and Codex, as the old wizard does since upstream
 * #18309 (which dropped its GitHub Copilot path; every harness stays in New agent).
 */
export const ONBOARDING_HARNESSES = ["claude_local", "codex_local"] as const;

export function onboardingHarnessChoices<T extends { type: string }>(choices: readonly T[]): T[] {
  return choices.filter((choice) => (ONBOARDING_HARNESSES as readonly string[]).includes(choice.type));
}

/** A resumed draft keeps its harness choices only for a harness onboarding offers; otherwise it picks again. */
export function onboardingSetup(saved: SetupDraft): SetupDraft {
  if (!saved.harness || (ONBOARDING_HARNESSES as readonly string[]).includes(saved.harness)) return saved;
  return { ...emptySetup(), environmentId: saved.environmentId };
}

// ---------------------------------------------------------------------------------------------
// A custom gateway (the old wizard's "Use a custom gateway", upstream #17253)

export type GatewayAuth = AiProviderRouting["auth"];

export type GatewayDraft = {
  name: string;
  baseUrl: string;
  auth: GatewayAuth;
  apiKey: string;
  /** Comma-separated model ids or the gateway's aliases. */
  models: string;
  ownership: "personal" | "shared";
  /** True for every agent; false for this agent only. */
  allAgents: boolean;
};

/** Claude Code speaks Anthropic Messages and Codex OpenAI Responses, so each harness fixes the format. */
export function gatewayProtocol(harness: string): "messages" | "responses" {
  return harness === "claude_local" ? "messages" : "responses";
}

export function gatewayProvider(harness: string): "anthropic" | "openai" {
  return gatewayProtocol(harness) === "messages" ? "anthropic" : "openai";
}

export function gatewayAuthOptions(harness: string): { value: GatewayAuth; label: string }[] {
  return [
    { value: "bearer", label: "Bearer token" },
    ...(gatewayProtocol(harness) === "messages" ? [{ value: "api_key" as const, label: "x-api-key" }] : []),
    { value: "none", label: "None" },
  ];
}

/** "My gateway.example.com", or "Company …" when it's shared, as the old form names it. */
export function gatewayName(baseUrl: string, ownership: GatewayDraft["ownership"]) {
  let host = "custom gateway";
  try {
    host = new URL(baseUrl.trim()).hostname || host;
  } catch {
    // Not a URL yet.
  }
  return `${ownership === "personal" ? "My" : "Company"} ${host}`;
}

export function emptyGateway(): GatewayDraft {
  return { name: "", baseUrl: "", auth: "bearer", apiKey: "", models: "", ownership: "personal", allAgents: false };
}

/**
 * The `POST /ai-connections` body for a gateway, checked against the shared schemas, or why it can't
 * be saved yet. A personal connection is for this agent only; a shared one for this agent or all.
 */
export function gatewayRequest(
  harness: string,
  draft: GatewayDraft,
  agentId: string | null,
): { ok: true; body: CreateAiConnection } | { ok: false; problem: string } {
  if (!draft.baseUrl.trim()) return { ok: false, problem: "Enter the gateway's address." };
  if (draft.auth !== "none" && !draft.apiKey.trim()) return { ok: false, problem: "Enter the key the gateway expects." };
  const routing = aiProviderRoutingSchema.safeParse({
    kind: "gateway",
    protocol: gatewayProtocol(harness),
    auth: draft.auth,
    baseUrl: draft.baseUrl.trim(),
    models: draft.models
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id })),
  });
  if (!routing.success) return { ok: false, problem: routing.error.issues[0]?.message ?? "Check the address and the sign-in." };
  const everyAgent = draft.ownership === "shared" && draft.allAgents;
  const body = createAiConnectionSchema.safeParse({
    provider: gatewayProvider(harness),
    method: "api_key",
    name: draft.name.trim() || gatewayName(draft.baseUrl, draft.ownership),
    ownership: draft.ownership,
    allAgents: everyAgent,
    agentIds: agentId && !everyAgent ? [agentId] : [],
    routing: routing.data,
    ...(draft.auth !== "none" ? { apiKey: draft.apiKey.trim() } : {}),
  });
  if (!body.success) return { ok: false, problem: body.error.issues[0]?.message ?? "Check the gateway's details." };
  return { ok: true, body: body.data };
}

/** The binding a saved gateway gives the agent: shared, or delegated from your own connection. */
export function gatewayBinding(
  harness: string,
  ownership: GatewayDraft["ownership"],
  result: { connectionId: string; grantId: string },
): AiRuntimeConnectionBinding {
  return { provider: gatewayProvider(harness), method: "api_key", mode: ownership === "shared" ? "shared" : "delegated", ...result };
}

/**
 * Your own gateway connections for the harness's provider, as sign-in choices (New agent's list
 * offers only shared ones and your default).
 */
export function personalGatewayChoices(list: AiConnectionList | undefined, harness: string) {
  if (!list) return [];
  const provider = gatewayProvider(harness);
  return list.connections
    .filter(
      (connection) =>
        connection.provider === provider &&
        connection.ownership === "personal" &&
        connection.ownerUserId === list.currentUserId &&
        connection.routing?.kind === "gateway",
    )
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      description: ["Your custom gateway", connection.routing?.baseUrl, connection.status === "connected" ? null : connection.status.replace(/_/g, " ")]
        .filter(Boolean)
        .join(" · "),
      disabled: connection.status !== "connected",
      binding: { provider, method: connection.method, mode: "delegated", connectionId: connection.id, grantId: connection.grantId } as AiRuntimeConnectionBinding,
    }));
}

/** The model ids a gateway connection lists, which are then the only ones offered. */
export function routedModels(binding: AiRuntimeConnectionBinding | null, list: AiConnectionList | undefined) {
  if (!binding || binding.mode === "router" || binding.mode === "responsible_user" || !list) return [];
  const connection = list.connections.find((each) => each.id === binding.connectionId && each.grantId === binding.grantId);
  return (connection?.routing?.models ?? []).map((model) => ({ id: model.id, label: model.label ?? model.id }));
}
