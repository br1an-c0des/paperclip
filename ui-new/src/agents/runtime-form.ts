import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import type { Agent } from "@paperclipai/shared";
import { batch, createEffect, createMemo, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { buildRuntimePatch, runnerCapable, runtimeChanges, runtimeDraft, runtimeIdentity, runtimeProblem, type RuntimeDraft } from "./agent-model";
import { extrasChanges, extrasConfig, extrasDraft, fieldVisible, harnessFields, type ExtrasDraft, type ExtraValue, type HarnessField } from "./harness-model";
import { runnerPreview, runnerSwitchConfig, type RunnerHarness, type RunnerPreview } from "./runner-switch-model";

/*
 * Model and runtime's form state (RuntimeSection): the draft of the section's own settings, the
 * harness settings, and a staged switch to Paperclip Runner, with what saving them sends.
 *
 * - The saved settings replace the draft when they change, unless you're editing, so a background
 *   refetch keeps your edits.
 * - After a save, and whenever the agent's harness or runner changes (its `adapterType`), the form
 *   resets to the saved settings: their fields are another harness's, so nothing is left pending.
 * - While the switch to Paperclip Runner is staged, the harness settings are the Runner's, valued
 *   as the switch will save them (runner-switch-model.ts) and editable; saving sends the switch and
 *   those settings in one patch, as one revision. Undoing the switch brings the legacy settings
 *   back as you left them.
 */

type FormAgent = Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId">;
type Config = Record<string, unknown>;

function record(value: unknown): Config {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Config) : {};
}

export function createRuntimeForm(input: {
  agent: () => FormAgent;
  /** The schema of the agent's adapter (`GET /adapters/:type/config-schema`). */
  schema: () => AdapterConfigSchema | null | undefined;
  /** Paperclip Runner's schema, needed while the switch to it is staged. */
  runnerSchema: () => AdapterConfigSchema | null | undefined;
}) {
  const config = () => record(input.agent().adapterConfig);
  const identity = createMemo(() => runtimeIdentity(input.agent()));
  const base = createMemo(() => runtimeDraft(input.agent()));
  const [draft, setDraft] = createStore<RuntimeDraft>({ ...base() });

  // The agent's own harness settings.
  const ownFields = createMemo(() => harnessFields(input.agent().adapterType, input.schema()));
  const ownBase = createMemo(() => extrasDraft(ownFields(), config()));
  const [own, setOwn] = createStore<ExtrasDraft>({ ...ownBase() });
  const ownChanges = createMemo(() => extrasChanges(ownBase(), own));

  /** The switch from the legacy runner to Paperclip Runner is staged. */
  const switching = createMemo(() => draft.runner === "paperclip" && identity().runner === "legacy" && runnerCapable(identity().harness));
  const runnerFields = createMemo(() => (switching() ? harnessFields("paperclip_runner", input.runnerSchema()) : []));
  /** The legacy config with the form's edits: what the switch starts from. */
  const legacyConfig = createMemo(() => {
    if (!switching()) return config();
    const entries = extrasConfig(ownFields(), ownBase(), { ...own }, config());
    const patch = buildRuntimePatch(input.agent(), { ...draft, runner: null }, base(), "entries" in entries ? entries.entries : {});
    return record(patch?.adapterConfig ?? config());
  });
  const preview = createMemo<RunnerPreview | null>(() =>
    switching() ? runnerPreview(identity().harness as RunnerHarness, legacyConfig(), [...ownFields(), ...runnerFields()]) : null,
  );
  const runnerBase = createMemo(() => {
    const view = preview();
    return view ? extrasDraft(runnerFields(), view.config) : {};
  });
  const [runner, setRunner] = createStore<ExtrasDraft>({});
  const runnerChanges = createMemo(() => (switching() ? extrasChanges(runnerBase(), runner) : []));

  const draftChanges = createMemo(() => runtimeChanges(base(), draft));
  const changes = createMemo(() => [...draftChanges(), ...ownChanges(), ...runnerChanges()]);
  /** Whether any of these settings has an edit `changes` counts: what lights a row's dot. */
  const changed = (...keys: (keyof RuntimeDraft)[]) => keys.some((key) => draftChanges().includes(key));

  /** Back to the saved settings, everything. */
  const reset = () =>
    batch(() => {
      setDraft(reconcile({ ...base() }));
      setOwn(reconcile({ ...ownBase() }));
      setRunner(reconcile({}));
    });

  /** When `source` changes, `apply` the new value if the draft still held the previous one (you weren't editing it). */
  const follow = <T,>(source: () => T, untouched: (previous: T) => boolean, apply: (next: T) => void) =>
    createEffect(on(source, (next, previous) => previous !== undefined && untouched(previous) && apply(next)));
  // The saved settings replace the draft when they change, unless you're editing.
  follow(base, (previous) => runtimeChanges(previous, draft).length === 0, (next) => setDraft(reconcile({ ...next })));
  // The harness settings too, which also change as their schema loads.
  follow(ownBase, (previous) => extrasChanges(previous, own).length === 0, (next) => setOwn(reconcile({ ...next })));
  // The Runner's settings follow the preview (its schema loading, the legacy edits under it) until you edit one.
  follow(runnerBase, (previous) => extrasChanges(previous, runner).length === 0, (next) => setRunner(reconcile({ ...next })));
  // Undoing the switch drops the Runner's settings.
  createEffect(on(switching, (staged) => !staged && setRunner(reconcile({})), { defer: true }));
  // Another harness or runner: the old fields no longer apply.
  const adapterType = createMemo(() => input.agent().adapterType);
  createEffect(on(adapterType, reset, { defer: true }));

  /** The harness settings the form shows: the Runner's while the switch is staged, else the agent's own. */
  const fields = () => (switching() ? runnerFields() : ownFields());
  const extras = (): ExtrasDraft => (switching() ? runner : own);
  /** The config the shown settings belong to: the Runner config the switch makes, or the saved one. */
  const fieldsConfig = () => preview()?.config ?? config();
  const visibleFields = createMemo(() => fields().filter((field) => fieldVisible(field, extras(), fieldsConfig())));
  const setExtra = (key: string, value: ExtraValue) => (switching() ? setRunner(key, value) : setOwn(key, value));
  /** The shown harness settings as saved (or, while the switch is staged, as the switch would save them). */
  const extrasBase = (): ExtrasDraft => (switching() ? runnerBase() : ownBase());
  /** Whether a shown harness setting has an edit `changes` counts. */
  const extraChanged = (key: string) => (switching() ? runnerChanges() : ownChanges()).includes(key);

  /** The agent as the form shows it: as a Runner agent while the switch is staged. */
  const shownAgent = createMemo<FormAgent>(() => {
    const view = preview();
    return view ? { ...input.agent(), adapterType: "paperclip_runner", adapterConfig: view.config } : input.agent();
  });

  /** The `PATCH /agents/:id` body for the form (null when nothing changed), or why it can't be saved. */
  const patch = (): { patch: Record<string, unknown> | null } | { problem: string } => {
    const found = runtimeProblem(draft);
    if (found) return { problem: found };
    const ownEntries = extrasConfig(ownFields(), ownBase(), { ...own }, config());
    if ("problem" in ownEntries) return ownEntries;
    const body = buildRuntimePatch(input.agent(), { ...draft }, base(), ownEntries.entries);
    const view = preview();
    if (!body || !view) return { patch: body };
    if (view.problem) return { problem: view.problem };
    const runnerEntries = extrasConfig(runnerFields(), runnerBase(), { ...runner }, view.config);
    if ("problem" in runnerEntries) return runnerEntries;
    const adapterConfig = runnerSwitchConfig(identity().harness as RunnerHarness, legacyConfig(), view, runnerEntries.entries);
    if (JSON.stringify(adapterConfig) !== JSON.stringify(config())) {
      body.adapterConfig = adapterConfig;
      body.replaceAdapterConfig = true;
    }
    return { patch: body };
  };

  return {
    identity,
    base,
    draft,
    setDraft,
    switching,
    preview,
    runnerFields,
    fields: fields as () => HarnessField[],
    visibleFields,
    extras,
    extrasBase,
    extraChanged,
    setExtra,
    fieldsConfig,
    shownAgent,
    changes,
    changed,
    reset,
    patch,
  };
}

export type RuntimeForm = ReturnType<typeof createRuntimeForm>;
