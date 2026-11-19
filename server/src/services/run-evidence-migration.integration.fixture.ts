import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@paperclipai/db";
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { vi } from "vitest";

// Shared setup for run-evidence-migration.integration.test.ts and its opt-in sibling
// run-evidence-migration.integration.dormant.test.ts: a throwaway schema with the tables the
// migration reads, a temporary directory and an S3 bucket.

export type RunEvidenceMigrationContext = { db?: Db; client?: S3Client; bucket?: string; directory?: string };

export async function setUpRunEvidenceMigration(context: RunEvidenceMigrationContext, schema: string,
  databaseUrl: string, endpoint: string) {
  context.db = createDb(databaseUrl, { maxConnections: 1 });
  await context.db.execute(sql.raw(`create schema ${schema}`));
  await context.db.execute(sql.raw(`set search_path=${schema}`));
  await context.db.execute(sql`create table heartbeat_runs (id uuid primary key, company_id uuid not null, agent_id uuid not null,
    status text not null, runtime_mode text default 'legacy', log_store text, log_ref text, log_bytes bigint, log_sha256 text, last_output_seq int not null default 0, controller_lease_expires_at timestamptz, started_at timestamptz, process_pid int, process_started_at timestamptz,
    runner_instance_id uuid, native_session_id uuid, native_phase text, runtime_mode_resolved_at timestamptz,
    process_group_id int, native_issue_id uuid, session_id_after text, controller_boot_id uuid,
    execution_stage text, result_json jsonb, runner_profile_json jsonb)`);
  await context.db.execute(sql`create table environment_leases(company_id uuid, heartbeat_run_id uuid)`);
  await context.db.execute(
    sql`create table native_run_finalizations(run_id uuid, company_id uuid, lease_expires_at timestamptz)`,
  );
  await context.db.execute(sql`create table heartbeat_run_events(company_id uuid,run_id uuid,seq bigint,payload jsonb,
    source_instance_id text,source_event_id text,source_seq bigint,source_payload_sha256 text,event_type text)`);
  await context.db.execute(sql`create table provider_trace_records (id uuid primary key, company_id uuid not null, run_id uuid not null,
    status text not null, provider text not null, trace_ref text not null, frame_count int not null default 0,
    byte_count bigint not null default 0, digest text, reason text, requested_by text not null, expires_at timestamptz not null,
    deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
  context.directory = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-migration-"));
  vi.stubEnv("PAPERCLIP_CONFIG", path.join(context.directory, "config.json"));
  vi.stubEnv("RUN_LOG_BASE_PATH", path.join(context.directory, "logs"));
  vi.stubEnv("PROVIDER_TRACE_BASE_PATH", path.join(context.directory, "traces"));
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "b".repeat(64));
  vi.stubEnv("PAPERCLIP_STORAGE_PROVIDER", "s3");
  vi.stubEnv("PAPERCLIP_STORAGE_S3_ENDPOINT", endpoint);
  vi.stubEnv("PAPERCLIP_STORAGE_S3_REGION", "us-east-1");
  vi.stubEnv("PAPERCLIP_STORAGE_S3_PREFIX", "");
  vi.stubEnv("PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE", "true");
  context.bucket = `paperclip-migration-test-${randomUUID()}`;
  vi.stubEnv("PAPERCLIP_STORAGE_S3_BUCKET", context.bucket);
  context.client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
  });
  await context.client.send(new CreateBucketCommand({ Bucket: context.bucket }));
}

export async function tearDownRunEvidenceMigration(context: RunEvidenceMigrationContext, schema: string) {
  const { db, client, bucket, directory } = context;
  if (client) {
    for (;;) {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (!page.Contents?.length) break;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: page.Contents.map((o) => ({ Key: o.Key! })) },
        }),
      );
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  }
  if (db) {
    await db.execute(sql.raw(`drop schema ${schema} cascade`));
    await db.$client.end();
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
}
