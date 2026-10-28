import type { Agent, Goal, Issue, Project } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import {
  companyCreation,
  defaultGoalId,
  DEFAULT_AGENT_NAME,
  DEFAULT_TASK_TITLE,
  firstTaskPayload,
  launchFirstTask,
  onboardingEntry,
  onboardingProfile,
  organizationNameProblem,
  reusableProject,
} from "./onboarding-model";

const agent = (patch: Partial<Agent>) => ({ id: "a1", status: "idle", pauseReason: null, createdAt: new Date("2026-10-01T00:00:00Z"), ...patch }) as Agent;

describe("companyCreation", () => {
  it("lets a local board and an instance admin create organizations", () => {
    expect(companyCreation({ authenticated: false, instanceAdmin: undefined, cloudCreateUrl: null }).allowed).toBe(true);
    expect(companyCreation({ authenticated: true, instanceAdmin: true, cloudCreateUrl: null }).allowed).toBe(true);
  });

  it("explains why others can't", () => {
    expect(companyCreation({ authenticated: true, instanceAdmin: false, cloudCreateUrl: null })).toMatchObject({ allowed: false, reason: expect.stringMatching(/instance admin/) });
    expect(companyCreation({ authenticated: true, instanceAdmin: true, cloudCreateUrl: "https://cloud.example/stacks/new" })).toEqual({
      allowed: false,
      reason: "Organizations on this Paperclip are created in Paperclip Cloud.",
      cloudUrl: "https://cloud.example/stacks/new",
    });
    expect(companyCreation({ authenticated: true, instanceAdmin: true, cloudCreateUrl: "" })).toMatchObject({ allowed: false, cloudUrl: null });
  });

  it("checks the name", () => {
    expect(organizationNameProblem("  ")).toMatch(/name/);
    expect(organizationNameProblem("x".repeat(101))).toMatch(/100/);
    expect(organizationNameProblem("Northwind Labs")).toBeNull();
  });
});

describe("onboardingEntry", () => {
  it("starts at the organization without a company", () => {
    expect(onboardingEntry({ hasCompany: false, agents: [] })).toEqual({ step: "organization" });
  });

  it("starts a new agent in a company with no drafts", () => {
    expect(onboardingEntry({ hasCompany: true, agents: [agent({ id: "ceo" })] })).toEqual({ step: "agent", draftId: null });
  });

  it("resumes the draft the address names, or the newest unfinished one", () => {
    expect(onboardingEntry({ hasCompany: true, setupAgentId: "d1", agents: [] })).toEqual({ step: "model", draftId: "d1" });
    const drafts = [
      agent({ id: "old", status: "paused", pauseReason: "setup", createdAt: new Date("2026-10-01T00:00:00Z") }),
      agent({ id: "new", status: "paused", pauseReason: "setup", createdAt: new Date("2026-10-02T00:00:00Z") }),
    ];
    expect(onboardingEntry({ hasCompany: true, agents: drafts })).toEqual({ step: "model", draftId: "new" });
  });

  it("goes to the first task once the named agent is hired", () => {
    expect(onboardingEntry({ hasCompany: true, agentId: "a1", agents: [agent({ id: "a1" })] })).toEqual({ step: "task", agentId: "a1" });
    // Still a draft: back to the harness step.
    expect(onboardingEntry({ hasCompany: true, agentId: "a1", agents: [agent({ id: "a1", status: "paused", pauseReason: "setup" })] })).toEqual({
      step: "model",
      draftId: "a1",
    });
    // Gone: a new agent.
    expect(onboardingEntry({ hasCompany: true, agentId: "gone", agents: [] })).toEqual({ step: "agent", draftId: null });
  });
});

describe("onboardingProfile", () => {
  it("names the first agent Chief of staff with a general role", () => {
    expect(onboardingProfile([])).toMatchObject({ name: DEFAULT_AGENT_NAME, role: "general", reportsTo: null });
  });

  it("reports to the CEO when there is one", () => {
    expect(onboardingProfile([agent({ id: "ceo", role: "ceo" })]).reportsTo).toBe("ceo");
  });
});

describe("the first task", () => {
  const goal = (patch: Partial<Goal>) => ({ id: "g", level: "company", parentId: null, status: "active", createdAt: new Date("2026-10-01T00:00:00Z"), ...patch }) as Goal;

  it("picks the earliest active root company goal", () => {
    expect(
      defaultGoalId([
        goal({ id: "team", level: "team" }),
        goal({ id: "later", createdAt: new Date("2026-10-03T00:00:00Z") }),
        goal({ id: "child", parentId: "later", createdAt: new Date("2026-09-01T00:00:00Z") }),
        goal({ id: "earlier", createdAt: new Date("2026-10-02T00:00:00Z") }),
      ]),
    ).toBe("earlier");
    expect(defaultGoalId([goal({ id: "done", status: "achieved" })])).toBe("done");
    expect(defaultGoalId([])).toBeNull();
  });

  it("reuses an Onboarding project that isn't cancelled", () => {
    const projects = [
      { id: "p1", name: "Onboarding", status: "cancelled" },
      { id: "p2", name: " onboarding ", status: "in_progress" },
    ] as Project[];
    expect(reusableProject(projects)?.id).toBe("p2");
    expect(reusableProject([projects[0]!])).toBeNull();
  });

  it("marks the task as the onboarding first task, with no description", () => {
    expect(firstTaskPayload({ title: "  ", agentId: "a1", projectId: "p1", goalId: null })).toEqual({
      title: DEFAULT_TASK_TITLE,
      assigneeAgentId: "a1",
      projectId: "p1",
      status: "todo",
      onboardingFirstTask: true,
    });
  });

  it("creates the project when needed, then the task, and returns its reference", async () => {
    const api = {
      goals: vi.fn().mockResolvedValue([goal({ id: "g1" })]),
      projects: vi.fn().mockResolvedValue([]),
      createProject: vi.fn().mockResolvedValue({ id: "p9" } as Project),
      createIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "NOR-1" } as Issue),
    };
    await expect(launchFirstTask(api, { companyId: "co1", agentId: "a1", title: "Plan the quarter" })).resolves.toEqual({ issueRef: "NOR-1", projectId: "p9" });
    expect(api.createProject).toHaveBeenCalledWith("co1", { name: "Onboarding", status: "in_progress", goalIds: ["g1"] });
    expect(api.createIssue).toHaveBeenCalledWith("co1", expect.objectContaining({ title: "Plan the quarter", projectId: "p9", goalId: "g1", onboardingFirstTask: true }));
  });

  it("reuses an existing Onboarding project", async () => {
    const api = {
      goals: vi.fn().mockResolvedValue([]),
      projects: vi.fn().mockResolvedValue([{ id: "p1", name: "Onboarding", status: "in_progress" }]),
      createProject: vi.fn(),
      createIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: null } as unknown as Issue),
    };
    await expect(launchFirstTask(api, { companyId: "co1", agentId: "a1", title: "" })).resolves.toEqual({ issueRef: "i1", projectId: "p1" });
    expect(api.createProject).not.toHaveBeenCalled();
  });
});
