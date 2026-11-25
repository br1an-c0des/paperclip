import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  agents, agentWakeupRequests, authUsers, companies, companyMemberships, createDb, heartbeatRuns, issueComments, issues,
  projectWorkspaces, projects,
} from "@paperclipai/db";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { previewClaudeRun, sessionCodec as claudeSessionCodec } from "@paperclipai/adapter-claude-local/server";
import type { ClaudeRunPreview, RunPromptDraft, RunPromptSection } from "@paperclipai/shared";
import { issueService } from "../services/issues.js";
import { runPreviewService } from "../services/run-preview.js";
import { PREVIEW_DRAFT_ISSUE_ID } from "../services/run-preview-draft.js";
import { recoveryPostgresSupport, startRecoveryPostgres } from "./helpers/recovery-postgres.js";

// The New task dialog's prompt preview (fork/task-prompt-preview.md): POST
// /api/agents/:id/run-preview/draft's service. A task still being written previews as the task
// it becomes: its prompt is the one the existing-task preview drafts for the same task once
// created, apart from what only exists then (its id), and reading it writes nothing.

const adapter = vi.hoisted(() => ({ module: null as unknown }));
vi.mock("../adapters/index.js", () => ({
  getServerAdapter: () => adapter.module,
  findActiveServerAdapter: (type: string) => (type === "claude_local" ? adapter.module : null),
  runningProcesses: new Map(),
}));
const claudeAdapter: Partial<ServerAdapterModule> = {
  type: "claude_local",
  runtimeToolDelivery: "native_mcp",
  supportsLocalAgentJwt: true,
  sessionCodec: claudeSessionCodec,
  previewRun: previewClaudeRun,
};
adapter.module = claudeAdapter;

const FAKE_CLAUDE = `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("2.1.325 (Claude Code)"); process.exit(0); }
process.exit(1);
`;

describe.skipIf(!recoveryPostgresSupport.supported)("run preview of a task being written", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  let root: string;
  let fakeClaude: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "run-preview-draft-")));
    vi.stubEnv("PAPERCLIP_HOME", path.join(root, "home"));
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "run-preview-draft-test");
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "01234567890123456789012345678901");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "run-preview-draft-jwt-secret");
    vi.stubEnv("PAPERCLIP_API_URL", "http://127.0.0.1:3999");
    fakeClaude = path.join(root, "bin", "claude");
    await mkdir(path.dirname(fakeClaude), { recursive: true });
    await writeFile(fakeClaude, FAKE_CLAUDE, "utf8");
    await chmod(fakeClaude, 0o755);
    temporary = await startRecoveryPostgres("run-preview-draft-");
    db = createDb(temporary.connectionString);
  }, 60_000);

  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", [
    "-C", cwd, "-c", "user.name=M7 test", "-c", "user.email=m7@example.test", "-c", "commit.gpgsign=false", ...args,
  ]);

  /** A company, its owner, a claude_local CLI agent, and a project on a git checkout with a task in it. */
  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    const projectId = randomUUID(), projectWorkspaceId = randomUUID(), parentId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    const prefix = `D${companyId.slice(0, 5).toUpperCase()}`;
    await db.insert(companies).values({ id: companyId, name: "M7 test draft preview", issuePrefix: prefix,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false });
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", membershipRole: "owner", status: "active" });
    await db.insert(agents).values({
      id: agentId, companyId, name: "M7 test draft agent", status: "idle", adapterType: "claude_local",
      adapterConfig: { engine: "cli", command: fakeClaude, promptTemplate: "Do the work.", env: { CLAUDE_CODE_OAUTH_TOKEN: "test-oauth-token" } },
      runtimeConfig: { heartbeat: { wakeOnDemand: false } },
      permissions: { access: { level: "worker" } },
    });
    const repo = path.join(root, `repo-${projectId}`);
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "# M7 test\n", "utf8");
    await promisify(execFile)("git", ["init", "-q", "-b", "main", repo]);
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "M7 test initial commit");
    await db.insert(projects).values({ id: projectId, companyId, name: "M7 test draft project", status: "in_progress" });
    await db.insert(projectWorkspaces).values({ id: projectWorkspaceId, companyId, projectId, name: "Primary", isPrimary: true, cwd: repo });
    await db.insert(issues).values({
      id: parentId, companyId, projectId, projectWorkspaceId, identifier: `${prefix}-1`, issueNumber: 1,
      title: "M7 test parent", status: "in_progress", priority: "high", responsibleUserId: userId,
    });
    await db.update(companies).set({ issueCounter: 1 }).where(eq(companies.id, companyId));
    return { companyId, userId, agentId, projectId, parentId, repo, prefix };
  }

  async function readAgent(agentId: string) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    return agent!;
  }

  const draftPreview = async (seeded: Awaited<ReturnType<typeof seed>>, draft: RunPromptDraft) =>
    runPreviewService(db).previewAgentRun(await readAgent(seeded.agentId), {
      projectId: null, responsibleUserId: seeded.userId, draft,
    });

  function supported(preview: ClaudeRunPreview) {
    expect(preview.supported).toBe(true);
    if (!preview.supported) throw new Error("unsupported");
    expect(preview.prompt).not.toBeNull();
    return { ...preview, prompt: preview.prompt! };
  }

  /** Sections with the real task's id written as the draft's stand-in, and without preview marks. */
  const comparable = (sections: RunPromptSection[], realId?: string) => sections.map((section) => {
    const swap = (text: string) => (realId ? text.split(realId).join(PREVIEW_DRAFT_ISSUE_ID) : text);
    return {
      id: section.id,
      text: swap(section.text),
      parts: section.parts?.map((part) => ({ id: part.id, text: swap(part.text) })),
    };
  });

  it("drafts the prompt the existing-task preview gives the task once created with the same fields", async () => {
    const seeded = await seed();
    const draft: RunPromptDraft = {
      title: "M7 test drafted task",
      description: "Total the March ledger.\n\nThen compare it with February.",
      parentId: seeded.parentId,
      priority: "high",
      workMode: "planning",
    };
    const drafted = supported(await draftPreview(seeded, draft));
    expect(drafted.prompt).toMatchObject({ kind: "assignment", issueId: null });
    // The parent's project, as creating the task gives it.
    expect(drafted.project?.id).toBe(seeded.projectId);

    // The same task, created as the New task dialog creates it (a person, the parent kept).
    const created = await issueService(db).create(seeded.companyId, {
      title: draft.title, description: draft.description, parentId: draft.parentId, priority: draft.priority, workMode: draft.workMode,
      status: "todo", assigneeAgentId: seeded.agentId, createdByUserId: seeded.userId,
      parentDepthPolicy: "allow_nested",
    });
    expect(created.projectId).toBe(seeded.projectId);
    const real = supported(await runPreviewService(db).previewAgentRun(await readAgent(seeded.agentId), {
      projectId: null, responsibleUserId: seeded.userId, issueId: created.id, kind: "assignment",
    }));

    // The identifier is the one the task got: the draft predicts it.
    expect(created.identifier).toBe(`${seeded.prefix}-2`);
    // The task's content: in the brief, or with the task's facts under "The task" and its rules
    // under "What to do now" (step 5 phase 2, the task brief).
    const byId = (sections: RunPromptSection[], id: string) => sections.find((section) => section.id === id);
    const brief = (sections: RunPromptSection[]) => byId(sections, "task_brief");
    if (brief(drafted.prompt.firstMessage)) {
      expect(brief(drafted.prompt.firstMessage)!.text).toContain(`- Issue: "${created.identifier}"`);
      expect(brief(drafted.prompt.firstMessage)!.text).toContain("Planning mode directive:");
      expect(brief(drafted.prompt.firstMessage)!.text).toContain(`Parent: ${seeded.prefix}-1 M7 test parent (in_progress) [high]`);
      // The task brief matches, apart from the id.
      expect(comparable([brief(drafted.prompt.firstMessage)!])).toEqual(comparable([brief(real.prompt.firstMessage)!], created.id));
      // What exists only once the task does is marked: its identifier (and id).
      const issuePart = brief(drafted.prompt.firstMessage)!.parts!.find((part) => part.id === "task_brief.issue")!;
      expect(issuePart.pending).toMatch(/given when it's created/);
      expect(brief(real.prompt.firstMessage)!.parts!.find((part) => part.id === "task_brief.issue")!.pending).toBeUndefined();
    } else {
      expect(byId(drafted.prompt.firstMessage, "the_task")!.text).toContain(`Part of ${seeded.prefix}-1 "M7 test parent" (in progress).`);
      expect(byId(drafted.prompt.firstMessage, "to_do")!.text).toContain("planning mode");
    }

    // The whole first message matches, apart from the id; so does the system prompt.
    expect(comparable(drafted.prompt.firstMessage)).toEqual(comparable(real.prompt.firstMessage, created.id));
    expect(drafted.prompt.systemPrompt).toEqual(real.prompt.systemPrompt);
    expect(drafted.manifest).toEqual(real.manifest);

    // The worktree's branch, and the identifier, on the task line.
    const theTask = byId(drafted.prompt.firstMessage, "the_task")!;
    expect(theTask.text).toContain(created.identifier!);
    const taskLine = theTask.parts!.find((part) => part.id === "wake.task")!;
    expect(taskLine.text).toContain("branch `");
    expect(taskLine.pending).toMatch(/names the branch/);
    expect(taskLine.pending).toMatch(/given when it's created/);
  }, 90_000);

  it("takes the title from the description, and the workspace the draft chose", async () => {
    const seeded = await seed();
    const drafted = supported(await draftPreview(seeded, {
      description: "Reconcile the April invoices with the bank export.",
      projectId: seeded.projectId,
      executionWorkspacePreference: "shared_workspace",
      executionWorkspaceSettings: { mode: "shared_workspace" },
    }));
    const byId = (id: string) => drafted.prompt.firstMessage.find((section) => section.id === id);
    // In the brief, or with the task's facts in the wake (step 5 phase 2, the task brief).
    const brief = byId("task_brief");
    if (brief) {
      expect(brief.text).toContain(`- Title: "Reconcile the April invoices with the bank export."`);
      expect(brief.text).toContain("Task title directive:");
    } else {
      expect(byId("the_task")!.text).toContain("\"Reconcile the April invoices with the bank export.\"");
      expect(byId("to_do")!.text).toContain("`onlyIfProvisional: true`");
    }
    // The shared checkout: no worktree of its own, so no branch to name.
    expect(drafted.project?.checkout).toEqual({ kind: "local", path: seeded.repo });
    expect(byId("the_task")!.parts?.find((part) => part.id === "wake.task")?.text).not.toContain("branch `");
  }, 60_000);

  it("inserts nothing: no task, comment, run or wakeup", async () => {
    const seeded = await seed();
    const count = async () => ({
      issues: (await db.select({ id: issues.id }).from(issues).where(eq(issues.companyId, seeded.companyId))).length,
      comments: (await db.select({ id: issueComments.id }).from(issueComments).where(eq(issueComments.companyId, seeded.companyId))).length,
      runs: (await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, seeded.companyId))).length,
      wakeups: (await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, seeded.companyId))).length,
    });
    const before = await count();
    const [{ xmax: xmaxBefore }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    supported(await draftPreview(seeded, { title: "M7 test unsaved", description: "Nothing is made.", parentId: seeded.parentId }));
    supported(await draftPreview(seeded, { description: "M7 test untitled", projectId: seeded.projectId, workMode: "ask" }));
    const [{ xmax: xmaxAfter }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    // No transaction id was handed out: nothing was inserted, updated or deleted.
    expect(xmaxAfter).toBe(xmaxBefore);
    expect(await count()).toEqual(before);
    expect(before).toEqual({ issues: 1, comments: 0, runs: 0, wakeups: 0 });
  }, 60_000);
});
