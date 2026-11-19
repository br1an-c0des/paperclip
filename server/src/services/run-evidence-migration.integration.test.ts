// Run evidence migration to S3 for legacy run logs and provider traces. The native-run archive
// cases are in run-evidence-migration.integration.dormant.test.ts (opt-in tier); shared setup is
// in run-evidence-migration.integration.fixture.ts.
import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateRunEvidence } from "./run-evidence-migration.js";
import { createS3StorageProvider } from "../storage/s3-provider.js";
import { createObjectRunLogStore } from "./object-run-log-store.js";
import { createProviderTraceObjectStore } from "./provider-trace-object-store.js";
import { resolveExternalTestDatabaseUrl } from "../__tests__/helpers/external-test-database.js";
import { setUpRunEvidenceMigration, tearDownRunEvidenceMigration, type RunEvidenceMigrationContext } from "./run-evidence-migration.integration.fixture.js";

const endpoint = process.env.PAPERCLIP_LOG_TEST_S3_ENDPOINT;
const databaseUrl = resolveExternalTestDatabaseUrl("PAPERCLIP_RUN_EVIDENCE_MIGRATION_DATABASE_URL");
describe.skipIf(!endpoint || !databaseUrl)("run evidence migration (Postgres and S3)", () => {
  let db: Db, client: S3Client, bucket: string, directory: string;
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  const context: RunEvidenceMigrationContext = {};
  beforeAll(async () => {
    await setUpRunEvidenceMigration(context, schema, databaseUrl!, endpoint!);
    ({ db, client, bucket, directory } = context as Required<RunEvidenceMigrationContext>);
  }, 30_000);
  afterAll(async () => {
    await tearDownRunEvidenceMigration(context, schema);
  });
  it("preserves exact historical bytes and expiry, while refusing active/missing/corrupt sources", async () => {
    const company = randomUUID(),
      agent = randomUUID(),
      run = randomUUID(),
      trace = randomUUID(),
      filename = `${randomUUID()}.ndjson`;
    const log = Buffer.from(
      Array.from(
        { length: 100 },
        (_, i) =>
          JSON.stringify({
            ts: "then",
            seq: i + 1,
            stream: "stdout",
            chunk: `再開 ${i}`,
          }) + "\n",
      ).join(""),
    );
    const logRef = `${company}/${agent}/${run}.ndjson`;
    await fs.mkdir(path.dirname(path.join(directory, "logs", logRef)), {
      recursive: true,
    });
    await fs.writeFile(path.join(directory, "logs", logRef), log);
    await fs.mkdir(path.join(directory, "traces"), { recursive: true });
    const native = Buffer.from('{"kind":"frame","rawBase64":"e30="}\n'.repeat(33000).trimEnd()),
      rehydration = Buffer.from('{"kind":"interpretation","frameId":1}\n');
    const expectedTrace = Buffer.concat([native, Buffer.from("\n"), rehydration]);
    await fs.writeFile(path.join(directory, "traces", filename), native);
    await fs.writeFile(path.join(directory, "traces", `${filename}.rehydration`), rehydration);
    const expiry = new Date(Date.now() + 3600_000);
    await db.execute(
      sql`insert into heartbeat_runs(id, company_id, agent_id, status, log_store, log_ref, log_bytes, log_sha256, last_output_seq) values (${run}, ${company}, ${agent}, 'succeeded', 'local_file', ${logRef}, ${log.length}, ${createHash("sha256").update(log).digest("hex")}, 100)`,
    );
    await db.execute(sql`insert into provider_trace_records(id, company_id, run_id, status, provider, trace_ref, requested_by, expires_at, digest)
      values (${trace}, ${company}, ${run}, 'complete', 'codex', ${filename}, 'test', ${expiry.toISOString()}, ${`sha256:${createHash(
        "sha256",
      )
        .update(expectedTrace)
        .digest("hex")}`})`);
    const active = randomUUID(),
      missing = randomUUID(),
      corrupt = randomUUID();
    await db.execute(sql`insert into heartbeat_runs(id, company_id, agent_id, status, log_store, log_ref, log_bytes, log_sha256)
      values (${active}, ${company}, ${agent}, 'running', 'local_file', ${logRef}, ${log.length}, null),
      (${missing}, ${company}, ${agent}, 'succeeded', 'local_file', 'missing.ndjson', 10, null),
      (${corrupt}, ${company}, ${agent}, 'succeeded', 'local_file', ${logRef}, ${log.length + 1}, null)`);
    const legacyLease = randomUUID(),
      nativeLease = randomUUID(),
      leaseExpiry = new Date(Date.now() + 60_000).toISOString();
    await db.execute(sql`insert into heartbeat_runs(id, company_id, agent_id, status, log_store, log_ref, log_bytes, controller_lease_expires_at)
      values (${legacyLease}, ${company}, ${agent}, 'succeeded', 'local_file', ${logRef}, ${log.length}, ${leaseExpiry}),
      (${nativeLease}, ${company}, ${agent}, 'succeeded', 'local_file', ${logRef}, ${log.length}, null)`);
    await db.execute(
      sql`insert into native_run_finalizations values (${nativeLease}, ${company}, ${leaseExpiry})`,
    );
    const inventory = await migrateRunEvidence(db, {
      apply: false,
      companyId: company,
    });
    expect(inventory.items.find((i) => i.id === run)?.state).toBe("inventoried");
    const result = await migrateRunEvidence(db, {
      apply: true,
      companyId: company,
    });
    expect(result.items.filter((i) => i.state === "migrated")).toHaveLength(2);
    expect(result.items.filter((i) => i.state === "blocked")).toHaveLength(5);
    const records = await db.$client.unsafe(
      "select log_store, log_ref from heartbeat_runs where id=$1",
      [run],
    );
    expect(records[0].log_store).toBe("s3_segments");
    const provider = createS3StorageProvider({
      endpoint,
      bucket,
      region: "us-east-1",
      forcePathStyle: true,
    });
    const reader = createObjectRunLogStore({
      provider,
      keyPrefix: "run-logs",
      assertWriterAuthority: async () => {
        throw Error("read-only");
      },
    });
    await fs.rm(path.join(directory, "logs"), { recursive: true });
    await fs.rm(path.join(directory, "traces"), { recursive: true });
    expect(
      Buffer.from(
        (
          await reader.read({
            store: "s3_segments",
            logRef: records[0].log_ref,
          })
        ).content,
      ),
    ).toEqual(log);
    const saved = await db.$client.unsafe(
      "select trace_ref, expires_at, status from provider_trace_records where id=$1",
      [trace],
    );
    expect(new Date(saved[0].expires_at).getTime()).toBe(expiry.getTime());
    expect(saved[0].status).toBe("complete");
    expect(await createProviderTraceObjectStore(provider).read(saved[0].trace_ref)).toEqual(
      expectedTrace,
    );
  }, 30_000);
});
