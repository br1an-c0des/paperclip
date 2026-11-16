import { describe, expect, it } from "vitest";
import { runnerPreview, runnerSwitchConfig } from "./runner-switch-model";

describe("runnerPreview", () => {
  it("translates a Claude Code agent as the server does: effort carried over, permissions defaulted, legacy-only settings left behind", () => {
    const view = runnerPreview("claude_local", {
      model: "claude-sonnet-5",
      effort: "high",
      dangerouslySkipPermissions: true,
      maxTurnsPerRun: 1000,
      chrome: false,
      engine: "auto",
      timeoutSec: 0,
      graceSec: 15,
      instructionsFilePath: "/agents/ada/AGENTS.md",
    });
    expect(view.config).toEqual({
      model: "claude-sonnet-5",
      modelReasoningEffort: "high",
      provider: "acpx",
      acpxAgent: "claude",
      acpxPermissionMode: "approve-all",
      timeoutSec: 0,
      graceSec: 15,
      instructionsFilePath: "/agents/ada/AGENTS.md",
    });
    expect(view.dropped).toEqual([
      { key: "dangerouslySkipPermissions", label: "Skip permission prompts", why: "unused" },
      { key: "maxTurnsPerRun", label: "Turns per run", why: "unused" },
      { key: "engine", label: "Execution engine", why: "unused" },
    ]);
    expect(view.changed).toEqual([{ key: "acpxPermissionMode", label: "ACPX permission mode", value: "approve-all" }]);
    expect(view.problem).toBeNull();
  });

  it("fills in Claude's default model and marks it as set by the switch", () => {
    const view = runnerPreview("claude_local", { dangerouslySkipPermissions: true });
    expect(view.config.model).toBe("claude-opus-5-5");
    expect(view.changed.map((entry) => entry.key)).toEqual(["model", "acpxPermissionMode"]);
  });

  it("leaves out the settings the Runner can't honor instead of failing the save", () => {
    const view = runnerPreview("claude_local", {
      model: "claude-sonnet-5",
      command: "/opt/claude-nightly",
      extraArgs: ["--verbose"],
      dangerouslySkipPermissions: false,
      permissionMode: "plan",
    });
    expect(view.dropped.filter((entry) => entry.why === "unsupported").map((entry) => entry.key).sort()).toEqual(
      ["command", "dangerouslySkipPermissions", "extraArgs", "permissionMode"],
    );
    expect(view.config).toEqual({ model: "claude-sonnet-5", provider: "acpx", acpxAgent: "claude", acpxPermissionMode: "approve-all" });
  });

  it("carries a legacy Claude permission mode the Runner accepts over to its own key", () => {
    const view = runnerPreview("claude_local", { model: "claude-sonnet-5", permissionMode: "deny-all" });
    expect(view.config.acpxPermissionMode).toBe("deny-all");
    expect(view.dropped).toEqual([]);
    expect(view.changed).toEqual([]);
  });

  it("can't switch a Claude agent on Bedrock without a model", () => {
    expect(runnerPreview("claude_local", { env: { CLAUDE_CODE_USE_BEDROCK: { type: "plain", value: "1" } } }).problem).toMatch(/Pick a model first/);
    expect(runnerPreview("claude_local", { env: { ANTHROPIC_MODEL: { type: "secret_ref", secretId: "s1" } } }).problem).toMatch(/ANTHROPIC_MODEL/);
  });

  it("translates Codex: web search left out, sandbox bypass unused, the Runner's default model and permission mode", () => {
    const view = runnerPreview("codex_local", { search: true, fastMode: false, dangerouslyBypassApprovalsAndSandbox: true, modelReasoningEffort: "high" });
    expect(view.config).toEqual({ provider: "codex", model: "gpt-6.1-sol", codexPermissionMode: "never", modelReasoningEffort: "high" });
    expect(view.dropped).toEqual([
      { key: "search", label: "Web search", why: "unsupported" },
      { key: "dangerouslyBypassApprovalsAndSandbox", label: "Bypass the sandbox", why: "unused" },
    ]);
    expect(view.changed.map((entry) => entry.key)).toEqual(["model", "codexPermissionMode"]);
  });

  it("turns Grok's web search off and replaces its legacy default model, as the server does", () => {
    const view = runnerPreview("grok_local", { model: "grok-build", reasoningEffort: "high" });
    expect(view.config).toEqual({
      provider: "acpx",
      acpxAgent: "grok",
      disableWebSearch: true,
      model: "grok-4.7",
      reasoningEffort: "high",
      acpxPermissionMode: "approve-all",
      lifecycleMode: "per_turn",
    });
    expect(view.changed.map((entry) => entry.key)).toEqual(["model", "disableWebSearch", "acpxPermissionMode", "lifecycleMode"]);
  });

  it("needs a provider/model for Pi and OpenCode", () => {
    expect(runnerPreview("pi_local", { model: "sonnet" }).problem).toMatch(/provider\/model/);
    expect(runnerPreview("pi_local", { model: "anthropic/claude-sonnet-5", thinking: "high" })).toMatchObject({
      problem: null,
      config: { provider: "acpx", acpxAgent: "pi", piThinkingLevel: "high" },
      dropped: [],
    });
    expect(runnerPreview("opencode_local", { model: "" }).problem).toMatch(/provider\/model/);
    expect(runnerPreview("opencode_local", { model: "openai/gpt-6", variant: "high", dangerouslySkipPermissions: true })).toMatchObject({
      problem: null,
      config: { provider: "opencode", model: "openai/gpt-6", opencodePermissionMode: "allow" },
      dropped: [
        { key: "variant", why: "unsupported" },
        { key: "dangerouslySkipPermissions", why: "unused" },
      ],
    });
  });
});

describe("runnerSwitchConfig", () => {
  it("sends the legacy config less what the Runner can't honor, plus the edited Runner settings", () => {
    const legacy = { model: "claude-sonnet-5", extraArgs: ["--verbose"], maxTurnsPerRun: 1000, permissionMode: "approve-reads", timeoutSec: 0 };
    const view = runnerPreview("claude_local", legacy);
    expect(view.config.acpxPermissionMode).toBe("approve-reads");
    expect(runnerSwitchConfig("claude_local", legacy, view, { acpxPermissionMode: "deny-all", lifecycleMode: "warm", idleTimeoutMs: undefined })).toEqual({
      model: "claude-sonnet-5",
      maxTurnsPerRun: 1000,
      timeoutSec: 0,
      acpxPermissionMode: "deny-all",
      lifecycleMode: "warm",
    });
  });
});
