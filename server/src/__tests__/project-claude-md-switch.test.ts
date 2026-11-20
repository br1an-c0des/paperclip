import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, createDb, projects as projectsTable } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { projectService } from "../services/projects.js";

// Step 4b, Task 9: the two per-project switches for sealed claude_local runs, "Agents read the
// repo's CLAUDE.md" (`agentsReadClaudeMd`) and "Agents use the repo's skills"
// (`agentsUseRepoSkills`). Both default on (migration 0492) and change independently.

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project switch tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("project repo-instruction switches (persistence)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let prefixCounter = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-project-claude-md-switch-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectsTable);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(): Promise<string> {
    prefixCounter += 1;
    const [company] = await db
      .insert(companies)
      .values({ name: "Switch Co", issuePrefix: `SWT${prefixCounter}` })
      .returning();
    return company.id;
  }

  it("reads true for both switches on a new project", async () => {
    const companyId = await seedCompany();
    const projects = projectService(db);

    const created = await projects.create(companyId, { name: "Repo" });
    expect(created.agentsReadClaudeMd).toBe(true);
    expect(created.agentsUseRepoSkills).toBe(true);

    const fetched = await projects.getById(created.id);
    expect(fetched?.agentsReadClaudeMd).toBe(true);
    expect(fetched?.agentsUseRepoSkills).toBe(true);
  });

  it("turns the CLAUDE.md switch off without touching the skills switch", async () => {
    const companyId = await seedCompany();
    const projects = projectService(db);
    const created = await projects.create(companyId, { name: "Repo" });

    const updated = await projects.update(created.id, { agentsReadClaudeMd: false });
    expect(updated?.agentsReadClaudeMd).toBe(false);
    expect(updated?.agentsUseRepoSkills).toBe(true);

    const fetched = await projects.getById(created.id);
    expect(fetched?.agentsReadClaudeMd).toBe(false);
    expect(fetched?.agentsUseRepoSkills).toBe(true);
  });

  it("turns the skills switch off without touching the CLAUDE.md switch", async () => {
    const companyId = await seedCompany();
    const projects = projectService(db);
    const created = await projects.create(companyId, { name: "Repo" });

    const updated = await projects.update(created.id, { agentsUseRepoSkills: false });
    expect(updated?.agentsUseRepoSkills).toBe(false);
    expect(updated?.agentsReadClaudeMd).toBe(true);

    const fetched = await projects.getById(created.id);
    expect(fetched?.agentsUseRepoSkills).toBe(false);
    expect(fetched?.agentsReadClaudeMd).toBe(true);
  });
});

// The route: PATCH /projects/:id passes each switch through to the service, and rejects a
// non-boolean with a 400. Services are mocked here (modelled on project-decision-owner-route).

const mockProjectService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
}));
const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(),
}));
const mockEnvironmentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
  getMembership: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/activity-log.js", async () => ({
    ...await vi.importActual<typeof import("../services/activity-log.js")>("../services/activity-log.js"),
    persistActivity: async (db: unknown, input: unknown) => {
      await mockLogActivity(db, input);
      return { activity: { id: "activity" }, publication: null };
    },
    publishActivity: vi.fn(),
  }));
  vi.doMock("../telemetry.js", () => ({ getTelemetryClient: mockGetTelemetryClient }));
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    environmentService: () => mockEnvironmentService,
    logActivity: mockLogActivity,
    projectService: () => mockProjectService,
    secretService: () => mockSecretService,
    workspaceOperationService: () => mockWorkspaceOperationService,
  }));
  vi.doMock("../services/environments.js", () => ({ environmentService: () => mockEnvironmentService }));
  vi.doMock("../services/secrets.js", () => ({ secretService: () => mockSecretService }));
  vi.doMock("../services/workspace-runtime.js", () => ({
    startRuntimeServicesForWorkspaceControl: vi.fn(),
    stopRuntimeServicesForProjectWorkspace: vi.fn(),
  }));
}

const BOARD_ACTOR = {
  type: "board",
  userId: "board-user",
  companyIds: ["company-1"],
  source: "local_implicit",
  isInstanceAdmin: false,
};

async function createApp() {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = BOARD_ACTOR;
    next();
  });
  app.use("/api", projectRoutes({ transaction: async (effect: (tx: unknown) => unknown) => effect({}) } as any));
  app.use(errorHandler);
  return app;
}

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "project-1",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Project",
    description: null,
    status: "backlog",
    leadAgentId: null,
    targetDate: null,
    color: null,
    env: null,
    agentsReadClaudeMd: true,
    agentsUseRepoSkills: true,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/tmp/project",
      effectiveLocalFolder: "/tmp/project",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("project repo-instruction switches (PATCH route)", { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/projects.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "project:read",
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockProjectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    mockProjectService.listWorkspaces.mockResolvedValue([]);
    mockProjectService.getById.mockResolvedValue(buildProject());
  });

  it.each([
    ["agentsReadClaudeMd"],
    ["agentsUseRepoSkills"],
  ])("passes %s: false through to the service", async (field) => {
    mockProjectService.update.mockResolvedValue(buildProject({ [field]: false }));
    const app = await createApp();

    const res = await request(app).patch("/api/projects/project-1").send({ [field]: false });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body[field]).toBe(false);
    expect(mockProjectService.update).toHaveBeenCalledWith("project-1", { [field]: false });
  });

  it.each([
    ["agentsReadClaudeMd", "no"],
    ["agentsUseRepoSkills", 0],
    ["agentsReadClaudeMd", null],
  ])("rejects %s: %j with 400", async (field, value) => {
    const app = await createApp();

    const res = await request(app).patch("/api/projects/project-1").send({ [field]: value });

    expect(res.status).toBe(400);
    expect(mockProjectService.update).not.toHaveBeenCalled();
  });
});
