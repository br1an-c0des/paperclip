import type { HeartbeatRunEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { findInvokeEvent, promptSize, readInvocation } from "./invocation";

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

  it("sizes a prompt in characters", () => {
    expect(promptSize("abc")).toBe("3 characters");
    expect(promptSize("x".repeat(1284))).toBe("1.3k characters");
    expect(promptSize(null)).toBeNull();
  });
});
