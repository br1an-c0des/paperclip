import { describe, expect, it } from "vitest";
import { agentSupportsOverrides, effortKeyFor, effortOptions, mergeRunOverrides, readRunSettings, supportsOverrides } from "./run-overrides";

const values = (adapterType: string, model: string | null, config: Record<string, unknown> = {}) => effortOptions(adapterType, model, config).map((option) => option.value);

describe("which adapters take overrides", () => {
  it("covers the composer's eleven adapters, but not the runner's Muse provider", () => {
    for (const adapter of ["claude_local", "pi_local", "kimi_local", "gemini_local", "cursor_cloud", "hermes_local", "paperclip_runner"]) {
      expect(supportsOverrides(adapter)).toBe(true);
    }
    expect(supportsOverrides("http")).toBe(false);
    expect(agentSupportsOverrides({ adapterType: "paperclip_runner", adapterConfig: { provider: "muse" } })).toBe(false);
    expect(agentSupportsOverrides({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } })).toBe(true);
  });

  it("writes the effort under each adapter's own key", () => {
    expect(effortKeyFor("codex_local")).toBe("modelReasoningEffort");
    expect(effortKeyFor("grok_local")).toBe("reasoningEffort");
    expect(effortKeyFor("pi_local")).toBe("thinking");
    expect(effortKeyFor("gemini_local")).toBeNull();
  });
});

describe("effortOptions", () => {
  it("follows the model for Claude", () => {
    expect(values("claude_local", "claude-haiku-4-5")).toEqual([]);
    expect(values("claude_local", "claude-opus-5-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(values("claude_local", "claude-sonnet-4-6")).toEqual(["low", "medium", "high", "max"]);
    expect(values("claude_local", null)).toEqual(["low", "medium", "high"]);
  });

  it("follows the model for Codex and Grok, and the engine for Kimi", () => {
    expect(values("codex_local", "gpt-6-sol")).toContain("ultra");
    expect(values("grok_local", "grok-4.7")).toContain("xhigh");
    expect(values("grok_local", null)).toEqual(["low", "medium", "high"]);
    expect(values("kimi_local", null)).toEqual([]);
    expect(values("kimi_local", null, { engine: "cli" })).toEqual(["low", "high", "max"]);
    expect(values("paperclip_runner", "gpt-6-luna", { provider: "codex" })).toContain("max");
    expect(values("gemini_local", "gemini-3")).toEqual([]);
  });
});

describe("mergeRunOverrides", () => {
  it("replaces the old model and effort and keeps the other settings", () => {
    const previous = { adapterConfig: { model: "old", effort: "low", sandbox: true }, useProjectWorkspace: true };
    expect(mergeRunOverrides(previous, "claude_local", { model: "claude-opus-5-5", effort: "max" })).toEqual({
      adapterConfig: { sandbox: true, model: "claude-opus-5-5", effort: "max" },
      useProjectWorkspace: true,
    });
  });

  it("starts fresh on reassignment, and clears to null when nothing is left", () => {
    const previous = { adapterConfig: { model: "old", sandbox: true }, useProjectWorkspace: true };
    expect(mergeRunOverrides(previous, "codex_local", { model: null, effort: "high" }, true)).toEqual({ adapterConfig: { modelReasoningEffort: "high" } });
    expect(mergeRunOverrides({ adapterConfig: { model: "old" } }, "claude_local", { model: null, effort: null })).toBeNull();
  });

  it("reads the settings back", () => {
    expect(readRunSettings({ adapterConfig: { model: "m", reasoningEffort: "high" } }, "codex_local")).toEqual({ model: "m", effort: "high" });
    expect(readRunSettings(null, "claude_local")).toEqual({ model: null, effort: null });
  });
});
