import express from "express";
import type request from "supertest";
import { vi, type Mock } from "vitest";
import type { ServerAdapterModule } from "../adapters/index.js";

// Shared setup for agent-adapter-validation-routes.test.ts and its opt-in sibling
// agent-adapter-validation-routes.dormant.test.ts. The vi.hoisted mocks and the vi.mock calls stay
// in each test file, since vi.mock only applies in the file that declares it; this module gets
// them through `mocks`.

type AnyMock = Mock<(...args: any[]) => any>;
export type AdapterValidationMocks = {
  mockAgentService: Record<string, AnyMock>;
  mockAdapterPluginStore: Record<string, AnyMock>;
  mockAccessService: Record<string, AnyMock>;
  mockCompanySkillService: Record<string, AnyMock>;
  mockSecretService: Record<string, AnyMock>;
  mockAgentInstructionsService: Record<string, AnyMock>;
  mockBudgetService: Record<string, AnyMock>;
  mockHeartbeatService: Record<string, AnyMock>;
  mockIssueApprovalService: Record<string, AnyMock>;
  mockApprovalService: Record<string, AnyMock>;
  mockCheckProtectedKeys: AnyMock;
  mockInstanceSettingsService: Record<string, AnyMock>;
  mockManagedAgentProfileService: Record<string, AnyMock>;
  mockRemoteAgentProfileService: Record<string, AnyMock>;
  mockLogActivity: AnyMock;
  mockAntigravityModels: AnyMock;
};

/** The suite's beforeEach: fresh module mocks and default mock results. */
export async function resetAdapterValidationMocks(mocks: AdapterValidationMocks) {
  const { mockAgentService, mockAdapterPluginStore, mockAccessService, mockCompanySkillService, mockSecretService, mockAgentInstructionsService, mockCheckProtectedKeys, mockInstanceSettingsService, mockManagedAgentProfileService, mockRemoteAgentProfileService, mockLogActivity } = mocks;
  vi.stubEnv("PAPERCLIP_ACPX_CANDIDATE_ADMISSION", undefined);
  vi.resetModules();
  vi.doUnmock("../routes/agents.js");
  vi.doUnmock("../routes/authz.js");
  vi.doUnmock("../middleware/index.js");
  vi.doUnmock("../routes/agents.js");
  registerModuleMocks(mocks);
  vi.clearAllMocks();
  mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue([]);
  mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
  mockCompanySkillService.resolveRequestedSkillKeys.mockResolvedValue([]);
  mockAccessService.canUser.mockResolvedValue(true);
  mockAccessService.decide.mockResolvedValue({
    allowed: true,
    reason: "allow_explicit_grant",
    explanation: "Allowed by test grant",
  });
  mockAccessService.hasPermission.mockResolvedValue(true);
  mockAccessService.ensureMembership.mockResolvedValue(undefined);
  mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
  mockLogActivity.mockResolvedValue(undefined);
  mockSecretService.syncEnvBindingsForTarget.mockResolvedValue(undefined);
  mockInstanceSettingsService.get.mockResolvedValue({ defaultEnvironmentId: null });
  mockCheckProtectedKeys.mockReset();
  mockCheckProtectedKeys.mockResolvedValue([]);
  mockInstanceSettingsService.getExperimental.mockResolvedValue({ enableNativeRunner: false });
  mockManagedAgentProfileService.requireQualified.mockResolvedValue({
    id: "managed-primary",
    companyId: "company-1",
    enabled: true,
  });
  mockRemoteAgentProfileService.requireQualified.mockResolvedValue({
    id: "agentcore-primary",
    companyId: "company-1",
    enabled: true,
  });
  mockAgentInstructionsService.materializeManagedBundle.mockImplementation(async (agent: { adapterConfig: unknown }) => ({
    adapterConfig: agent.adapterConfig,
  }));
  mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
    id: String(input.id ?? "11111111-1111-4111-8111-111111111111"),
    companyId: "company-1",
    name: String(input.name ?? "Agent"),
    urlKey: "agent",
    role: String(input.role ?? "general"),
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: String(input.adapterType ?? "process"),
    adapterConfig: (input.adapterConfig as Record<string, unknown> | undefined) ?? {},
    runtimeConfig: (input.runtimeConfig as Record<string, unknown> | undefined) ?? {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  mockAgentService.getById.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Codex",
    urlKey: "codex",
    role: "engineer",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
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
  mockAgentService.getConfigRevision.mockResolvedValue(null);
  mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    ...(await mockAgentService.getById()),
    ...patch,
  }));
  await unregisterTestAdapter("external_test");
  await unregisterTestAdapter(missingAdapterType);
}

function registerModuleMocks(mocks: AdapterValidationMocks) {
  const { mockAgentService, mockAdapterPluginStore, mockAccessService, mockCompanySkillService, mockSecretService, mockAgentInstructionsService, mockBudgetService, mockHeartbeatService, mockIssueApprovalService, mockApprovalService, mockCheckProtectedKeys, mockInstanceSettingsService, mockManagedAgentProfileService, mockRemoteAgentProfileService, mockLogActivity, mockAntigravityModels } = mocks;
  vi.doMock("../services/protected-environment-keys.js", async () => ({
    ...await vi.importActual<typeof import("../services/protected-environment-keys.js")>("../services/protected-environment-keys.js"),
    checkAgentProtectedEnvironmentKeys: mockCheckProtectedKeys,
  }));
  vi.doMock("../services/antigravity-connection-models.js", () => ({ antigravityConnectionModels: mockAntigravityModels }));
  vi.doMock("../services/index.js", () => ({
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

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));

  vi.doMock("../services/managed-agent-profiles.js", () => ({
    managedAgentProfileService: () => mockManagedAgentProfileService,
  }));

  vi.doMock("../services/remote-agent-profiles.js", () => ({
    remoteAgentProfileService: () => mockRemoteAgentProfileService,
  }));

  // The adapter registry reads the disabled set from this store. Mock it so a
  // test can declare an adapter disabled without writing to the real
  // ~/.paperclip/adapter-settings.json.
  vi.doMock("../services/adapter-plugin-store.js", () => ({
    getDisabledAdapterTypes: mockAdapterPluginStore.getDisabledAdapterTypes,
    isAdapterDisabled: (type: string) =>
      mockAdapterPluginStore.getDisabledAdapterTypes().includes(type),
    listAdapterPlugins: () => [],
    getAdapterPluginByType: () => undefined,
    setAdapterDisabled: vi.fn(),
  }));
}

export const externalAdapter: ServerAdapterModule = {
  type: "external_test",
  execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
  testEnvironment: async () => ({
    adapterType: "external_test",
    status: "pass",
    checks: [],
    testedAt: new Date(0).toISOString(),
  }),
};

export const missingAdapterType = "missing_adapter_validation_test";

export async function createApp(actorOverride: Record<string, unknown> = {}) {
  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
      ...actorOverride,
    };
    next();
  });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          {
            id: "company-1",
            requireBoardApprovalForNewAgents: false,
          },
        ]),
      })),
    })),
  };
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

export async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

export async function unregisterTestAdapter(type: string) {
  const { unregisterServerAdapter } = await import("../adapters/index.js");
  unregisterServerAdapter(type);
}
