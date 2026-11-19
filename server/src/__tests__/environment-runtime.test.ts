// The environment runtime on the local driver: acquiring and releasing local run leases, and
// refusing drivers an adapter does not support. Sandbox, plugin, SSH and Runner leases are in
// environment-runtime.dormant.test.ts (opt-in tier); shared setup is in environment-runtime.fixture.ts.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { stopSshEnvLabFixture } from "@paperclipai/adapter-utils/ssh";
import { createDb, environmentLeases } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { classifyEnvironmentCapabilities, environmentRuntimeService } from "../services/environment-runtime.ts";
import { environmentService } from "../services/environments.ts";

import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { cleanEnvironmentRuntimeTables, seedEnvironmentFor } from "./environment-runtime.fixture.ts";

const externalTestDatabaseUrl = resolveExternalTestDatabaseUrl("PAPERCLIP_ENVIRONMENT_RUNTIME_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalTestDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres environment runtime tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("environmentRuntimeService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let connectionString: string;
  let runtime!: ReturnType<typeof environmentRuntimeService>;
  const fixtureRoots: string[] = [];
  // Give each test its own orphan-cleanup spool directory, so a spool file one
  // test writes never leaks into another test's flush. The default runtime reads
  // this env override when a test does not pass an explicit spool directory.
  let orphanCleanupSpoolDir: string | null = null;
  const previousOrphanCleanupSpoolDir = process.env.SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR;

  beforeAll(async () => {
    if (externalTestDatabaseUrl) connectionString = externalTestDatabaseUrl;
    else {
      const started = await startEmbeddedPostgresTestDatabase("environment-runtime");
      stopDb = started.cleanup;
      connectionString = started.connectionString;
    }
  });

  beforeEach(async () => {
    orphanCleanupSpoolDir = await mkdtemp(path.join(os.tmpdir(), "orphan-cleanup-spool-"));
    process.env.SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR = orphanCleanupSpoolDir;
    db = createDb(connectionString);
    runtime = environmentRuntimeService(db);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (orphanCleanupSpoolDir) {
      await rm(orphanCleanupSpoolDir, { recursive: true, force: true }).catch(() => undefined);
      orphanCleanupSpoolDir = null;
    }
    if (previousOrphanCleanupSpoolDir === undefined) {
      delete process.env.SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR;
    } else {
      process.env.SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR = previousOrphanCleanupSpoolDir;
    }
    while (fixtureRoots.length > 0) {
      const root = fixtureRoots.pop();
      if (!root) continue;
      await stopSshEnvLabFixture(path.join(root, "state.json")).catch(() => undefined);
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
    await cleanEnvironmentRuntimeTables(db);
    await db.$client.end({ timeout: 1 });
  });

  afterAll(async () => {
    await stopDb?.();
  });

  const seedEnvironment = (input?: Parameters<typeof seedEnvironmentFor>[1]) => seedEnvironmentFor(db, input);

  it("acquires and releases a projectless local run lease through the runtime seam", async () => {
    const { companyId, environment, runId } = await seedEnvironment();

    const acquired = await runtime.acquireRunLease({
      companyId,
      environment,
      issueId: null,
      heartbeatRunId: runId,
      persistedExecutionWorkspace: null,
    });

    expect(acquired.lease.status).toBe("active");
    expect(acquired.lease.executionWorkspaceId).toBeNull();
    expect(acquired.lease.metadata).toMatchObject({
      driver: "local",
      executionWorkspaceMode: null,
    });
    expect(acquired.leaseContext).toEqual({
      executionWorkspaceId: null,
      executionWorkspaceMode: null,
    });

    const released = await runtime.releaseRunLeases(runId);

    expect(released).toHaveLength(1);
    expect(released[0]?.environment.driver).toBe("local");
    expect(released[0]?.lease.status).toBe("released");

    const rows = await db
      .select()
      .from(environmentLeases)
      .where(eq(environmentLeases.id, acquired.lease.id));
    expect(rows[0]?.status).toBe("released");
  });

  it("rejects truly unsupported drivers before acquiring a lease", async () => {
    const { companyId, agentId, environment, runId } = await seedEnvironment({
      driver: "ssh",
      name: "Fixture SSH",
      config: {
        host: "ssh.example.test",
        port: 22,
        username: "ssh-user",
        remoteWorkspacePath: "/srv/paperclip/workspace",
        privateKey: null,
        knownHosts: null,
        strictHostKeyChecking: true,
      },
    });
    const runtimeWithoutSsh = environmentRuntimeService(db, {
      drivers: [
        {
          driver: "local",
          acquireRunLease: async () => {
            throw new Error("should not acquire");
          },
          releaseRunLease: async () => null,
          resolveCapabilities: async () => classifyEnvironmentCapabilities({ supportedCapabilities: new Set() }),
        },
      ],
    });

    await expect(
      runtimeWithoutSsh.acquireRunLease({
        companyId,
        environment,
        issueId: null,
        heartbeatRunId: runId,
        persistedExecutionWorkspace: null,
      }),
    ).rejects.toThrow('Environment driver "ssh" is not registered in the environment runtime yet.');

    const rows = await db.select().from(environmentLeases);
    expect(rows).toHaveLength(0);
  });

  it("releases with the driver captured on the lease even if the environment driver changes later", async () => {
    const { companyId, environment, runId } = await seedEnvironment();
    const environmentsSvc = environmentService(db);
    const localRelease = vi.fn(async ({ lease, status }: { lease: { id: string }; status: "released" | "expired" | "failed" }) =>
      await environmentsSvc.releaseLease(lease.id, status)
    );
    const sshRelease = vi.fn(async () => {
      throw new Error("ssh release should not be called");
    });
    const runtimeWithSpies = environmentRuntimeService(db, {
      drivers: [
        {
          driver: "local",
          acquireRunLease: async (input) => await environmentsSvc.acquireLease({
            companyId: input.companyId,
            environmentId: input.environment.id,
            executionWorkspaceId: input.executionWorkspaceId,
            issueId: input.issueId,
            heartbeatRunId: input.heartbeatRunId,
            metadata: {
              driver: input.environment.driver,
              executionWorkspaceMode: input.executionWorkspaceMode,
            },
          }),
          releaseRunLease: localRelease,
          resolveCapabilities: async () => classifyEnvironmentCapabilities({ supportedCapabilities: new Set() }),
        },
        {
          driver: "ssh",
          acquireRunLease: async () => {
            throw new Error("ssh acquire should not be called");
          },
          releaseRunLease: sshRelease,
          resolveCapabilities: async () => classifyEnvironmentCapabilities({ supportedCapabilities: new Set() }),
        },
      ],
    });

    const acquired = await runtimeWithSpies.acquireRunLease({
      companyId,
      environment,
      issueId: null,
      heartbeatRunId: runId,
      persistedExecutionWorkspace: null,
    });

    await environmentsSvc.update(environment.id, { driver: "ssh" });

    const released = await runtimeWithSpies.releaseRunLeases(runId);

    expect(released).toHaveLength(1);
    expect(localRelease).toHaveBeenCalledTimes(1);
    expect(sshRelease).not.toHaveBeenCalled();
    expect(acquired.lease.metadata?.driver).toBe("local");
  });

  it("test_release_run_leases_continues_after_first_release_fails", async () => {
    const { companyId, environment, runId } = await seedEnvironment();
    const environmentsSvc = environmentService(db);

    // Seed two active leases for one run. The first driver release throws; the
    // second must still release.
    const failingLease = await environmentsSvc.acquireLease({
      companyId,
      environmentId: environment.id,
      heartbeatRunId: runId,
      provider: "local",
      providerLeaseId: "fail-release",
      metadata: { driver: "local" },
    });
    const healthyLease = await environmentsSvc.acquireLease({
      companyId,
      environmentId: environment.id,
      heartbeatRunId: runId,
      provider: "local",
      providerLeaseId: "healthy-release",
      metadata: { driver: "local" },
    });

    const runtimeWithFailingDriver = environmentRuntimeService(db, {
      drivers: [
        {
          driver: "local",
          acquireRunLease: async () => {
            throw new Error("acquire should not be called");
          },
          releaseRunLease: async ({ lease, status }) => {
            if (lease.providerLeaseId === "fail-release") {
              throw new Error("driver release failed");
            }
            return await environmentsSvc.releaseLease(lease.id, status);
          },
          resolveCapabilities: async () => classifyEnvironmentCapabilities({ supportedCapabilities: new Set() }),
        },
      ],
    });

    const errors: Array<{ leaseId: string; error: unknown }> = [];
    const released = await runtimeWithFailingDriver.releaseRunLeases(
      runId,
      "released",
      (leaseId, error) => errors.push({ leaseId, error }),
    );

    // The healthy lease released even though the first release failed.
    expect(released).toHaveLength(1);
    expect(released[0]?.lease.id).toBe(healthyLease.id);
    expect(released[0]?.lease.status).toBe("released");

    // The failed release reported one lease-specific error.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.leaseId).toBe(failingLease.id);
    expect((errors[0]?.error as Error).message).toBe("driver release failed");

    // The database confirms the isolation. The healthy lease released; the
    // failing lease stayed active.
    const rows = await db.select().from(environmentLeases);
    expect(rows.find((row) => row.id === healthyLease.id)?.status).toBe("released");
    expect(rows.find((row) => row.id === failingLease.id)?.status).toBe("active");
  });
});
