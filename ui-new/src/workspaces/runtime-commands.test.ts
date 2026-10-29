import type { WorkspaceRuntimeService } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { WorkspaceOperationRow } from "@/api/heartbeats";
import { createdNote, operationDetails, phaseLabel, sortOperations } from "./operations-model";
import { commandDefinitions, runtimeControls } from "./runtime-commands";

const service = (fields: Partial<WorkspaceRuntimeService>): WorkspaceRuntimeService =>
  ({
    id: "svc-1",
    serviceName: "web",
    status: "running",
    lifecycle: "shared",
    command: "pnpm dev",
    cwd: null,
    port: 5173,
    url: "http://localhost:5173",
    healthStatus: "healthy",
    configIndex: 0,
    exposure: null,
    ...fields,
  }) as WorkspaceRuntimeService;

describe("runtime commands", () => {
  it("reads commands, or services and jobs, with stable ids", () => {
    expect(
      commandDefinitions({ commands: [{ name: "Web", command: "pnpm dev" }, { kind: "job", name: "Seed", command: "pnpm seed" }, { name: "Web" }] }).map(
        (command) => [command.id, command.kind, command.serviceIndex],
      ),
    ).toEqual([
      ["service:web", "service", 0],
      ["job:seed", "job", null],
      ["service:web-commands-3", "service", 1],
    ]);
    expect(commandDefinitions({ services: [{ id: "api", command: "node api.js" }], jobs: [{ command: "make" }] }).map((command) => command.id)).toEqual(["api", "job:job-1"]);
    expect(commandDefinitions(null)).toEqual([]);
  });

  it("offers Start for a configured service that has never run, and Run for a job", () => {
    const sections = runtimeControls({
      runtime: { services: [{ name: "web", command: "pnpm dev", port: 5173 }], jobs: [{ name: "Migrate", command: "pnpm migrate" }] },
      services: [],
      canRun: true,
    });
    expect(sections.services).toEqual([expect.objectContaining({ title: "web", status: "stopped", workspaceCommandId: "service:web", runtimeServiceId: null, disabledReason: null })]);
    expect(sections.jobs).toEqual([expect.objectContaining({ title: "Migrate", status: "run once", workspaceCommandId: "job:migrate", disabledReason: null })]);
  });

  it("matches a running service by config index and keeps one the config dropped apart", () => {
    const sections = runtimeControls({
      runtime: { services: [{ name: "web", command: "pnpm dev" }] },
      services: [service({}), service({ id: "svc-2", serviceName: "old", command: "python -m http.server", configIndex: null, port: 8000 })],
      canRun: true,
    });
    expect(sections.services[0]).toMatchObject({ status: "running", runtimeServiceId: "svc-1", url: "http://localhost:5173" });
    expect(sections.otherServices).toEqual([expect.objectContaining({ title: "old", runtimeServiceId: "svc-2", workspaceCommandId: null })]);
  });

  it("says why nothing can start in a workspace without a folder", () => {
    const sections = runtimeControls({ runtime: { services: [{ name: "web", command: "pnpm dev" }], jobs: [{ name: "x" }] }, services: [], canRun: false });
    expect(sections.services[0]!.disabledReason).toMatch(/no folder/);
    expect(sections.jobs[0]!.disabledReason).toBe("This job has no command.");
  });
});

const operation = (fields: Partial<WorkspaceOperationRow>): WorkspaceOperationRow =>
  ({ id: "op", phase: "worktree_prepare", status: "succeeded", metadata: null, startedAt: "2026-10-28T10:00:00Z", ...fields }) as WorkspaceOperationRow;

describe("workspace operations", () => {
  it("names phases and reads git details from the metadata", () => {
    expect(phaseLabel("worktree_prepare")).toBe("Worktree setup");
    expect(phaseLabel("something_new")).toBe("Something new");
    const prepared = operation({ metadata: { branchName: "pap/TES-7", baseRef: "main", created: true, extra: 1 } });
    expect(operationDetails(prepared)).toEqual([
      { label: "Branch", value: "pap/TES-7" },
      { label: "Base", value: "main" },
    ]);
    expect(createdNote(prepared)).toBe("Created the workspace");
    expect(createdNote(operation({}))).toBeNull();
  });

  it("lists the newest first", () => {
    const older = operation({ id: "a", startedAt: "2026-10-28T09:00:00Z" });
    const newer = operation({ id: "b", startedAt: "2026-10-28T11:00:00Z" });
    expect(sortOperations([older, newer]).map((item) => item.id)).toEqual(["b", "a"]);
  });
});
