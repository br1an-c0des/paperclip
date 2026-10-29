import type { AdapterEnvironmentTestResult, AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeftRight, Check, ChevronRight, History, Wand2, Zap } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { accessApi } from "@/api/access";
import { adaptersApi, agentsApi } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { environmentsApi } from "@/api/environments";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { connectionChoices, providerForHarness } from "@/org/bulk-model";
import { FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  bindingText,
  buildRuntimePatch,
  harnessLabel,
  harnessType,
  HEARTBEAT_INTERVALS,
  intervalLabel,
  latestRevision,
  modelLabel,
  probeQualified,
  runnerLabel,
  runnerOffer,
  runtimeChanges,
  runtimeDraft,
  runtimeEffortOptions,
  runtimeFields,
  runtimeIdentity,
  runtimeProblem,
  type RuntimeDraft,
} from "../agent-model";
import { failure, FootError, refreshAgent, SectionTitle, shortDate, SwitchRow } from "../shared";
import { extrasChanges, extrasConfig, extrasDraft, fieldVisible, harnessFields, isSecretField, type ExtrasDraft, type ExtraValue, type HarnessField } from "../harness-model";
import { EnvironmentMenu, HarnessDisc, instanceDefaultEnvironment, ModelMenu, TestChecks } from "./fields";
import { HarnessChangeDialog } from "./HarnessChange";
import { RunnerStateCard } from "./RunnerStateCard";

/*
 * Model and runtime (board 26): harness and model, where it runs, when it wakes, run limits,
 * debugging and Advanced, saved together as one configuration revision from the bar at the end.
 *
 * The runner is named everywhere the harness is ("Claude Code · Paperclip Runner"), since the
 * old UI showed "Claude Code" even after upgrading and kept the Runner under Advanced. Whether the
 * Runner can carry the harness comes from the adapters list for the agent's environment
 * (`supportedRunners`, `defaultRunner`); switching is part of the same save (`runner` in the
 * patch), after qualifying a sandbox environment when it needs that.
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
  const identity = createMemo(() => runtimeIdentity(props.agent));
  const fields = createMemo(() => runtimeFields(props.agent));
  const base = createMemo(() => runtimeDraft(props.agent));
  const [draft, setDraft] = createStore<RuntimeDraft>(runtimeDraft(props.agent));
  // Harness settings: the schema's and hand-written fields, edited as text or switches.
  const schema = createQuery(() => ({
    queryKey: queryKeys.agents.configSchema(props.agent.adapterType),
    queryFn: ({ signal }) => adaptersApi.configSchema(props.agent.adapterType, signal),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const extraFields = createMemo(() => harnessFields(props.agent.adapterType, schema.data));
  const extrasBase = createMemo(() => extrasDraft(extraFields(), props.agent.adapterConfig as Record<string, unknown>));
  const [extras, setExtras] = createStore<ExtrasDraft>(extrasBase());
  const extraChanges = createMemo(() => extrasChanges(extrasBase(), extras));
  const changes = createMemo(() => [...runtimeChanges(base(), draft), ...extraChanges()]);
  createEffect(on(() => JSON.stringify(extrasBase()), () => extraChanges().length === 0 && setExtras(reconcile(extrasBase())), { defer: true }));
  const [changingHarness, setChangingHarness] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  // The saved settings replace the draft when they change, unless you're editing.
  createEffect(on(() => JSON.stringify(base()), () => changes().length === 0 && setDraft(reconcile(base())), { defer: true }));

  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
  }));
  const environment = createMemo(() =>
    draft.environmentId ? environments.data?.find((entry) => entry.id === draft.environmentId) : instanceDefaultEnvironment(environments.data),
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
    const found = runtimeProblem(draft);
    if (found) return setProblem(found);
    const extra = extrasConfig(extraFields(), extrasBase(), { ...extras }, props.agent.adapterConfig as Record<string, unknown>);
    if ("problem" in extra) return setProblem(extra.problem);
    const patch = buildRuntimePatch(props.agent, { ...draft }, base(), extra.entries);
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
        if (after.find((adapter) => adapter.type === identity().harness)?.defaultRunner !== "paperclip") {
          throw new Error(`This environment doesn't support Paperclip Runner. ${props.agent.name} still uses the legacy runner.`);
        }
      }
      const saved = await agentsApi.update(props.agent.id, patch, company().id);
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

  return (
    <>
      <SectionTitle title="Model and runtime">
        How {props.agent.name} runs: its harness and model, where it runs, when it wakes, and its limits. Changes are saved together, as a new revision.
      </SectionTitle>

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
        footer={<TestEnvironment agent={props.agent} environmentId={draft.environmentId || null} />}
      >
        <SettingsRow label="Harness" help="The program the agent runs in.">
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
        <SettingsRow label="Runner" help="What starts and supervises the harness for each run.">
          <Show when={identity().runnerApplies} fallback={<span class="ag-static-text">Not applicable: {identity().harnessLabel} runs only on the legacy runner.</span>}>
            <div class="ps-stack">
              <div class="ps-inline">
                <TonePill tone={identity().runner === "paperclip" ? "run" : "violet"} compact>
                  {runnerLabel(identity().runner)}
                </TonePill>
                <Show when={stagedRunner() && stagedRunner() !== identity().runner}>
                  <span class="ag-changed">→ {runnerLabel(stagedRunner()!)} when you save</span>
                </Show>
                <Show when={offer().kind === "legacy-available" && !stagedRunner()}>
                  <button type="button" class="ps-link" onClick={() => setDraft("runner", "legacy")}>
                    Switch to the legacy runner
                  </button>
                </Show>
                <Show when={stagedRunner() === "legacy"}>
                  <button type="button" class="ps-link" onClick={() => setDraft("runner", null)}>
                    Undo
                  </button>
                </Show>
              </div>
              <span class="fhelp">
                {identity().runner === "paperclip"
                  ? runnerDetail(config())
                  : offer().kind === "none" && offer().reason === "not-supported-here"
                    ? "Paperclip Runner isn't available for this harness in this environment."
                    : `Runs the ${identity().harnessLabel} program directly.`}
              </span>
            </div>
          </Show>
        </SettingsRow>
        <SignInRow agent={props.agent} value={draft.connection} saved={base().connection} onChange={(value) => setDraft("connection", value)} />
        <Show when={fields().model}>
          <SettingsRow label="Model">
            <ModelMenu models={models.data} loading={models.isLoading} value={draft.model} onChange={(model) => setDraft("model", model)} />
            <Show when={draft.model !== base().model}>
              <span class="ag-changed">Changed from {modelLabel(base().model, models.data) ?? "the default"}</span>
            </Show>
            <DetectedModel agent={props.agent} harness={identity().harness} value={draft.model} onUse={(model) => setDraft("model", model)} />
          </SettingsRow>
        </Show>
        <Show when={fields().effort && effortOptions().length > 0}>
          <SettingsRow label="Thinking effort" help="More effort is slower and costs more.">
            <div class="ps-stack">
              <Segmented
                label="Thinking effort"
                options={[{ value: "", label: "Auto" }, ...effortOptions()]}
                value={draft.effort}
                onChange={(value) => setDraft("effort", value)}
              />
              <Show when={draft.effort !== base().effort}>
                <span class="ag-changed">Changed from {effortOptions().find((option) => option.value === base().effort)?.label ?? "Auto"}</span>
              </Show>
            </div>
          </SettingsRow>
        </Show>
      </SettingsCard>

      <Show when={extraFields().length > 0}>
        <SettingsCard title="Harness settings" description={`Options of ${identity().harnessLabel} itself. Saved with your other changes.`}>
          <For each={extraFields().filter((field) => fieldVisible(field, extras, props.agent.adapterConfig as Record<string, unknown>))}>
            {(field) => <ExtraFieldRow field={field} value={extras[field.key]} saved={(props.agent.adapterConfig as Record<string, unknown>)[field.key]} onChange={(value) => setExtras(field.key, value)} />}
          </For>
        </SettingsCard>
      </Show>

      <SettingsCard title="Where it runs">
        <SettingsRow label="Environment" help="Uses the organization default unless you pick another.">
          <EnvironmentMenu environments={environments.data} value={draft.environmentId} onChange={(id) => setDraft("environmentId", id)} />
        </SettingsRow>
        <Show when={fields().browser}>
          <SwitchRow label="Browser access" help="Lets the agent open and read web pages in a real browser (Chrome)." checked={draft.chrome} onChange={(value) => setDraft("chrome", value)} />
        </Show>
      </SettingsCard>

      <SettingsCard title="When it wakes">
        <SwitchRow label="When there is work" help="It is assigned a task, mentioned, or sent a message." checked={draft.wakeOnDemand} onChange={(value) => setDraft("wakeOnDemand", value)} />
        <SwitchRow label="On a heartbeat" help="Checks in on a schedule, even when nothing is new." checked={draft.heartbeatEnabled} onChange={(value) => setDraft("heartbeatEnabled", value)}>
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
        <NumberRow label="Cooldown" help="The shortest gap between two runs." unit="seconds" value={draft.cooldownSec} onInput={(value) => setDraft("cooldownSec", value)} />
        <NumberRow label="Runs at once" help="How many runs may overlap." unit={draft.maxConcurrentRuns === "1" ? "run" : "runs"} value={draft.maxConcurrentRuns} onInput={(value) => setDraft("maxConcurrentRuns", value)} />
      </SettingsCard>

      <Show when={fields().timeouts}>
        <SettingsCard title="Run limits">
          <NumberRow label="Timeout" help="A run is stopped after this long. 0 means no limit." unit="minutes" value={draft.timeoutMin} onInput={(value) => setDraft("timeoutMin", value)} />
          <NumberRow label="Grace period" help="Time a run gets to wrap up after it is stopped." unit="seconds" value={draft.graceSec} onInput={(value) => setDraft("graceSec", value)} />
          <SwitchRow
            label="Continue after a turn limit"
            help="When the harness stops at its turn limit, start a follow-up run that picks up where it left off."
            checked={draft.continueEnabled}
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
            help="Records the full model input and output of every run and keeps it for 24 hours. Only instance admins can read traces. Turn it on while you investigate a problem."
            checked={draft.providerTrace}
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
          </summary>
          <div class="settings-rows">
            <Show when={fields().command}>
              <SettingsRow label="Command" help="Leave empty to use the harness default." for="ag-command">
                <TextInput id="ag-command" class="mono" spellcheck={false} autocomplete="off" placeholder={identity().harness.replace(/_local$/, "")} value={draft.command} onInput={(event) => setDraft("command", event.currentTarget.value)} />
              </SettingsRow>
              <SettingsRow label={props.agent.adapterType === "process" ? "Arguments" : "Extra arguments"} help="Separated by commas." for="ag-args">
                <TextInput id="ag-args" class="mono" spellcheck={false} autocomplete="off" placeholder="--verbose" value={draft.extraArgs} onInput={(event) => setDraft("extraArgs", event.currentTarget.value)} />
              </SettingsRow>
            </Show>
            <Show when={fields().promptTemplate}>
              <SettingsRow label="Prompt template" help="Sent at the start of every run." for="ag-prompt">
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
                setDraft(reconcile(base()));
                setExtras(reconcile(extrasBase()));
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
  const binding = () => (props.value ? (JSON.parse(props.value) as Record<string, unknown>) : undefined);
  const connections = createQuery(() => ({
    queryKey: [...queryKeys.aiConnections.list(company().id), "agent", props.agent.id],
    queryFn: () => aiConnectionsApi.list(company().id, props.agent.id),
    enabled: Boolean(binding()) || Boolean(provider()),
    retry: false,
  }));
  const choices = createMemo(() => (provider() ? connectionChoices(connections.data, provider()!) : []));
  const connection = createMemo(() => {
    const current = binding();
    if (!current) return undefined;
    return connections.data?.connections.find((entry) => entry.id === current.connectionId || entry.grantId === current.grantId);
  });
  const mode = () => String(binding()?.mode ?? "");
  const router = () => mode() === "router";
  const label = () =>
    !binding()
      ? "Its own sign-in"
      : connection()
        ? `${connection()!.method === "subscription" ? "Subscription" : "API key"} · ${connection()!.name}`
        : mode() === "responsible_user"
          ? "The responsible person's connection"
          : "An AI connection";
  return (
    <SettingsRow label="Sign-in" help="How the harness reaches the model.">
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
          <A class="ps-link" href={`/${company().issuePrefix}/apps/ai`}>
            Manage connections
          </A>
        </div>
        <Show when={props.value !== props.saved}>
          <span class="ag-changed">Changes when you save</span>
        </Show>
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
function ExtraFieldRow(props: { field: HarnessField; value: ExtraValue | undefined; saved: unknown; onChange: (value: ExtraValue) => void }) {
  const id = `ag-extra-${props.field.key}`;
  const help = () => (props.field.hint ? props.field.hint : undefined);
  return (
    <Switch>
      <Match when={props.field.type === "toggle"}>
        <SwitchRow label={props.field.label} help={help() ?? ""} checked={props.value === true} onChange={props.onChange} />
      </Match>
      <Match when={props.field.type === "select"}>
        <SettingsRow label={props.field.label} help={help()}>
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
        <SettingsRow label={props.field.label} help={help()} for={id}>
          <TextArea id={id} class="mono" rows={4} spellcheck={false} value={String(props.value ?? "")} onInput={(event) => props.onChange(event.currentTarget.value)} />
        </SettingsRow>
      </Match>
      <Match when={true}>
        <SettingsRow label={props.field.label} help={help()} for={id}>
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

/** Test environment: checks the saved setup can start (harness found, signed in, model available). */
function TestEnvironment(props: { agent: AgentDetail; environmentId: string | null }) {
  const company = useCompany();
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<AdapterEnvironmentTestResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await agentsApi.testEnvironment(company().id, props.agent.adapterType, {
          adapterConfig: props.agent.adapterConfig as Record<string, unknown>,
          agentId: props.agent.id,
          environmentId: props.environmentId,
          ...(props.agent.runtimeConfig?.aiConnection ? { aiConnection: props.agent.runtimeConfig.aiConnection } : {}),
        }),
      );
    } catch (caught) {
      setError(failure(caught, "The test couldn't run."));
    } finally {
      setBusy(false);
    }
  };
  const tone = () => (result()?.status === "pass" ? "green" : result()?.status === "warn" ? "amber" : "red");
  return (
    <div class="ps-stack ag-test">
      <div class="ps-inline">
        <Button size="compact" disabled={busy()} icon={<Check size={14} aria-hidden="true" />} onClick={() => void test()}>
          {busy() ? "Testing…" : "Test environment"}
        </Button>
        <Show when={result()} fallback={<span class="ps-muted-line">{error() ?? "Tests the saved settings: harness found, signed in, model available."}</span>}>
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

function NumberRow(props: { label: string; help: string; unit: string; value: string; onInput: (value: string) => void }) {
  const id = `ag-num-${props.label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <SettingsRow label={props.label} help={props.help} for={id}>
      <div class="ps-inline">
        <TextInput id={id} class="ag-num" inputmode="decimal" autocomplete="off" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
        <span class="ps-muted-line">{props.unit}</span>
      </div>
    </SettingsRow>
  );
}

