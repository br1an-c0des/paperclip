import type { Agent, Goal, Issue, Project } from "@paperclipai/shared";
import { defaultProfile, isSetupDraft, unfinishedDrafts, type ProfileDraft } from "@/agents/new/new-agent-model";

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

/** The old wizard's step for a resumed company with an existing first task: the task's address. */
export function onboardingTaskHref(prefix: string, issueRef: string) {
  return `/${prefix}/issues/${encodeURIComponent(issueRef)}`;
}
