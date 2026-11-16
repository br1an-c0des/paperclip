import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import type { Agent } from "@paperclipai/shared";
import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeForm } from "./runtime-form";

type FormAgent = Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId">;

/** Claude Code's schema (packages/adapters/claude-local config-schema.ts), shortened. */
const CLAUDE_SCHEMA: AdapterConfigSchema = {
  fields: [
    { key: "engine", label: "Execution engine", type: "select", default: "auto", options: [{ value: "auto", label: "Default (ACP)" }, { value: "cli", label: "Claude CLI" }, { value: "acp", label: "ACP" }] },
    { key: "mode", label: "ACP session mode", type: "select", default: "persistent", options: [{ value: "persistent", label: "Persistent" }, { value: "oneshot", label: "One-shot" }], meta: { visibleWhen: { key: "engine", values: ["acp"] } } },
    { key: "stateDir", label: "ACP state directory", type: "text", meta: { visibleWhen: { key: "engine", values: ["acp"] } } },
  ],
};

/** Paperclip Runner's schema (server/src/adapters/registry.ts), shortened. */
const RUNNER_SCHEMA: AdapterConfigSchema = {
  fields: [
    { key: "provider", label: "Provider", type: "select", default: "codex", options: [{ value: "codex", label: "Codex" }, { value: "acpx", label: "ACP agents" }] },
    { key: "acpxAgent", label: "ACP agent", type: "select", default: "claude", options: [{ value: "claude", label: "Claude" }], meta: { visibleWhen: { key: "provider", value: "acpx" } } },
    { key: "codexPermissionMode", label: "Codex permission mode", type: "select", default: "never", options: [{ value: "never", label: "Automatic (isolated)" }], meta: { visibleWhen: { key: "provider", value: "codex" } } },
    {
      key: "acpxSessionMode",
      label: "Cursor mode",
      type: "select",
      default: "agent",
      options: [{ value: "agent", label: "Agent" }, { value: "plan", label: "Plan" }],
      meta: { visibleWhen: { key: "acpxAgent", value: "cursor" } },
    },
    {
      key: "acpxPermissionMode",
      label: "ACPX permission mode",
      type: "select",
      default: "approve-all",
      options: [{ value: "approve-all", label: "Full auto (approve all)" }, { value: "approve-reads", label: "Allow Paperclip reads" }, { value: "deny-all", label: "Deny all" }],
      meta: { visibleWhen: { key: "provider", value: "acpx" } },
    },
    { key: "lifecycleMode", label: "Runner lifecycle", type: "select", default: "per_turn", options: [{ value: "per_turn", label: "Turn by turn" }, { value: "warm", label: "Warm session" }] },
    { key: "idleTimeoutMs", label: "Warm idle timeout (ms)", type: "number", default: 300000, meta: { visibleWhen: { key: "lifecycleMode", value: "warm" } } },
  ],
};

const LEGACY: FormAgent = {
  adapterType: "claude_local",
  adapterConfig: { model: "claude-sonnet-5", effort: "high", dangerouslySkipPermissions: true, maxTurnsPerRun: 1000, extraArgs: ["--verbose"], timeoutSec: 0, graceSec: 15 },
  runtimeConfig: { heartbeat: { enabled: false } },
  defaultEnvironmentId: null,
};

/** The agent the server returns after the switch. */
const SWITCHED: FormAgent = {
  ...LEGACY,
  adapterType: "paperclip_runner",
  adapterConfig: { model: "claude-sonnet-5", modelReasoningEffort: "high", provider: "acpx", acpxAgent: "claude", acpxPermissionMode: "approve-all", timeoutSec: 0, graceSec: 15 },
};

const schemas: Record<string, AdapterConfigSchema> = { claude_local: CLAUDE_SCHEMA, paperclip_runner: RUNNER_SCHEMA };

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

/** A form over an agent and schemas the test changes, as the queries would. */
function mount(agent: FormAgent = LEGACY) {
  return createRoot((done) => {
    dispose = done;
    const [current, setAgent] = createSignal(agent);
    // The schema query is keyed by the adapter type; `loaded` false is its loading window.
    const [loaded, setLoaded] = createSignal(true);
    const form = createRuntimeForm({
      agent: current,
      schema: () => (loaded() ? schemas[current().adapterType] : undefined),
      runnerSchema: () => RUNNER_SCHEMA,
    });
    return { form, setAgent, setLoaded };
  });
}

const keys = (form: ReturnType<typeof mount>["form"]) => form.visibleFields().map((field) => field.key);

describe("createRuntimeForm", () => {
  it("leaves nothing pending once the switch is saved and the agent comes back on the Runner", () => {
    const { form, setAgent } = mount();
    form.setDraft("runner", "paperclip");
    expect(form.changes()).toEqual(["runner"]);
    // No reset() here: the adapter type changing is enough.
    setAgent(SWITCHED);
    expect(form.switching()).toBe(false);
    expect(form.changes()).toEqual([]);
    expect(form.draft.runner).toBeNull();
    expect(keys(form)).toEqual(["acpxPermissionMode", "lifecycleMode"]);
    expect(form.patch()).toEqual({ patch: null });
  });

  it("stays clean while the new harness's schema is still loading", () => {
    const { form, setAgent, setLoaded } = mount();
    form.setDraft("runner", "paperclip");
    setLoaded(false);
    setAgent(SWITCHED);
    expect(form.changes()).toEqual([]);
    setLoaded(true);
    expect(form.changes()).toEqual([]);
    expect(form.extras()).toMatchObject({ acpxPermissionMode: "approve-all", lifecycleMode: "per_turn" });
  });

  it("keeps your edits through a refetch of the same agent", () => {
    const { form, setAgent } = mount();
    form.setDraft("model", "claude-opus-5-5");
    form.setExtra("engine", "acp");
    setAgent({ ...LEGACY, adapterConfig: { ...LEGACY.adapterConfig, env: { DEBUG: "1" } } });
    expect(form.draft.model).toBe("claude-opus-5-5");
    expect(form.extras().engine).toBe("acp");
    expect(form.changes()).toEqual(["model", "engine"]);
  });

  it("takes a refetch's new values when you aren't editing", () => {
    const { form, setAgent } = mount();
    setAgent({ ...LEGACY, adapterConfig: { ...LEGACY.adapterConfig, graceSec: 20, engine: "cli" } });
    expect(form.draft.graceSec).toBe("20");
    expect(form.extras().engine).toBe("cli");
    expect(form.changes()).toEqual([]);
  });

  it("shows the Runner's settings while the switch is staged, valued as the switch saves them", () => {
    const { form } = mount();
    expect(keys(form)).toEqual(["engine", "dangerouslySkipPermissions", "maxTurnsPerRun"]);
    form.setDraft("runner", "paperclip");
    expect(form.switching()).toBe(true);
    expect(keys(form)).toEqual(["acpxPermissionMode", "lifecycleMode"]);
    expect(form.extras()).toMatchObject({ acpxPermissionMode: "approve-all", lifecycleMode: "per_turn" });
    expect(form.preview()?.dropped.map((entry) => [entry.key, entry.why])).toEqual([
      ["extraArgs", "unsupported"],
      ["dangerouslySkipPermissions", "unused"],
      ["maxTurnsPerRun", "unused"],
    ]);
    expect(form.shownAgent().adapterType).toBe("paperclip_runner");
    form.setExtra("lifecycleMode", "warm");
    expect(keys(form)).toEqual(["acpxPermissionMode", "lifecycleMode", "idleTimeoutMs"]);
    expect(form.changes()).toEqual(["runner", "lifecycleMode"]);
  });

  it("saves the switch and the edited Runner settings in one patch", () => {
    const { form } = mount();
    form.setDraft("runner", "paperclip");
    form.setExtra("acpxPermissionMode", "approve-reads");
    form.setExtra("lifecycleMode", "warm");
    form.setExtra("idleTimeoutMs", "600000");
    form.setDraft("model", "claude-opus-5-5");
    expect(form.patch()).toEqual({
      patch: {
        runner: "paperclip",
        replaceAdapterConfig: true,
        adapterConfig: {
          // The legacy config the server translates, less what the Runner can't honor (extraArgs)…
          model: "claude-opus-5-5",
          effort: "high",
          dangerouslySkipPermissions: true,
          maxTurnsPerRun: 1000,
          timeoutSec: 0,
          graceSec: 15,
          // …and the Runner settings you edited.
          acpxPermissionMode: "approve-reads",
          lifecycleMode: "warm",
          idleTimeoutMs: 600000,
        },
      },
    });
  });

  it("sends only the switch when nothing needs to change in the config", () => {
    const { form } = mount({ ...LEGACY, adapterConfig: { model: "claude-sonnet-5", dangerouslySkipPermissions: true } });
    form.setDraft("runner", "paperclip");
    expect(form.patch()).toEqual({ patch: { runner: "paperclip" } });
  });

  it("brings the legacy settings back as you left them when the switch is undone", () => {
    const { form } = mount();
    form.setExtra("engine", "acp");
    form.setDraft("runner", "paperclip");
    form.setExtra("lifecycleMode", "warm");
    form.setDraft("runner", null);
    expect(form.switching()).toBe(false);
    expect(keys(form)).toEqual(["engine", "mode", "stateDir", "dangerouslySkipPermissions", "maxTurnsPerRun"]);
    expect(form.extras().engine).toBe("acp");
    expect(form.changes()).toEqual(["engine"]);
    form.setDraft("runner", "paperclip");
    expect(form.extras().lifecycleMode).toBe("per_turn");
  });

  it("refuses the switch when the Runner can't take the setup as it is", () => {
    const { form } = mount({ ...LEGACY, adapterConfig: { env: { CLAUDE_CODE_USE_VERTEX: "1" } } });
    form.setDraft("runner", "paperclip");
    expect(form.patch()).toEqual({ problem: expect.stringMatching(/Pick a model first/) });
  });

  it("resets everything on reset(), as after a save", () => {
    const { form } = mount();
    form.setDraft("runner", "paperclip");
    form.setExtra("lifecycleMode", "warm");
    form.reset();
    expect(form.changes()).toEqual([]);
    expect(form.switching()).toBe(false);
  });
});

describe("the form's unsaved-change dots", () => {
  it("lights a setting's dot only while its edit counts, and puts it out when the value goes back", () => {
    const { form } = mount();
    expect(form.changed("model", "effort", "heartbeatEnabled", "intervalSec")).toBe(false);
    form.setDraft("model", "claude-opus-5-5");
    expect(form.changed("model")).toBe(true);
    expect(form.changed("effort")).toBe(false);
    // A row covering several settings is lit by any of them.
    form.setDraft("intervalSec", "900");
    expect(form.changed("heartbeatEnabled", "intervalSec")).toBe(true);
    expect(form.changes()).toEqual(["model", "intervalSec"]);
    form.setDraft("model", "claude-sonnet-5");
    expect(form.changed("model")).toBe(false);
    expect(form.changes()).toEqual(["intervalSec"]);
  });

  it("lights a harness setting's dot from its own saved value, and the Runner's from what the switch saves", () => {
    const { form } = mount();
    form.setExtra("engine", "acp");
    expect(form.extraChanged("engine")).toBe(true);
    expect(form.extrasBase().engine).toBe("auto");
    form.setExtra("engine", "auto");
    expect(form.extraChanged("engine")).toBe(false);

    form.setDraft("runner", "paperclip");
    // The Runner's settings start as the switch would save them: nothing lit but the runner.
    expect(form.visibleFields().some((field) => form.extraChanged(field.key))).toBe(false);
    form.setExtra("lifecycleMode", "warm");
    expect(form.extraChanged("lifecycleMode")).toBe(true);
    expect(form.extrasBase().lifecycleMode).toBe("per_turn");
  });

  it("puts every dot out on reset (Discard, or after a save)", () => {
    const { form } = mount();
    form.setDraft("model", "claude-opus-5-5");
    form.setDraft("chrome", true);
    form.setExtra("engine", "acp");
    form.reset();
    expect(form.changed("model", "chrome")).toBe(false);
    expect(form.extraChanged("engine")).toBe(false);
  });
});
