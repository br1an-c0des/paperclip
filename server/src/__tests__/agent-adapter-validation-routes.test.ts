// Adapter validation on the agent routes: YAML and roster edits, unknown and disabled adapters,
// claude_local moves. The Runner, other adapters and managed providers are in
// agent-adapter-validation-routes.dormant.test.ts (opt-in tier); shared setup is in the .fixture.ts.
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  externalAdapter,
  missingAdapterType,
  requestApp,
  resetAdapterValidationMocks,
  unregisterTestAdapter,
} from "./agent-adapter-validation-routes.fixture.js";

const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  getConfigRevision: vi.fn(),
  rollbackConfigRevision: vi.fn(),
  update: vi.fn(),
}));

const mockAdapterPluginStore = vi.hoisted(() => ({
  getDisabledAdapterTypes: vi.fn<() => string[]>(() => []),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
  ensureMembership: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
  resolveAdapterConfigForRuntime: vi.fn(async (_companyId: string, config: Record<string, unknown>) => ({ config })),
  syncEnvBindingsForTarget: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
  getBundle: vi.fn(),
  readFile: vi.fn(),
  updateBundle: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  exportFiles: vi.fn(),
  ensureManagedBundle: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelActiveForAgent: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));

const mockCheckProtectedKeys = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => [] as unknown[]));
const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null })),
  getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  getExperimental: vi.fn(async (): Promise<{ enableNativeRunner: boolean; enableOpenAiDot?: boolean; enableManagedSandboxOnly?: boolean }> => ({ enableNativeRunner: false })),
}));

const mockManagedAgentProfileService = vi.hoisted(() => ({
  requireQualified: vi.fn(),
}));

const mockRemoteAgentProfileService = vi.hoisted(() => ({
  requireQualified: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockAntigravityModels = vi.hoisted(() => vi.fn());
vi.mock("../services/antigravity-connection-models.js", () => ({ antigravityConnectionModels: mockAntigravityModels }));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => mockAgentInstructionsService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
  companySkillService: () => mockCompanySkillService,
  budgetService: () => mockBudgetService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/managed-agent-profiles.js", () => ({
  managedAgentProfileService: () => mockManagedAgentProfileService,
}));

vi.mock("../services/remote-agent-profiles.js", () => ({
  remoteAgentProfileService: () => mockRemoteAgentProfileService,
}));

const mocks = {
  mockAgentService,
  mockAdapterPluginStore,
  mockAccessService,
  mockCompanySkillService,
  mockSecretService,
  mockAgentInstructionsService,
  mockBudgetService,
  mockHeartbeatService,
  mockIssueApprovalService,
  mockApprovalService,
  mockCheckProtectedKeys,
  mockInstanceSettingsService,
  mockManagedAgentProfileService,
  mockRemoteAgentProfileService,
  mockLogActivity,
  mockAntigravityModels,
};

describe("agent routes adapter validation", () => {
  beforeEach(async () => {
    await resetAdapterValidationMocks(mocks);
  });

  it("round-trips the protected YAML projection and forwards its revision to the write lock", async () => {
    const existing = {
      ...(await mockAgentService.getById()),
      adapterConfig: { model: "old", removeMe: true, env: { DEMO_VALUE: "private-fixture" } },
      metadata: { token: "private-metadata-fixture" },
    };
    mockAgentService.getById.mockResolvedValue(existing);
    const app = await createApp();
    const loaded = await requestApp(app, base => request(base).get(`/api/agents/${existing.id}/configuration`));
    expect(loaded.status).toBe(200);
    expect(loaded.body.configurationRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(loaded.body)).not.toContain("private-fixture");
    expect(JSON.stringify(loaded.body)).not.toContain("private-metadata-fixture");
    const adapterConfig = { ...loaded.body.adapterConfig, model: "new" };
    delete adapterConfig.removeMe;
    const saved = await requestApp(app, base => request(base).patch(`/api/agents/${existing.id}`).send({
      adapterConfig, replaceAdapterConfig: true, metadata: { ...loaded.body.metadata, label: "new" },
      expectedConfigurationRevision: loaded.body.configurationRevision,
    }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      adapterConfig: expect.objectContaining({ model: "new", env: existing.adapterConfig.env }),
      metadata: { ...existing.metadata, label: "new" },
    }), expect.objectContaining({ expectedConfigurationRevision: loaded.body.configurationRevision }));
    expect(mockAgentService.update.mock.calls[0][1].adapterConfig).not.toHaveProperty("removeMe");
    expect(saved.body.configurationRevision).not.toBe(loaded.body.configurationRevision);
    expect(JSON.stringify(saved.body)).not.toContain("private-fixture");
    expect(JSON.stringify(saved.body)).not.toContain("private-metadata-fixture");
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "agent.updated" }));
  });

  it("rejects stale and unauthorized YAML saves before calling the update service", async () => {
    const existing = await mockAgentService.getById();
    const app = await createApp();
    const loaded = await requestApp(app, base => request(base).get(`/api/agents/${existing.id}/configuration`));
    const stale = await requestApp(app, base => request(base).patch(`/api/agents/${existing.id}`).send({
      title: "Stale", expectedConfigurationRevision: "0".repeat(64),
    }));
    expect(stale.status).toBe(409);
    mockAccessService.decide.mockResolvedValue({ allowed: false, reason: "deny_missing_grant", explanation: "No configuration permission" });
    const denied = await requestApp(app, base => request(base).patch(`/api/agents/${existing.id}`).send({
      title: "Denied", expectedConfigurationRevision: loaded.body.configurationRevision,
    }));
    expect(denied.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("routes narrow roster edits through authorization, config merging and audit history", async () => {
    const existing = { ...(await mockAgentService.getById()), adapterConfig: { model: "old", cwd: "/workspace" }, runtimeConfig: { heartbeat: { intervalSec: 900 } } };
    mockAgentService.getById.mockResolvedValue(existing);
    const app = await createApp();
    const response = await requestApp(app, base => request(base).patch(`/api/agents/${existing.id}`).send({ runtimeSettings: {
      harness: "codex_local", model: "new", expected: { model: "old", aiConnection: null },
    } }));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.adapterConfig).toMatchObject({ model: "new", cwd: "/workspace" });
    expect(response.body.runtimeConfig).toEqual(existing.runtimeConfig);
    expect(mockAgentService.update).toHaveBeenCalledWith(existing.id, expect.not.objectContaining({ runtimeSettings: expect.anything() }), expect.objectContaining({ expectedConfiguration: expect.objectContaining({ adapterConfig: existing.adapterConfig }), recordRevision: expect.anything() }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "agent.updated", entityId: existing.id }));
  });

  it("refuses a roster edit without configuration permission", async () => {
    mockAccessService.decide.mockResolvedValue({ allowed: false, reason: "deny_missing_grant", explanation: "No configuration permission" });
    const app = await createApp();
    const response = await requestApp(app, base => request(base).patch("/api/agents/11111111-1111-4111-8111-111111111111").send({ runtimeSettings: {
      harness: "codex_local", model: "new", expected: { model: null, aiConnection: null },
    } }));
    expect(response.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await unregisterTestAdapter("external_test");
    await unregisterTestAdapter(missingAdapterType);
  });

  it("creates agents for dynamically registered external adapter types", async () => {
    const { registerServerAdapter } = await import("../adapters/index.js");
    registerServerAdapter(externalAdapter);
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["some_other_adapter"]);

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/agents")
        .send({
          name: "External Agent",
          adapterType: "external_test",
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.adapterType).toBe("external_test");
  });

  it("forwards a claude_local→process adapter move that drops the OAuth binding to the service unchanged", async () => {
    // The agent has the fixed Claude Code OAuth binding on the claude_local
    // adapter. A PATCH moves the agent to the process adapter and sends an empty
    // env in the same request. The route must forward the new adapter type and
    // the dropped binding to the service without a re-injection, so the
    // service-enforced binding invariant sees the removal and rejects it.
    const agentId = "11111111-1111-4111-8111-111111111111";
    mockAgentService.getById.mockResolvedValue({
      id: agentId,
      companyId: "company-1",
      name: "Claude",
      urlKey: "claude",
      role: "engineer",
      title: null,
      icon: null,
      status: "idle",
      reportsTo: null,
      capabilities: null,
      adapterType: "claude_local",
      adapterConfig: { env: { CLAUDE_CODE_OAUTH_TOKEN: { type: "user_secret_ref", key: "CLAUDE_CODE_OAUTH_TOKEN" } } },
      runtimeConfig: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .patch(`/api/agents/${agentId}`)
        .send({
          adapterType: "process",
          adapterConfig: { env: {} },
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const patch = mockAgentService.update.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    // The route forwards the requested adapter type, so the service can see the
    // adapter move.
    expect(patch.adapterType).toBe("process");
    // The route does not re-inject the fixed binding from the prior config, so
    // the service invariant sees the removal.
    const env = ((patch.adapterConfig as Record<string, unknown>).env as Record<string, unknown> | undefined) ?? {};
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("rejects redacted-value restoration from an incompatible saved agent", async () => {
    const { registerServerAdapter } = await import("../adapters/index.js");
    registerServerAdapter(externalAdapter);
    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/adapters/external_test/test-environment")
        .send({
          agentId: "11111111-1111-4111-8111-111111111111",
          adapterConfig: { env: { CODEX_HOME: { type: "plain", value: "***REDACTED***" } } },
        }),
    );

    expect(res.status).toBe(422);
    expect(mockSecretService.normalizeAdapterConfigForPersistence).not.toHaveBeenCalled();
  });

  it("rejects unknown adapter types even when schema accepts arbitrary strings", async () => {
    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/agents")
        .send({
          name: "Missing Adapter",
          adapterType: missingAdapterType,
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.body.error ?? res.body.message ?? "")).toContain(`Unknown adapter type: ${missingAdapterType}`);
  });

  it("refuses to create an agent on an adapter the instance has disabled", async () => {
    // A disabled adapter is one the instance cannot run (e.g. curated out of
    // PAPERCLIP_ADAPTERS). Creating an agent on it "succeeds" and then every
    // run of that agent dies at lease time with "not in the configured adapter
    // registry", so the refusal belongs here, where it can name the choices.
    const { registerServerAdapter } = await import("../adapters/index.js");
    registerServerAdapter(externalAdapter);
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["external_test"]);

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/agents")
        .send({ name: "Disabled Harness", adapterType: "external_test" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    const message = String(res.body.error ?? res.body.message ?? "");
    expect(message).toContain('Adapter "external_test" is not available on this instance');
    // The message must be actionable: it names what CAN be chosen.
    expect(message).toMatch(/Available adapters?: .+/);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("refuses to switch an existing agent onto a disabled adapter", async () => {
    const { registerServerAdapter } = await import("../adapters/index.js");
    registerServerAdapter(externalAdapter);
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["external_test"]);

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .patch("/api/agents/11111111-1111-4111-8111-111111111111")
        .send({ adapterType: "external_test" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.body.error ?? res.body.message ?? "")).toContain(
      'Adapter "external_test" is not available on this instance',
    );
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("still lets an agent already on a disabled adapter be edited", async () => {
    // Disabling an adapter must not make the agents that already use it
    // uneditable — only NEW selections of it are refused.
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue(["codex_local"]);

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .patch("/api/agents/11111111-1111-4111-8111-111111111111")
        .send({ adapterType: "codex_local", adapterConfig: { model: "gpt-5.4" } }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });


});

vi.mock("../services/agent-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/agent-lifecycle.js")>();
  return { ...actual, createAgentLifecycle: () => ({
    requestHire: (...args: unknown[]) => mockAgentService.create(...args),
  }) };
});
