import type { HeartbeatRunEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { freshRecord, resumedRecord } from "./fixtures/prompt-records";
import { awaitingInvocationEvents, findInvokeEvent, findPromptEvent, promptSize, readInvocation, readPromptRecord, readRunManifest } from "./invocation";
import { accessText, claudeMdText, credentialText, instructionsText, repoSkillsSkipped, sessionText, skillGroups } from "./run-manifest";

describe("readInvocation", () => {
  const payload = {
    adapterType: "claude_local",
    cwd: "/Users/brian/paperclip/workspaces/TRA-41",
    command: "claude",
    commandArgs: ["--print", "-", "--resume", "7f3a", "--api-key", "sk-live-123"],
    commandNotes: ["Added /Users/brian/.paperclip/skills"],
    prompt: "You are agent 7c1e (Quant Researcher).",
    context: { wakeReason: "issue_commented", issueIdentifier: "TRA-41" },
    env: {
      PAPERCLIP_RUN_ID: "run_7",
      PAPERCLIP_API_KEY: "pcp_secret",
      BYBIT_API_KEY: { type: "secret_ref", secretId: "s1" },
      SESSION_TOKEN: "header.payload.signature",
      HOME: "/Users/brian",
    },
  };

  it("reads the prompt, wake context, command and environment", () => {
    const invocation = readInvocation(payload)!;
    expect(invocation.adapterType).toBe("claude_local");
    expect(invocation.prompt).toBe("You are agent 7c1e (Quant Researcher).");
    expect(JSON.parse(invocation.context!)).toEqual(payload.context);
    expect(invocation.command).toContain("claude --print - --resume 7f3a");
    expect(invocation.env.map((line) => line.key)).toEqual(["BYBIT_API_KEY", "HOME", "PAPERCLIP_API_KEY", "PAPERCLIP_RUN_ID", "SESSION_TOKEN"]);
  });

  it("hides secrets: secret-looking names, secret references, JWT-shaped values and secret flags", () => {
    const invocation = readInvocation(payload)!;
    const env = Object.fromEntries(invocation.env.map((line) => [line.key, line]));
    expect(env.PAPERCLIP_API_KEY).toMatchObject({ hidden: true });
    expect(env.PAPERCLIP_API_KEY!.value).not.toContain("pcp_secret");
    expect(env.BYBIT_API_KEY).toMatchObject({ hidden: true });
    expect(env.SESSION_TOKEN).toMatchObject({ hidden: true });
    expect(env.PAPERCLIP_RUN_ID).toEqual({ key: "PAPERCLIP_RUN_ID", value: "run_7", hidden: false });
    expect(invocation.command).not.toContain("sk-live-123");
  });

  it("masks the username in paths when the instance asks for it", () => {
    const invocation = readInvocation(payload, { censorUsername: true })!;
    expect(invocation.cwd).not.toContain("brian");
    expect(invocation.commandNotes[0]).not.toContain("brian");
    expect(invocation.env.find((line) => line.key === "HOME")!.value).not.toContain("brian");
  });

  it("pretty-prints a structured prompt and copes with an empty payload", () => {
    expect(readInvocation({ prompt: { system: "x" } })!.prompt).toBe('{\n  "system": "x"\n}');
    expect(readInvocation({})).toMatchObject({ prompt: null, context: null, command: null, env: [], commandNotes: [] });
    expect(readInvocation(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("finds the adapter.invoke event", () => {
    const events = [
      { eventType: "lifecycle", payload: null },
      { eventType: "adapter.invoke", payload: { prompt: "p" } },
    ] as HeartbeatRunEvent[];
    expect(findInvokeEvent(events)?.payload).toEqual({ prompt: "p" });
    expect(findInvokeEvent(undefined)).toBeNull();
  });

  it("finds and reads the adapter.prompt record, masking home-directory usernames when asked", () => {
    const record = { ...resumedRecord, firstMessage: [{ ...resumedRecord.firstMessage[0]!, text: "Work in /Users/brian/paperclip" }] };
    const events = [
      { eventType: "adapter.invoke", payload: { prompt: "p" } },
      { eventType: "adapter.prompt", payload: record },
    ] as unknown as HeartbeatRunEvent[];
    expect(findPromptEvent(events)?.payload).toBe(record);
    expect(findPromptEvent(undefined)).toBeNull();
    expect(readPromptRecord(record as unknown as Record<string, unknown>)).toEqual(record);
    expect(readPromptRecord(record as unknown as Record<string, unknown>, { censorUsername: true })!.firstMessage[0]!.text).not.toContain("brian");
    expect(readPromptRecord({ version: 2, systemPrompt: [], firstMessage: [] })).toBeNull();
    expect(readPromptRecord(null)).toBeNull();
  });

  describe("a resume that failed and retried fresh (two attempts)", () => {
    const resumedInvoke = { seq: 2, eventType: "adapter.invoke", payload: { command: "claude", commandArgs: ["--resume", "7f3a"], prompt: "resumed prompt" } };
    const resumedPrompt = { seq: 3, eventType: "adapter.prompt", payload: resumedRecord };
    const freshInvoke = { seq: 5, eventType: "adapter.invoke", payload: { command: "claude", commandArgs: ["--print", "-"], prompt: "fresh prompt" } };
    const freshPrompt = { seq: 6, eventType: "adapter.prompt", payload: freshRecord };
    const list = (...events: object[]) => events as unknown as HeartbeatRunEvent[];

    it("shows the fresh attempt that ran: its invocation and its record", () => {
      const events = list({ seq: 1, eventType: "lifecycle" }, resumedInvoke, resumedPrompt, { seq: 4, eventType: "lifecycle" }, freshInvoke, freshPrompt);
      const invocation = readInvocation(findInvokeEvent(events)?.payload)!;
      expect(invocation.prompt).toBe("fresh prompt");
      expect(invocation.command).toBe("claude --print -");
      expect(readPromptRecord(findPromptEvent(events)?.payload)!.session).toBe("fresh");
    });

    it("goes by seq, not by the list's order", () => {
      const events = list(freshPrompt, freshInvoke, resumedPrompt, resumedInvoke);
      expect(findInvokeEvent(events)?.payload).toBe(freshInvoke.payload);
      expect(findPromptEvent(events)?.payload).toBe(freshRecord);
    });

    it("doesn't pair the fresh invocation with the resume's record before the fresh record lands", () => {
      const events = list(resumedInvoke, resumedPrompt, freshInvoke);
      expect(findInvokeEvent(events)?.payload).toBe(freshInvoke.payload);
      expect(findPromptEvent(events)).toBeNull();
    });
  });

  it("reads a single attempt as before", () => {
    const events = [
      { seq: 1, eventType: "lifecycle", payload: null },
      { seq: 2, eventType: "adapter.invoke", payload: { prompt: "p" } },
      { seq: 3, eventType: "adapter.prompt", payload: freshRecord },
      { seq: 4, eventType: "assistant.message", payload: null },
    ] as unknown as HeartbeatRunEvent[];
    expect(findInvokeEvent(events)?.payload).toEqual({ prompt: "p" });
    expect(findPromptEvent(events)?.payload).toBe(freshRecord);
    expect(findPromptEvent(events.slice(0, 2))).toBeNull();
  });

  it("keeps polling a live run's events until adapter.invoke and its adapter.prompt are in, or the grace runs out", () => {
    const at = new Date("2026-11-23T12:00:00Z");
    const invoke = { eventType: "adapter.invoke", payload: {}, createdAt: at.toISOString() };
    const prompt = { eventType: "adapter.prompt", payload: freshRecord };
    const list = (...events: object[]) => events as unknown as HeartbeatRunEvent[];
    expect(awaitingInvocationEvents(undefined)).toBe(true);
    expect(awaitingInvocationEvents(list({ eventType: "lifecycle" }))).toBe(true);
    expect(awaitingInvocationEvents(list(invoke), at.getTime() + 2_000)).toBe(true);
    expect(awaitingInvocationEvents(list(invoke, prompt), at.getTime() + 2_000)).toBe(false);
    expect(awaitingInvocationEvents(list(invoke), at.getTime() + 60_000)).toBe(false);
  });

  it("sizes a prompt in characters", () => {
    expect(promptSize("abc")).toBe("3 characters");
    expect(promptSize("x".repeat(1284))).toBe("1.3k characters");
    expect(promptSize(null)).toBeNull();
  });
});

describe("the run manifest", () => {
  const manifest = {
    version: 1,
    engine: "cli",
    configDir: "/Users/brian/.paperclip/instances/default/companies/c/agents/a/claude",
    settingSources: ["user"],
    credential: { kind: "managed_connection", method: "subscription", connectionId: "conn-1", connectionName: "Max plan" },
    setAside: null,
    overriddenEnv: [],
    skills: [
      { name: "paperclip", key: "paperclipai/paperclip/paperclip", origin: "always_on", plugin: "paperclip" },
      { name: "review", key: "acme/skills/review", origin: "assigned", plugin: "company" },
      { name: "review", key: "repo:.claude/skills/review", origin: "repo", plugin: "project" },
    ],
    skillNameClashes: ["review"],
    builtInSkills: true,
    mcpServers: [{ name: "paperclip", url: "http://localhost:3100/mcp" }],
    strictMcpConfig: true,
    access: { level: "worker", overrides: { "agents:create": true } },
    instructions: { entryFile: "AGENTS.md", sent: true },
    claudeMd: { enabled: true, path: "/Users/brian/repo/CLAUDE.md" },
    repoSkills: { enabled: true, dir: "/Users/brian/repo/.claude/skills", count: 1 },
    autoMemory: false,
    envKeys: ["HOME", "PAPERCLIP_RUN_ID"],
    extraArgs: [],
    session: { mode: "fresh", reason: "prompt_bundle_changed" },
  } as const;

  it("reads the manifest from the adapter.invoke payload", () => {
    expect(readRunManifest({ command: "claude", runManifest: manifest })).toEqual(manifest);
    expect(readInvocation({ command: "claude", runManifest: manifest })!.manifest).toEqual(manifest);
  });

  it("is null without a manifest", () => {
    expect(readRunManifest({ command: "claude" })).toBeNull();
    expect(readRunManifest(null)).toBeNull();
    expect(readInvocation({ command: "claude" })!.manifest).toBeNull();
  });

  it("is null for a malformed manifest", () => {
    expect(readRunManifest({ runManifest: { ...manifest, version: 2 } })).toBeNull();
    expect(readRunManifest({ runManifest: { ...manifest, engine: "acp" } })).toBeNull();
    expect(readRunManifest({ runManifest: "manifest" })).toBeNull();
    expect(readRunManifest({ runManifest: [manifest] })).toBeNull();
  });

  it("masks the username in the manifest's paths when the instance asks for it", () => {
    const read = readInvocation({ runManifest: manifest }, { censorUsername: true })!.manifest!;
    expect(read.claudeMd).toMatchObject({ enabled: true });
    expect(JSON.stringify(read)).not.toContain("/Users/brian");
  });

  it("puts each part in words", () => {
    const read = readRunManifest({ runManifest: manifest })!;
    expect(credentialText(read.credential)).toBe("Claude subscription · connection Max plan");
    expect(credentialText({ kind: "agent_env", method: "api_key", connectionId: null, connectionName: null })).toBe("API key · from the agent's environment");
    expect(skillGroups(read)).toEqual([
      { plugin: "paperclip", label: "Paperclip", skills: [{ name: "paperclip", clash: false }] },
      { plugin: "company", label: "Company", skills: [{ name: "review", clash: true }] },
      { plugin: "project", label: "Repository", skills: [{ name: "review", clash: true }] },
    ]);
    expect(repoSkillsSkipped(read)).toBeNull();
    expect(repoSkillsSkipped({ ...read, repoSkills: { enabled: false, reason: "project_switch_off" } })).toBe("Off for this project");
    expect(claudeMdText(read)).toEqual({ loaded: true, text: "/Users/brian/repo/CLAUDE.md" });
    expect(claudeMdText({ ...read, claudeMd: { enabled: false, reason: "not_in_repo" } }).text).toBe("Not loaded: the run wasn't in the project's repository");
    expect(accessText(read.access)).toBe("Worker · Hire agents: on");
    expect(accessText(null)).toBe("Not recorded");
    expect(instructionsText(read.instructions)).toBe("AGENTS.md, sent");
    expect(sessionText(read.session, (id) => id)).toBe("A new session: the agent's skills or instructions changed");
    expect(sessionText({ mode: "resumed", sessionId: "s-1" }, (id) => id)).toBe("Resumed s-1");
  });

  it("copes with a manifest missing fields", () => {
    const partial = readRunManifest({ runManifest: { version: 1, engine: "cli" } })!;
    expect(skillGroups(partial)).toEqual([]);
    expect(claudeMdText(partial).text).toBe("Not recorded");
    expect(credentialText(partial.credential)).toBe("Not recorded");
    expect(sessionText(partial.session, (id) => id)).toBe("Not recorded");
  });
});
