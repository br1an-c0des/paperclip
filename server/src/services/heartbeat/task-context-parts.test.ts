import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { FAST_RESPONSE_AGENT_GUIDANCE } from "@paperclipai/shared";
import { joinPaperclipPromptParts } from "@paperclipai/adapter-utils/server-utils";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import {
  copyTaskMarkdownParts,
  PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY,
  PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY,
  prepareHeartbeatTaskContext,
  readTaskMarkdownParts,
} from "./task-context.js";

// The task brief's display parts on the run's context (step 5, Task 3): in memory only, redacted
// like the text, and dropped when they no longer join to it.

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping task context parts tests: ${support.reason}`);

describePostgres("task brief parts on the run context", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("task-context-parts-");
    db = createDb(temporary.connectionString);
  }, 30_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function prepare(input: {
    title: string; description: string; secret?: string; context?: Record<string, unknown>;
    experimental?: { enableFastResponses?: boolean };
  }) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Parts fixture", issuePrefix: `P${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Parts reader", adapterType: "claude_local", status: "idle" });
    await db.insert(issues).values({ id: issueId, companyId, title: input.title, description: input.description,
      status: "todo", assigneeAgentId: agentId, issueNumber: 1 });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, invocationSource: "on_demand",
      status: "running", contextSnapshot: { issueId } });
    if (input.secret) await createRunSecretRedactionRegistry(db).register(companyId, runId, input.secret);
    const context: Record<string, unknown> = input.context ?? {};
    context.issueId = issueId;
    await prepareHeartbeatTaskContext(db, {
      run: { id: runId },
      agent: { id: agentId, companyId, adapterType: "claude_local" },
      task: {
        issueRef: { id: issueId, identifier: "PART-1", title: input.title, status: "todo", priority: "medium",
          workMode: "standard", conversationAgentId: null, description: input.description, projectId: null },
        issueContext: null,
        context,
        taskSession: null,
      },
      policy: { trustPreset: { kind: "standard" } as never, experimentalInstanceSettings: input.experimental ?? {} },
      services: { issuesSvc: { getAncestors: async () => [] }, getPinnedSkillTestContext: async () => null },
    });
    return { context, runId };
  }

  it("joins to the redacted variants, and never reaches the saved snapshot or a copy", async () => {
    const secret = "parts-secret-canary";
    const { context, runId } = await prepare({ title: "Ship the ledger", description: `Use the key ${secret} to sign.`, secret });
    const assignment = readTaskMarkdownParts(context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY)!;
    const compact = readTaskMarkdownParts(context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY)!;
    expect(joinPaperclipPromptParts(assignment)).toBe(context.paperclipTaskMarkdownAssignment);
    expect(joinPaperclipPromptParts(compact)).toBe(context.paperclipTaskMarkdownAssignmentCompact);
    expect(assignment.find((part) => part.id === "task_brief.description")?.text).toContain(`Use the key ${REDACTED_EVENT_VALUE} to sign.`);
    expect(JSON.stringify(assignment)).not.toContain(secret);
    expect(compact.map((part) => part.id)).not.toContain("task_brief.description");

    for (const key of [PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY]) {
      expect(Object.keys(context)).not.toContain(key);
      expect(JSON.stringify(context)).not.toContain(key);
      expect({ ...context }).not.toHaveProperty(key);
    }
    await db.update(heartbeatRuns).set({ contextSnapshot: context }).where(eq(heartbeatRuns.id, runId));
    const [saved] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(saved!.contextSnapshot).toHaveProperty("paperclipTaskMarkdownAssignment");
    expect(saved!.contextSnapshot).not.toHaveProperty(PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY);
    expect(saved!.contextSnapshot).not.toHaveProperty(PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY);

    const copy: Record<string, unknown> = { ...context };
    copyTaskMarkdownParts(context, copy);
    expect(readTaskMarkdownParts(copy, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY)).toEqual(assignment);
    expect(JSON.stringify(copy)).not.toContain(PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY);
  });

  it("drops the parts when a secret spans two of them", async () => {
    // The secret runs from the title line into the description's heading, so redacting each part
    // alone misses it and the parts no longer join to the redacted text.
    const secret = 'TAILSECRET"\n\nIssue description:';
    const { context } = await prepare({ title: "Ship TAILSECRET", description: "Sign it.", secret });
    expect(context.paperclipTaskMarkdownAssignment).toContain(REDACTED_EVENT_VALUE);
    expect(readTaskMarkdownParts(context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY)).toBeNull();
    // The compact variant has no description, so nothing spans its parts and they stay.
    expect(joinPaperclipPromptParts(readTaskMarkdownParts(context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY)!))
      .toBe(context.paperclipTaskMarkdownAssignmentCompact);
  });

  // Step 5 phase 2, the system prompt: the note follows the instance's experimental flag.
  it("fast-response guidance only when enableFastResponses is on", async () => {
    const off = await prepare({ title: "Off", description: "No flag.", context: { paperclipTaskCommunicationGuidance: "FORGED" } });
    expect(String(off.context.paperclipTaskCommunicationGuidance ?? "")).not.toContain(FAST_RESPONSE_AGENT_GUIDANCE);
    expect(String(off.context.paperclipTaskCommunicationGuidance ?? "")).not.toContain("FORGED");
    const offExplicit = await prepare({ title: "Off", description: "Flag off.", experimental: { enableFastResponses: false } });
    expect(String(offExplicit.context.paperclipTaskCommunicationGuidance ?? "")).not.toContain(FAST_RESPONSE_AGENT_GUIDANCE);
    const on = await prepare({ title: "On", description: "Flag on.", experimental: { enableFastResponses: true } });
    expect(on.context.paperclipTaskCommunicationGuidance).toBe(FAST_RESPONSE_AGENT_GUIDANCE);
  });

  it("replaces parts left from an earlier preparation of the same context", async () => {
    const stale = [{ id: "task_brief.header", label: "stale", source: "stale", text: "stale" }];
    const context: Record<string, unknown> = {};
    Object.defineProperty(context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY, { value: stale, enumerable: false, configurable: true, writable: true });
    const prepared = await prepare({ title: "Fresh", description: "Fresh brief.", context });
    const parts = readTaskMarkdownParts(prepared.context, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY)!;
    expect(joinPaperclipPromptParts(parts)).toBe(prepared.context.paperclipTaskMarkdownAssignment);
  });
});
