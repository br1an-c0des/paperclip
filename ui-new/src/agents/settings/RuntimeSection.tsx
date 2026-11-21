import type { AdapterEnvironmentTestResult, AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeftRight, Check, ChevronRight, History, Wand2, Zap } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { accessApi } from "@/api/access";
import { adaptersApi, agentsApi } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { environmentsApi } from "@/api/environments";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { connectionChoices, providerForHarness } from "@/org/bulk-model";
import { FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  bindingText,
  harnessLabel,
  harnessType,
  HEARTBEAT_INTERVALS,
  intervalLabel,
  latestRevision,
  modelLabel,
  probeQualified,
  requalifyEnvironment,
  requalifyProblem,
  runnerCapable,
  runnerLabel,
  runnerOffer,
  runnerOptions,
  runnerSwitchable,
  runtimeEffortOptions,
  runtimeFields,
  runtimeIdentity,
} from "../agent-model";
import { failure, FootError, refreshAgent, SectionTitle, shortDate, SwitchRow } from "../shared";
import { resolveRunner } from "../new/new-agent-model";
import { extraChangedFrom, isSecretField, type ExtraValue, type HarnessField } from "../harness-model";
import { amountFrom, continueFrom, heartbeatFrom, onOff, textFrom } from "../runtime-dots";
import type { Changed } from "@/ui/changed";
import { createRuntimeForm } from "../runtime-form";
import type { DroppedSetting, RunnerPreview } from "../runner-switch-model";
import { EnvironmentMenu, HarnessDisc, instanceDefaultEnvironment, ModelMenu, TestChecks, useInstanceDefaultId } from "./fields";
import { HarnessChangeDialog } from "./HarnessChange";
import { RunnerStateCard } from "./RunnerStateCard";
import { testFailureText } from "../ssh-ai-account";
import { UsageLimitDetail, useUsageLimit } from "@/tasks/UsageLimit";

/*
 * Model and runtime (board 26): harness and model, where it runs, when it wakes, run limits,
 * debugging and Advanced, saved together as one configuration revision from the bar at the end.
 *
 * The runner is named everywhere the harness is ("Claude Code · Paperclip Runner"), since the
 * old UI showed "Claude Code" even after upgrading and kept the Runner under Advanced. Whether the
 * Runner can carry the harness comes from the adapters list for the agent's environment
 * (`supportedRunners`, `defaultRunner`); switching is part of the same save (`runner` in the
 * patch), after qualifying a sandbox environment when it needs that. While the switch is staged the
 * harness settings are the Runner's, as the switch will save them, and what it changes from the
 * legacy setup is listed with it (runtime-form.ts, runner-switch-model.ts).
 *
 * The AI connection is part of the same save (`runtimeConfig.aiConnection`); a pool (router)
 * binding is shown but not edited here. Harness settings come from the harness's own schema and the
 * old UI's hand-written fields (harness-model.ts). Changing the harness itself is its own step (a
 * dialog that saves at once), since the model, effort and harness settings all change with it. A
 * local harness's configured model on this machine (`detect-model`) is offered next to Model.
 *
 * The old adapter sign-in flows are dropped (decision 39, D8): AI connections replace them.
 */

export function RuntimeSection(props: { agent: AgentDetail; base: string }) {
  const company = useCompany();
  const client = useQueryClient();
  // The provider usage limit the harness last reported (U40), the same read as RunnerStateCard's.
  const usage = useUsageLimit(() => props.agent.id);
  // Harness settings: the schema's and hand-written fields, edited as text or switches.
  const schemaQuery = (type: () => string, enabled: () => boolean = () => true) =>
    createQuery(() => ({
      queryKey: queryKeys.agents.configSchema(type()),
      queryFn: ({ signal }) => adaptersApi.configSchema(type(), signal),
      enabled: enabled(),
      staleTime: 5 * 60_000,
      retry: false,
    }));
  const schema = schemaQuery(() => props.agent.adapterType);
  // The Runner's settings, shown while a switch to it is staged: loaded ahead for a harness it can carry.
  const runnerSchema = schemaQuery(
    () => "paperclip_runner",
    () => runnerCapable(runtimeIdentity(props.agent).harness),
  );
  const form = createRuntimeForm({ agent: () => props.agent, schema: () => schema.data, runnerSchema: () => runnerSchema.data });
  const { identity, base, draft, setDraft, changes } = form;
  const fields = createMemo(() => runtimeFields(form.shownAgent()));
  const [changingHarness, setChangingHarness] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const instanceDefaultId = useInstanceDefaultId();

  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
  }));
  const environment = createMemo(() =>
    draft.environmentId ? environments.data?.find((entry) => entry.id === draft.environmentId) : instanceDefaultEnvironment(environments.data, instanceDefaultId()),
  );
  const adapters = createQuery(() => ({
    queryKey: queryKeys.agents.adapters(company().id, props.agent.defaultEnvironmentId ?? null),
    queryFn: ({ signal }) => agentsApi.adapters(company().id, props.agent.defaultEnvironmentId ?? null, signal),
  }));
  const offer = createMemo(() => runnerOffer(props.agent, adapters.data, environment()));
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, identity().harness),
    queryFn: () => agentsApi.adapterModels(company().id, identity().harness),
    enabled: fields().model,
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const revisions = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "config-revisions"),
    queryFn: ({ signal }) => agentsApi.configRevisions(props.agent.id, company().id, signal),
    retry: false,
  }));
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess, retry: false }));
  const canTrace = () => access.data?.source === "local_implicit" || access.data?.isInstanceAdmin === true;
  const effortOptions = createMemo(() => runtimeEffortOptions(props.agent, draft.model));
  const latest = createMemo(() => latestRevision(revisions.data));

  const save = async () => {
    const built = form.patch();
    if ("problem" in built) return setProblem(built.problem);
    const patch = built.patch;
    if (!patch) return;
    setSaving(true);
    setProblem(null);
    try {
      // On a sandbox the Runner must first be qualified; the switch only goes ahead if it is.
      if (patch.runner === "paperclip" && offer().kind === "qualify") {
        const environmentId = environment()?.id;
        if (!environmentId) throw new Error("Pick the environment to qualify the Runner on.");
        const probe = await agentsApi.qualifyRunner(props.agent.id, environmentId, company().id);
        const why = probeQualified(probe);
        if (why) throw new Error(why);
        const after = await agentsApi.adapters(company().id, environmentId);
        if (!after.find((adapter) => adapter.type === identity().harness)?.supportedRunners?.includes("paperclip")) {
          throw new Error(`This environment doesn't support Paperclip Runner. ${props.agent.name} still uses the legacy runner.`);
        }
      }
      const saved = await agentsApi.update(props.agent.id, patch, company().id);
      // Saved: nothing is pending, whatever the refetch below brings (a switched runner's fields are new ones).
      form.reset();
      await Promise.all([
        refreshAgent(client, company().id, props.agent.id),
        client.invalidateQueries({ queryKey: queryKeys.agents.adapters(company().id, props.agent.defaultEnvironmentId ?? null) }),
      ]);
      const warnings = saved.configurationWarnings ?? [];
      pushToast({
        tone: warnings.length ? "warn" : "success",
        title: patch.runner ? `Switched to ${runnerLabel(patch.runner as "paperclip" | "legacy")}` : "Saved as a new revision",
        body: warnings.length ? warnings.map((warning) => warning.message).join(" ") : undefined,
      });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the changes."));
    } finally {
      setSaving(false);
    }
  };

  const config = () => props.agent.adapterConfig as Record<string, unknown>;
  const stagedRunner = () => draft.runner;
  /** The runner the Runner row shows: the staged switch, or the agent's own. */
  const shownRunner = () => stagedRunner() ?? identity().runner;
  const recommendedRunner = () => resolveRunner(identity().harness, "auto", adapters.data).recommended;
  /** The Runner row's visible line: the current runner's setup, a staged switch, or why there's no switch. */
  const runnerNote = () => {
    if (shownRunner() === "paperclip") {
      if (identity().runner === "paperclip") return runnerDetail(config());
      return offer().kind === "qualify"
        ? `Saving probes ${environment()?.name ?? "the environment"} first, and switches only if the Runner qualifies there. The model and instructions stay.`
        : "The model and instructions stay.";
    }
    if (offer().kind === "none" && offer().reason === "not-supported-here") return "Paperclip Runner isn't available for this harness in this environment.";
    return identity().runner === "paperclip" ? "The model and instructions stay." : undefined;
  };
  /**
   * When a scheduled check-in is skipped: a Paperclip Runner agent takes none without a task
   * (`supportsUnscopedTimerHeartbeat`), and one with `skipTimerWhenNoActionableWork` (set for agents
   * made in this UI) none while it has no todo or in-progress task (`heartbeat/timer-policy.ts`).
   */
  const heartbeatNote = () => {
    if (shownRunner() === "paperclip" && identity().runnerApplies) return "Paperclip Runner agents don't take scheduled check-ins without a task.";
    const heartbeat = (props.agent.runtimeConfig as Record<string, unknown> | null)?.heartbeat as Record<string, unknown> | undefined;
    const skips = heartbeat?.skipTimerWhenNoActionableWork ?? heartbeat?.requireActionableTimerWork ?? heartbeat?.issueOnlyTimer;
    return skips === true ? "Skips check-ins while it has no open task." : undefined;
  };
  /** An environment as its dot names it: "Instance default", or its name. */
  const environmentName = (id: string) => (id ? (environments.data?.find((entry) => entry.id === id)?.name ?? "an environment you can't see") : "Instance default");
  const runs = (value: string) => (value === "1" ? "run" : "runs");

  return (
    <>
      <SectionTitle
        title="Model and runtime"
        info={`How ${props.agent.name} runs: harness and model, where it runs, when it wakes, its limits. Changes here are saved together as one new revision.`}
      />

      <Show when={offer().kind === "upgrade" || offer().kind === "qualify"}>
        <div class="ag-note" role="note">
          <span class="ag-note-icon" aria-hidden="true">
            <Zap size={18} />
          </span>
          <div class="ag-note-text">
            <b>{stagedRunner() === "paperclip" ? `Switches to Paperclip Runner when you save` : `Paperclip Runner can run ${props.agent.name}`}</b>
            <span>
              {offer().kind === "qualify"
                ? `Saving probes ${environment()?.name ?? "the environment"} first, and switches only if the Runner qualifies there. The model and instructions stay.`
                : "Switching keeps the model and instructions. It is saved with your other changes, as one revision."}
            </span>
            <Show when={form.preview()}>{(view) => <SwitchSummary preview={view()} fields={form.runnerFields()} />}</Show>
          </div>
          <Show
            when={stagedRunner() !== "paperclip"}
            fallback={
              <Button size="compact" variant="quiet" onClick={() => setDraft("runner", null)}>
                Undo
              </Button>
            }
          >
            <Button size="compact" onClick={() => setDraft("runner", "paperclip")}>
              Switch to Paperclip Runner
            </Button>
          </Show>
        </div>
      </Show>

      <SettingsCard
        title="Harness and model"
        footer={
          <TestEnvironment
            agent={props.agent}
            environmentId={draft.environmentId || null}
            qualifyEnvironmentId={requalifyEnvironment(props.agent, { dirty: changes().length > 0, environment: environment(), adapters: adapters.data })}
            dirty={changes().length > 0}
          />
        }
      >
        <SettingsRow label="Harness" info="The program the agent runs in.">
          <div class="ps-inline">
            <span class="ag-static">
              <HarnessDisc harness={identity().harness} />
              {identity().harnessLabel}
            </span>
            <Button
              size="compact"
              variant="quiet"
              icon={<ArrowLeftRight size={14} aria-hidden="true" />}
              disabled={changes().length > 0}
              title={changes().length > 0 ? "Save or discard your changes first" : undefined}
              onClick={() => setChangingHarness(true)}
            >
              Change harness
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Runner"
          info="What starts and supervises the harness for each run. Paperclip Runner supervises it; the legacy runner runs the harness program directly."
          changed={form.changed("runner") && { from: runnerLabel(identity().runner) }}
        >
          <Show when={identity().runnerApplies} fallback={<span class="ag-static-text">Not applicable: {identity().harnessLabel} runs only on the legacy runner.</span>}>
            <div class="ps-stack">
              {/* Where the adapters allow a switch either way, the runner is a choice like the other settings, staged until you save. */}
              <Show
                when={runnerSwitchable(offer())}
                fallback={
                  <TonePill tone={identity().runner === "paperclip" ? "run" : "violet"} compact>
                    {runnerLabel(identity().runner)}
                  </TonePill>
                }
              >
                <Segmented
                  label="Runner"
                  options={runnerOptions(recommendedRunner())}
                  value={shownRunner()}
                  onChange={(value) => setDraft("runner", value === identity().runner ? null : value)}
                />
              </Show>
              <Show when={runnerNote()}>
                <span class="fhelp">{runnerNote()}</span>
              </Show>
            </div>
          </Show>
        </SettingsRow>
        <SignInRow agent={props.agent} value={draft.connection} saved={base().connection} onChange={(value) => setDraft("connection", value)} />
        <Show when={usage()}>
          {(limit) => (
            <SettingsRow label="Usage limit" info={`What ${limit().provider} last reported for this sign-in's limits. Queued work waits while a limit is used up.`}>
              <UsageLimitDetail limit={limit()} />
            </SettingsRow>
          )}
        </Show>
        <Show when={fields().model}>
          <SettingsRow label="Model" changed={form.changed("model") && { from: modelLabel(base().model, models.data) ?? "the default" }}>
            <ModelMenu models={models.data} loading={models.isLoading} value={draft.model} onChange={(model) => setDraft("model", model)} />
            <DetectedModel agent={props.agent} harness={identity().harness} value={draft.model} onUse={(model) => setDraft("model", model)} />
          </SettingsRow>
        </Show>
        <Show when={fields().effort && effortOptions().length > 0}>
          <SettingsRow
            label="Thinking effort"
            info="More effort is slower and costs more."
            changed={form.changed("effort") && { from: effortOptions().find((option) => option.value === base().effort)?.label ?? (base().effort || "Auto") }}
          >
            <Segmented
              label="Thinking effort"
              options={[{ value: "", label: "Auto" }, ...effortOptions()]}
              value={draft.effort}
              onChange={(value) => setDraft("effort", value)}
            />
          </SettingsRow>
        </Show>
      </SettingsCard>

      <Show
        when={form.switching()}
        fallback={
          <Show when={form.fields().length > 0}>
            <SettingsCard title="Harness settings" info={`Options of ${identity().harnessLabel} itself. Saved with your other changes.`}>
              <For each={form.visibleFields()}>
                {(field) => <ExtraFieldRow field={field} value={form.extras()[field.key]} saved={config()[field.key]} changed={form.extraChanged(field.key) && extraChangedFrom(field, form.extrasBase()[field.key])} onChange={(value) => form.setExtra(field.key, value)} />}
              </For>
            </SettingsCard>
          </Show>
        }
      >
        <SettingsCard
          title="Paperclip Runner settings"
          info={`How Paperclip Runner will run ${identity().harnessLabel}: the settings carried over from the legacy runner and the Runner's defaults. Saved with the switch.`}
        >
          <Show when={runnerSchema.data} fallback={<p class="ps-muted-line">{runnerSchema.isError ? "Couldn't load the Runner's settings. The switch saves with its defaults." : "Loading the Runner's settings…"}</p>}>
            <For each={form.visibleFields()}>
              {(field) => <ExtraFieldRow field={field} value={form.extras()[field.key]} saved={form.fieldsConfig()[field.key]} changed={form.extraChanged(field.key) && extraChangedFrom(field, form.extrasBase()[field.key])} onChange={(value) => form.setExtra(field.key, value)} />}
            </For>
          </Show>
        </SettingsCard>
      </Show>

      <SettingsCard title="Where it runs">
        <SettingsRow
          label="Environment"
          info="Where the agent's runs happen. Left on the default, it uses the instance's default environment, or the Paperclip server's own machine when none is set."
          changed={form.changed("environmentId") && { from: environmentName(base().environmentId) }}
        >
          <EnvironmentMenu environments={environments.data} value={draft.environmentId} onChange={(id) => setDraft("environmentId", id)} />
        </SettingsRow>
        <Show when={fields().browser}>
          <SwitchRow label="Browser access" info="Lets the agent open and read web pages in a real browser (Chrome)." checked={draft.chrome} changed={form.changed("chrome") && { from: onOff(base().chrome) }} onChange={(value) => setDraft("chrome", value)} />
        </Show>
      </SettingsCard>

      <SettingsCard title="When it wakes">
        <SwitchRow
          label="When there is work"
          info="Wakes it for anything but the heartbeat: a task assigned, a mention or message, a routine, or Run now. Off, all of these are skipped."
          help={draft.wakeOnDemand ? undefined : "Off: assignments, messages, routines and Run now don't wake it."}
          checked={draft.wakeOnDemand}
          changed={form.changed("wakeOnDemand") && { from: onOff(base().wakeOnDemand) }}
          onChange={(value) => setDraft("wakeOnDemand", value)}
        />
        <SwitchRow
          label="On a heartbeat"
          info="Also wakes it on a schedule, to check in even when nothing is new."
          help={draft.heartbeatEnabled ? heartbeatNote() : undefined}
          checked={draft.heartbeatEnabled}
          changed={form.changed("heartbeatEnabled", "intervalSec") && heartbeatFrom(base(), draft)}
          onChange={(value) => setDraft("heartbeatEnabled", value)}
        >
          <Show when={draft.heartbeatEnabled}>
            <Menu>
              <Menu.Trigger as={FieldButton} class="ps-field-220" aria-label="Heartbeat interval">
                {intervalLabel(Number(draft.intervalSec) || 0)}
              </Menu.Trigger>
              <Menu.Content label="Heartbeat interval" width={220}>
                <For each={HEARTBEAT_INTERVALS}>
                  {(entry) => (
                    <Menu.Item onSelect={() => setDraft("intervalSec", String(entry.sec))} hint={Number(draft.intervalSec) === entry.sec ? <Check size={14} /> : undefined}>
                      {entry.label}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </Show>
        </SwitchRow>
        <NumberRow
          label="Cooldown"
          info="The shortest gap between two runs."
          help="Not used by the server yet."
          unit="seconds"
          changed={form.changed("cooldownSec") && amountFrom(base().cooldownSec, () => "seconds")}
          value={draft.cooldownSec}
          onInput={(value) => setDraft("cooldownSec", value)}
        />
        <NumberRow label="Runs at once" info="How many of its runs may happen at the same time (1 to 50)." unit={runs(draft.maxConcurrentRuns)} changed={form.changed("maxConcurrentRuns") && amountFrom(base().maxConcurrentRuns, runs)} value={draft.maxConcurrentRuns} onInput={(value) => setDraft("maxConcurrentRuns", value)} />
      </SettingsCard>

      <Show when={fields().timeouts}>
        <SettingsCard title="Run limits">
          <NumberRow label="Timeout" info="A run is stopped after this long. 0 means no limit." unit="minutes" changed={form.changed("timeoutMin") && amountFrom(base().timeoutMin, () => "minutes")} value={draft.timeoutMin} onInput={(value) => setDraft("timeoutMin", value)} />
          <NumberRow label="Grace period" info="Time a run gets to wrap up after it is stopped, before it's force-killed." unit="seconds" changed={form.changed("graceSec") && amountFrom(base().graceSec, () => "seconds")} value={draft.graceSec} onInput={(value) => setDraft("graceSec", value)} />
          <SwitchRow
            label="Continue after a turn limit"
            info="When the harness stops at its turn limit, start a follow-up run that picks up where it left off."
            checked={draft.continueEnabled}
            changed={form.changed("continueEnabled", "continueAttempts", "continueDelaySec") && continueFrom(base())}
            onChange={(value) => setDraft("continueEnabled", value)}
          >
            <Show when={draft.continueEnabled}>
              <div class="ag-inline-fields">
                Up to
                <TextInput class="ag-num ag-num--small" inputmode="numeric" aria-label="Follow-up runs" value={draft.continueAttempts} onInput={(event) => setDraft("continueAttempts", event.currentTarget.value)} />
                more runs,
                <TextInput class="ag-num ag-num--small" inputmode="numeric" aria-label="Seconds between follow-up runs" value={draft.continueDelaySec} onInput={(event) => setDraft("continueDelaySec", event.currentTarget.value)} />
                seconds apart
              </div>
            </Show>
          </SwitchRow>
        </SettingsCard>
      </Show>

      <Show when={canTrace()}>
        <SettingsCard title="Debugging">
          <SwitchRow
            label="Capture raw provider traces"
            info="Records the full model input and output of every run and keeps it for 24 hours. Only instance admins can read traces. Turn it on while you investigate a problem."
            checked={draft.providerTrace}
            changed={form.changed("providerTrace") && { from: onOff(base().providerTrace) }}
            onChange={(value) => setDraft("providerTrace", value)}
          />
        </SettingsCard>
      </Show>

      <RunnerStateCard agent={props.agent} />

      <Show when={fields().command || fields().promptTemplate}>
        <details class="card ag-advanced">
          <summary>
            <span class="ag-rot" aria-hidden="true">
              <ChevronRight size={14} />
            </span>
            <b>Advanced</b>
            <span>Command, arguments and prompt templates</span>
            {/* Folded, its rows' dots are out of sight: the summary carries one too. */}
            <Show when={form.changed("command", "extraArgs", "promptTemplate")}>
              <span class="changed-dot-led ag-advanced-dot" aria-hidden="true" />
              <span class="sr-only">Unsaved changes</span>
            </Show>
          </summary>
          <div class="settings-rows">
            <Show when={fields().command}>
              <SettingsRow label="Command" info="Leave empty to use the harness default." for="ag-command" changed={form.changed("command") && textFrom(base().command, "the harness default")}>
                <TextInput id="ag-command" class="mono" spellcheck={false} autocomplete="off" placeholder={identity().harness.replace(/_local$/, "")} value={draft.command} onInput={(event) => setDraft("command", event.currentTarget.value)} />
              </SettingsRow>
              <SettingsRow label={props.agent.adapterType === "process" ? "Arguments" : "Extra arguments"} info="Separated by commas." for="ag-args" changed={form.changed("extraArgs") && textFrom(base().extraArgs, "none")}>
                <TextInput id="ag-args" class="mono" spellcheck={false} autocomplete="off" placeholder="--verbose" value={draft.extraArgs} onInput={(event) => setDraft("extraArgs", event.currentTarget.value)} />
              </SettingsRow>
            </Show>
            <Show when={fields().promptTemplate}>
              <SettingsRow label="Prompt template" info="Sent at the start of every run. Keep it small; long-lived guidance belongs in Instructions." for="ag-prompt" changed={form.changed("promptTemplate") && textFrom(base().promptTemplate, "not set")}>
                <TextArea id="ag-prompt" class="mono" rows={4} spellcheck={false} value={draft.promptTemplate} placeholder="Not set" onInput={(event) => setDraft("promptTemplate", event.currentTarget.value)} />
              </SettingsRow>
              <SettingsRow label="Bootstrap prompt" help="Legacy. Move it into Instructions.">
                <Show when={typeof config().bootstrapPromptTemplate === "string" && config().bootstrapPromptTemplate} fallback={<span class="ag-static-text">Not set</span>}>
                  <pre class="ag-pre mono">{String(config().bootstrapPromptTemplate)}</pre>
                </Show>
              </SettingsRow>
            </Show>
          </div>
        </details>
      </Show>

      <div class="ag-savebar" classList={{ "ag-savebar--dirty": changes().length > 0 }} role="region" aria-label="Save changes">
        <History size={14} aria-hidden="true" />
        <span class="ag-savebar-meta">
          <Show when={latest()} fallback="No saved revisions yet">
            {(found) => `Revision ${found().number}, saved ${shortDate(found().revision.createdAt)}${found().revision.createdByUserId ? "" : found().revision.createdByAgentId ? " by an agent" : ""}`}
          </Show>
        </span>
        <A class="ps-link" href={`${props.base}/history`}>
          History
        </A>
        <span class="ag-savebar-end">
          <FootError message={problem()} />
          <Show when={changes().length > 0}>
            <span class="ag-changed">{changes().length === 1 ? "1 unsaved change" : `${changes().length} unsaved changes`}</span>
            <Button
              size="compact"
              variant="quiet"
              disabled={saving()}
              onClick={() => {
                setProblem(null);
                form.reset();
              }}
            >
              Discard
            </Button>
          </Show>
          <Button size="compact" variant="primary" disabled={saving() || changes().length === 0} onClick={() => void save()}>
            {saving() ? "Saving…" : `Save as revision ${(latest()?.number ?? 0) + 1}`}
          </Button>
        </span>
      </div>
      <Show when={changingHarness()}>
        <HarnessChangeDialog agent={props.agent} adapters={adapters.data} onClose={() => setChangingHarness(false)} />
      </Show>
    </>
  );
}

/**
 * What the staged switch changes from the legacy setup: the settings it sets (the Runner's defaults,
 * or values it carries over differently), the ones the switch leaves out because the Runner can't
 * honor them (the server would refuse the save), and the ones the Runner has no use for.
 */
function SwitchSummary(props: { preview: RunnerPreview; fields: readonly HarnessField[] }) {
  const shown = (key: string, value: unknown) => {
    const option = props.fields.find((field) => field.key === key)?.options?.find((entry) => entry.value === value);
    if (option) return option.label;
    if (typeof value === "boolean") return value ? "on" : "off";
    return typeof value === "string" ? value : JSON.stringify(value);
  };
  const labels = (why: DroppedSetting["why"]) => [...new Set(props.preview.dropped.filter((entry) => entry.why === why).map((entry) => entry.label))].join(", ");
  return (
    <ul class="ag-switch-summary" aria-label="What the switch changes">
      <Show when={props.preview.problem}>
        <li class="ag-switch-problem" role="alert">
          {props.preview.problem}
        </li>
      </Show>
      <Show when={props.preview.changed.length > 0}>
        <li>
          Set by the switch:{" "}
          <For each={props.preview.changed}>
            {(entry, index) => (
              <>
                {index() > 0 ? ", " : ""}
                {entry.label} <b>{shown(entry.key, entry.value)}</b>
              </>
            )}
          </For>
        </li>
      </Show>
      <Show when={labels("unsupported")}>
        <li>Left out, since the Runner can't honor them: {labels("unsupported")}</li>
      </Show>
      <Show when={labels("unused")}>
        <li>Not used on the Runner: {labels("unused")}</li>
      </Show>
    </ul>
  );
}

/** "Claude Code through ACP (acpx)". */
function runnerDetail(config: Record<string, unknown>) {
  const provider = String(config.provider ?? "codex");
  if (provider === "acpx") return `Paperclip's runner carries the harness over ACP (acpx, agent “${String(config.acpxAgent ?? "claude")}”).`;
  if (provider === "codex") return "Paperclip's runner drives the Codex app server.";
  if (provider === "opencode") return "Paperclip's runner drives the OpenCode server.";
  return `Paperclip's runner, provider “${provider}”.`;
}

/** The AI connection the harness signs in with, from the agent's binding and the company's connections. */
function SignInRow(props: { agent: AgentDetail; value: string; saved: string; onChange: (value: string) => void }) {
  const company = useCompany();
  const harness = () => harnessType(props.agent.adapterType, props.agent.adapterConfig as Record<string, unknown>);
  const provider = () => providerForHarness(harness());
  const parse = (value: string) => (value ? (JSON.parse(value) as Record<string, unknown>) : undefined);
  const binding = () => parse(props.value);
  const connections = createQuery(() => ({
    queryKey: [...queryKeys.aiConnections.list(company().id), "agent", props.agent.id],
    queryFn: () => aiConnectionsApi.list(company().id, props.agent.id),
    enabled: Boolean(binding()) || Boolean(provider()),
    retry: false,
  }));
  const choices = createMemo(() => (provider() ? connectionChoices(connections.data, provider()!) : []));
  const connectionOf = (current: Record<string, unknown> | undefined) =>
    current ? connections.data?.connections.find((entry) => entry.id === current.connectionId || entry.grantId === current.grantId) : undefined;
  const connection = createMemo(() => connectionOf(binding()));
  const mode = () => String(binding()?.mode ?? "");
  const router = () => mode() === "router";
  /** A binding as the row names it; `inline` for the middle of a sentence ("Changed from its own sign-in"). */
  const labelOf = (value: string, inline = false) => {
    const current = parse(value);
    const found = connectionOf(current);
    if (found) return `${found.method === "subscription" ? "Subscription" : "API key"} · ${found.name}`;
    const text = !current
      ? "Its own sign-in"
      : current.mode === "router"
        ? "A connection pool"
        : current.mode === "responsible_user"
          ? "The responsible person's connection"
          : "An AI connection";
    return inline ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  };
  const label = () => labelOf(props.value);
  return (
    <SettingsRow label="Sign-in" info="How the harness reaches the model." changed={props.value !== props.saved && { from: labelOf(props.saved, true) }}>
      <div class="ps-stack">
        <div class="ps-inline ps-inline--spread">
          <Show when={!router()} fallback={<TonePill tone="violet" compact>Routed through a connection pool</TonePill>}>
            <Show
              when={provider()}
              fallback={<span class="ag-static-text">{binding() ? label() : "No AI connection: the harness uses its own sign-in on the machine it runs on."}</span>}
            >
              <Menu>
                <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label={`Sign-in: ${label()}`}>
                  {label()}
                </Menu.Trigger>
                <Menu.Content label="Sign-in" width={360}>
                  <Menu.Item description="The harness's own login on the machine it runs on" hint={props.value ? undefined : <Check size={14} />} onSelect={() => props.onChange("")}>
                    Its own sign-in
                  </Menu.Item>
                  <Menu.Separator />
                  <Show when={connections.isLoading}>
                    <p class="nt-menu-note">Loading connections…</p>
                  </Show>
                  <For each={choices()}>
                    {(choice) => (
                      <Menu.Item
                        description={choice.description}
                        disabled={choice.disabled}
                        hint={bindingText(choice.binding) === props.value ? <Check size={14} /> : undefined}
                        onSelect={() => props.onChange(bindingText(choice.binding))}
                      >
                        {choice.name}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </Show>
            <Show when={connection() && connection()!.status !== "connected"}>
              <span class="ag-changed">{connection()!.status}</span>
            </Show>
          </Show>
          <A class="ps-link" href={`/${company().issuePrefix}/connections/ai`}>
            Manage connections
          </A>
        </div>
      </div>
    </SettingsRow>
  );
}

/**
 * The model a local harness's own configuration names on the server's machine
 * (`GET /companies/:id/adapters/:type/detect-model`), offered when it differs from the pick. Not
 * asked for OpenCode (its models are `provider/model`) or Runner agents, as in the old form.
 */
function DetectedModel(props: { agent: AgentDetail; harness: string; value: string; onUse: (model: string) => void }) {
  const company = useCompany();
  const applies = () =>
    props.agent.adapterType !== "paperclip_runner" && props.agent.adapterType !== "opencode_local" && runtimeFields(props.agent).command;
  const detected = createQuery(() => ({
    queryKey: queryKeys.agents.detectModel(company().id, props.agent.adapterType),
    queryFn: ({ signal }) => agentsApi.detectModel(company().id, props.agent.adapterType, signal),
    enabled: applies(),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  return (
    <Show when={applies() && detected.data?.model && detected.data.model !== props.value ? detected.data : null}>
      {(found) => (
        <span class="ag-detected">
          <Wand2 size={13} aria-hidden="true" />
          {found().source ? `This machine's ${harnessLabel(props.harness)} settings (${found().source}) use ` : `This machine's ${harnessLabel(props.harness)} settings use `}
          <span class="mono">{found().model}</span>
          <button type="button" class="ps-link" onClick={() => props.onUse(found().model)}>
            Use it
          </button>
        </span>
      )}
    </Show>
  );
}

/** One harness setting: a switch, a menu, or text. A secret shows masked and is sent only when retyped. */
function ExtraFieldRow(props: { field: HarnessField; value: ExtraValue | undefined; saved: unknown; changed: Changed; onChange: (value: ExtraValue) => void }) {
  const id = `ag-extra-${props.field.key}`;
  const help = () => (props.field.hint ? props.field.hint : undefined);
  return (
    <Switch>
      <Match when={props.field.type === "toggle"}>
        <SwitchRow label={props.field.label} info={help()} changed={props.changed} checked={props.value === true} onChange={props.onChange} />
      </Match>
      <Match when={props.field.type === "select"}>
        <SettingsRow label={props.field.label} info={help()} changed={props.changed}>
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" aria-label={`${props.field.label}: ${props.field.options?.find((option) => option.value === props.value)?.label ?? String(props.value ?? "")}`}>
              {props.field.options?.find((option) => option.value === props.value)?.label ?? (String(props.value ?? "") || "Not set")}
            </Menu.Trigger>
            <Menu.Content label={props.field.label} width={260}>
              <For each={props.field.options ?? []}>
                {(option) => (
                  <Menu.Item hint={option.value === props.value ? <Check size={14} /> : undefined} onSelect={() => props.onChange(option.value)}>
                    {option.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </SettingsRow>
      </Match>
      <Match when={props.field.type === "textarea"}>
        <SettingsRow label={props.field.label} info={help()} for={id} changed={props.changed}>
          <TextArea id={id} class="mono" rows={4} spellcheck={false} value={String(props.value ?? "")} onInput={(event) => props.onChange(event.currentTarget.value)} />
        </SettingsRow>
      </Match>
      <Match when={true}>
        <SettingsRow label={props.field.label} info={help()} for={id} changed={props.changed}>
          <TextInput
            id={id}
            class={props.field.type === "number" ? "ag-num" : "mono"}
            type={isSecretField(props.field) ? "password" : "text"}
            inputmode={props.field.type === "number" ? "decimal" : undefined}
            spellcheck={false}
            autocomplete={isSecretField(props.field) ? "new-password" : "off"}
            placeholder={isSecretField(props.field) && props.saved ? "Saved. Type a new value to replace it" : props.field.default !== undefined && props.field.default !== "" ? String(props.field.default) : undefined}
            value={String(props.value ?? "")}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </SettingsRow>
      </Match>
    </Switch>
  );
}

/**
 * Test environment: checks the saved setup can start (harness found, signed in, model available).
 * For a Runner agent on a sandbox it first qualifies the saved computer again
 * (`requalifyEnvironment`), and stops there when that fails or the settings change meanwhile.
 */
function TestEnvironment(props: { agent: AgentDetail; environmentId: string | null; qualifyEnvironmentId: string | null; dirty: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<AdapterEnvironmentTestResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [phase, setPhase] = createSignal<"qualifying" | "testing">("testing");
  const test = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const qualify = props.qualifyEnvironmentId;
      if (qualify) {
        setPhase("qualifying");
        const updatedAt = props.agent.updatedAt;
        const probe = await agentsApi.qualifyRunner(props.agent.id, qualify, company().id);
        if (props.dirty || props.agent.updatedAt !== updatedAt) throw new Error("The settings changed during the test. Test again.");
        const why = requalifyProblem(probe);
        void client.invalidateQueries({ queryKey: queryKeys.agents.adapters(company().id, qualify) });
        if (why) throw new Error(why);
      }
      setPhase("testing");
      setResult(
        await agentsApi.testEnvironment(company().id, props.agent.adapterType, {
          adapterConfig: props.agent.adapterConfig as Record<string, unknown>,
          agentId: props.agent.id,
          environmentId: props.environmentId,
          ...(props.agent.runtimeConfig?.aiConnection ? { aiConnection: props.agent.runtimeConfig.aiConnection } : {}),
        }),
      );
    } catch (caught) {
      setError(testFailureText(caught, (error) => failure(error, "The test couldn't run.")));
    } finally {
      setBusy(false);
    }
  };
  const tone = () => (result()?.status === "pass" ? "green" : result()?.status === "warn" ? "amber" : "red");
  return (
    <div class="ps-stack ag-test">
      <div class="ps-inline">
        <Button size="compact" disabled={busy()} icon={<Check size={14} aria-hidden="true" />} onClick={() => void test()}>
          {busy() ? (phase() === "qualifying" ? "Checking the computer…" : "Testing…") : "Test environment"}
        </Button>
        <InfoTip label="About Test environment">
          {props.qualifyEnvironmentId
            ? "Checks the saved computer still qualifies for the Runner, then tests the saved settings."
            : "Tests the saved settings: harness found, signed in, model available."}
        </InfoTip>
        <Show
          when={result()}
          fallback={
            <Show when={error()}>
              <span class="ps-muted-line" role="alert">
                {error()}
              </span>
            </Show>
          }
        >
          {(found) => (
            <TonePill tone={tone()} compact>
              {found().status === "pass" ? "Passed" : found().status === "warn" ? "Passed with warnings" : "Failed"} · {shortDate(found().testedAt)}
            </TonePill>
          )}
        </Show>
      </div>
      <TestChecks result={result()} />
    </div>
  );
}

function NumberRow(props: { label: string; info: string; help?: string; unit: string; changed?: Changed; value: string; onInput: (value: string) => void }) {
  const id = `ag-num-${props.label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <SettingsRow label={props.label} info={props.info} help={props.help} for={id} changed={props.changed}>
      <div class="ps-inline">
        <TextInput id={id} class="ag-num" inputmode="decimal" autocomplete="off" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
        <span class="ps-muted-line">{props.unit}</span>
      </div>
    </SettingsRow>
  );
}

