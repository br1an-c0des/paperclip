import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  companySecrets,
  companySecretVersions,
  costEvents,
  createDb,
  environmentLeases,
  environments,
  executionWorkspaces,
  heartbeatRuns,
  issues,
  plugins,
  projects,
  workspaceOperations,
} from "@paperclipai/db";
import type { Environment, EnvironmentDriver, EnvironmentStatus } from "@paperclipai/shared";
import { secretService } from "../services/secrets.ts";

// Shared setup for environment-runtime.test.ts and its opt-in sibling
// environment-runtime.dormant.test.ts.

type Db = ReturnType<typeof createDb>;

/** A company, an agent, an environment (reusing the one local environment) and a running run. */
export async function seedEnvironmentFor(db: Db, input: {
  driver?: EnvironmentDriver;
  name?: string;
  status?: EnvironmentStatus;
  config?: Record<string, unknown>;
} = {}) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const environmentId = randomUUID();
  const runId = randomUUID();
  const driver: EnvironmentDriver = input.driver ?? "local";
  const environmentName = input.name ?? `${driver}-${environmentId.slice(0, 8)}`;
  let config = input.config ?? {};

  await db.insert(companies).values({
    id: companyId,
    name: "Acme",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(agents).values({
    id: agentId,
    companyId,
    name: "CodexCoder",
    role: "engineer",
    status: "active",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (typeof config.privateKey === "string" && config.privateKey.length > 0) {
    const secret = await secretService(db).create(companyId, {
      name: `environment-runtime-private-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: config.privateKey,
    });
    await secretService(db).createBinding({
      companyId,
      secretId: secret.id,
      targetType: "environment",
      targetId: environmentId,
      configPath: "privateKeySecretRef",
    });
    config = {
      ...config,
      privateKey: null,
      privateKeySecretRef: {
        type: "secret_ref",
        secretId: secret.id,
        version: "latest",
      },
    };
  }
  const existingLocalEnvironment = driver === "local"
    ? await db
      .select()
      .from(environments)
      .where(eq(environments.driver, "local"))
      .then((rows) => rows[0] ?? null)
    : null;
  const environmentRecord = existingLocalEnvironment ?? {
    id: environmentId,
    name: environmentName,
    description: null,
    driver,
    status: input.status ?? "active",
    config,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (!existingLocalEnvironment) {
    await db.insert(environments).values({
      id: environmentRecord.id,
      name: environmentRecord.name,
      driver: environmentRecord.driver,
      status: environmentRecord.status,
      config: environmentRecord.config,
      createdAt: environmentRecord.createdAt,
      updatedAt: environmentRecord.updatedAt,
    });
  }
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "manual",
    status: "running",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const environment: Environment = {
    id: environmentRecord.id,
    name: environmentRecord.name,
    description: environmentRecord.description,
    driver,
    status: environmentRecord.status as EnvironmentStatus,
    config: environmentRecord.config,
    envVars: {},
    metadata: environmentRecord.metadata,
    createdAt: environmentRecord.createdAt,
    updatedAt: environmentRecord.updatedAt,
  };

  return {
    companyId,
    agentId,
    environment,
    runId,
  };
}

/** The suite's afterEach table cleanup, children before parents. */
export async function cleanEnvironmentRuntimeTables(db: Db) {
  await db.delete(workspaceOperations);
  await db.delete(activityLog);
  await db.delete(environmentLeases);
  await db.delete(issues);
  await db.delete(costEvents);
  await db.delete(heartbeatRuns);
  await db.delete(agents);
  await db.delete(environments);
  await db.delete(executionWorkspaces);
  await db.delete(plugins);
  await db.delete(companySecretVersions);
  await db.delete(companySecrets);
  await db.delete(projects);
  await db.delete(companies);
}
