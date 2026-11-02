import type { Agent, Goal, Issue, Project } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import {
  companyCreation,
  defaultGoalId,
  DEFAULT_AGENT_NAME,
  DEFAULT_TASK_TITLE,
  firstTaskPayload,
  launchFirstTask,
  emptyGateway,
  gatewayAuthOptions,
  gatewayBinding,
  gatewayName,
  gatewayRequest,
  onboardingEntry,
  onboardingHarnessChoices,
  onboardingProfile,
  onboardingSetup,
  organizationNameProblem,
  personalGatewayChoices,
  reusableProject,
  routedModels,
} from "./onboarding-model";
import { emptySetup } from "@/agents/new/new-agent-model";
import type { AiConnectionList } from "@paperclipai/shared";

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

describe("onboarding harnesses", () => {
  it("offers only Claude Code and Codex, as the old wizard does since #18309", () => {
    const choices = ["claude_local", "codex_local", "gemini_local", "opencode_local"].map((type) => ({ type }));
    expect(onboardingHarnessChoices(choices).map((choice) => choice.type)).toEqual(["claude_local", "codex_local"]);
  });

  it("makes a resumed draft on another harness pick again, keeping where it runs", () => {
    const saved = { ...emptySetup("gemini_local"), model: "gemini-2.5-pro", environmentId: "env1" };
    expect(onboardingSetup(saved)).toEqual({ ...emptySetup(), environmentId: "env1" });
    const claude = { ...emptySetup("claude_local"), model: "claude-sonnet-4-5" };
    expect(onboardingSetup(claude)).toBe(claude);
    expect(onboardingSetup(emptySetup())).toEqual(emptySetup());
  });
});

describe("custom gateway", () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const draft = { ...emptyGateway(), baseUrl: "https://gw.example.com/v1", apiKey: "secret", models: "gpt-5, gpt-5-codex ," };

  it("builds an OpenAI Responses gateway for Codex, for this agent only", () => {
    const built = gatewayRequest("codex_local", draft, agentId);
    expect(built).toEqual({
      ok: true,
      body: expect.objectContaining({
        provider: "openai",
        method: "api_key",
        name: "My gw.example.com",
        ownership: "personal",
        allAgents: false,
        agentIds: [agentId],
        apiKey: "secret",
        routing: { kind: "gateway", protocol: "responses", auth: "bearer", baseUrl: "https://gw.example.com/v1", models: [{ id: "gpt-5" }, { id: "gpt-5-codex" }] },
      }),
    });
  });

  it("uses Anthropic Messages for Claude Code, and x-api-key only there", () => {
    expect(gatewayAuthOptions("claude_local").map((option) => option.value)).toEqual(["bearer", "api_key", "none"]);
    expect(gatewayAuthOptions("codex_local").map((option) => option.value)).toEqual(["bearer", "none"]);
    const built = gatewayRequest("claude_local", { ...draft, auth: "api_key", ownership: "shared", allAgents: true }, agentId);
    expect(built.ok && built.body).toMatchObject({ provider: "anthropic", ownership: "shared", allAgents: true, agentIds: [], name: "Company gw.example.com" });
    expect(built.ok && built.body.routing).toMatchObject({ protocol: "messages", auth: "api_key" });
  });

  it("explains what's missing or wrong before saving", () => {
    expect(gatewayRequest("codex_local", { ...draft, baseUrl: "" }, agentId)).toEqual({ ok: false, problem: "Enter the gateway's address." });
    expect(gatewayRequest("codex_local", { ...draft, apiKey: " " }, agentId)).toEqual({ ok: false, problem: "Enter the key the gateway expects." });
    const plain = gatewayRequest("codex_local", { ...draft, baseUrl: "http://gw.example.com/v1" }, agentId);
    expect(plain.ok).toBe(false);
    expect(!plain.ok && plain.problem).toContain("HTTPS");
    const local = gatewayRequest("codex_local", { ...draft, baseUrl: "http://localhost:4000/v1", auth: "none", apiKey: "" }, agentId);
    expect(local.ok && local.body).not.toHaveProperty("apiKey");
  });

  it("names it after the host, and binds the agent to it", () => {
    expect(gatewayName("not a url", "personal")).toBe("My custom gateway");
    expect(gatewayBinding("codex_local", "personal", { connectionId: "c1", grantId: "g1" })).toEqual({
      provider: "openai",
      method: "api_key",
      mode: "delegated",
      connectionId: "c1",
      grantId: "g1",
    });
    expect(gatewayBinding("claude_local", "shared", { connectionId: "c1", grantId: "g1" })).toMatchObject({ provider: "anthropic", mode: "shared" });
  });

  it("lists your own gateways as sign-ins and offers their models", () => {
    const list = {
      currentUserId: "u1",
      canManageConnections: true,
      connections: [
        { id: "c1", grantId: "g1", provider: "openai", method: "api_key", name: "My gw", ownership: "personal", ownerUserId: "u1", status: "connected", routing: { kind: "gateway", baseUrl: "https://gw", models: [{ id: "gpt-5" }] } },
        { id: "c2", grantId: "g2", provider: "openai", method: "api_key", name: "Their gw", ownership: "personal", ownerUserId: "u2", status: "connected", routing: { kind: "gateway", models: [] } },
        { id: "c3", grantId: "g3", provider: "openai", method: "subscription", name: "My ChatGPT", ownership: "personal", ownerUserId: "u1", status: "connected" },
      ],
    } as unknown as AiConnectionList;
    const choices = personalGatewayChoices(list, "codex_local");
    expect(choices.map((choice) => choice.id)).toEqual(["c1"]);
    expect(routedModels(choices[0]!.binding, list)).toEqual([{ id: "gpt-5", label: "gpt-5" }]);
    expect(routedModels(null, list)).toEqual([]);
    expect(personalGatewayChoices(list, "claude_local")).toEqual([]);
  });
});
