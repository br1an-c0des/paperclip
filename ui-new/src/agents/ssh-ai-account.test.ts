import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  environmentsHref,
  isSshAiAccountRequired,
  SSH_AI_ACCOUNT_HINT,
  SSH_AI_ACCOUNT_TEXT,
  sshAiAccountProblem,
  testFailureText,
  usesAgentAiAccount,
} from "./ssh-ai-account";

const ssh = (config: Record<string, unknown>) => ({ driver: "ssh" as const, config });

describe("SSH environments on the agent's AI account (U157)", () => {
  it("applies only to SSH environments saved with useHostAuth false", () => {
    expect(usesAgentAiAccount(ssh({ useHostAuth: false }))).toBe(true);
    expect(usesAgentAiAccount(ssh({ useHostAuth: true }))).toBe(false);
    // Saved before #21248: no field is the remote machine's sign-in.
    expect(usesAgentAiAccount(ssh({}))).toBe(false);
    expect(usesAgentAiAccount({ driver: "sandbox", config: { useHostAuth: false } })).toBe(false);
    expect(usesAgentAiAccount(null)).toBe(false);
  });

  it("warns while no AI account is picked", () => {
    expect(sshAiAccountProblem(ssh({ useHostAuth: false }), null)).toBe(SSH_AI_ACCOUNT_HINT);
    expect(sshAiAccountProblem(ssh({ useHostAuth: false }), { provider: "anthropic", mode: "responsible_user" })).toBeNull();
    expect(sshAiAccountProblem(ssh({}), null)).toBeNull();
  });

  it("turns the server's 422 into plain words", () => {
    const required = new ApiError("Select an AI account…", 422, { error: "Select an AI account…", details: { code: "ssh_ai_connection_required" } });
    expect(isSshAiAccountRequired(required)).toBe(true);
    expect(isSshAiAccountRequired(new ApiError("Nope", 422, { error: "Nope" }))).toBe(false);
    expect(testFailureText(required, () => "other")).toBe(SSH_AI_ACCOUNT_TEXT);
    expect(testFailureText(new Error("boom"), (error) => (error as Error).message)).toBe("boom");
    expect(environmentsHref("TES")).toBe("/TES/company/settings/environments");
  });
});
