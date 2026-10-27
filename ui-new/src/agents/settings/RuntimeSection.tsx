import type { AdapterEnvironmentTestResult, AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ChevronRight, History, Server, Zap } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { accessApi } from "@/api/access";
import { agentsApi } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { environmentsApi } from "@/api/environments";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  buildRuntimePatch,
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
 * Left out for now: changing the harness itself, the AI connection and adapter sign-in flows, model
 * detection, and the per-harness extra fields (Codex search, ACP state directory and the like).
 */

export function RuntimeSection(props: { agent: AgentDetail; base: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const identity = createMemo(() => runtimeIdentity(props.agent));
  const fields = createMemo(() => runtimeFields(props.agent));
  const base = createMemo(() => runtimeDraft(props.agent));
  const [draft, setDraft] = createStore<RuntimeDraft>(runtimeDraft(props.agent));
  const changes = createMemo(() => runtimeChanges(base(), draft));
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  // The saved settings replace the draft when they change, unless you're editing.
  createEffect(on(() => JSON.stringify(base()), () => changes().length === 0 && setDraft(reconcile(base())), { defer: true }));

  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
  }));
  const environment = createMemo(() => {
    const list = environments.data ?? [];
    const id = draft.environmentId;
    return id ? list.find((entry) => entry.id === id) : list.find((entry) => (entry.metadata as Record<string, unknown> | null)?.defaultForInstance === true);
  });
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
    const patch = buildRuntimePatch(props.agent, { ...draft }, base());
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
        <SignInRow agent={props.agent} />
        <Show when={fields().model}>
          <SettingsRow label="Model">
            <Menu>
              <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label={`Model: ${modelLabel(draft.model, models.data) ?? "harness default"}`}>
                {modelLabel(draft.model, models.data) ?? "Harness default"}
              </Menu.Trigger>
              <Menu.Content label="Model" width={320}>
                <Show when={models.isLoading}>
                  <p class="nt-menu-note">Loading models…</p>
                </Show>
                <For each={models.data ?? []} fallback={<Show when={!models.isLoading}><p class="nt-menu-note">This harness lists no models.</p></Show>}>
                  {(model) => (
                    <Menu.Item onSelect={() => setDraft("model", model.id)} hint={draft.model === model.id ? <Check size={14} /> : undefined}>
                      {model.label}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
            <Show when={draft.model !== base().model}>
              <span class="ag-changed">Changed from {modelLabel(base().model, models.data) ?? "the default"}</span>
            </Show>
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

      <SettingsCard title="Where it runs">
        <SettingsRow label="Environment" help="Uses the organization default unless you pick another.">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-360" icon={<Server size={14} aria-hidden="true" />} aria-label="Environment">
              {draft.environmentId ? (environment()?.name ?? "An environment you can't see") : `Organization default${environment() ? ` · ${environment()!.name}` : ""}`}
            </Menu.Trigger>
            <Menu.Content label="Environment" width={340}>
              <Menu.Item onSelect={() => setDraft("environmentId", "")} hint={draft.environmentId ? undefined : <Check size={14} />} description="The instance's default environment">
                Organization default
              </Menu.Item>
              <Menu.Separator />
              <For each={(environments.data ?? []).filter((entry) => entry.status === "active")}>
                {(entry) => (
                  <Menu.Item onSelect={() => setDraft("environmentId", entry.id)} description={entry.description ?? entry.driver} hint={draft.environmentId === entry.id ? <Check size={14} /> : undefined}>
                    {entry.name}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
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

function HarnessDisc(props: { harness: string }) {
  const text = () => (props.harness === "claude_local" ? "CC" : props.harness.replace(/^acpx:/, "").slice(0, 2).toUpperCase());
  return (
    <span class="ag-harness-disc" aria-hidden="true">
      {text()}
    </span>
  );
}

/** The AI connection the harness signs in with, from the agent's binding and the company's connections. */
function SignInRow(props: { agent: AgentDetail }) {
  const company = useCompany();
  const binding = () => props.agent.runtimeConfig?.aiConnection as Record<string, unknown> | undefined;
  const connections = createQuery(() => ({
    queryKey: [...queryKeys.aiConnections.list(company().id), "agent", props.agent.id],
    queryFn: () => aiConnectionsApi.list(company().id, props.agent.id),
    enabled: Boolean(binding()),
    retry: false,
  }));
  const connection = createMemo(() => {
    const current = binding();
    if (!current) return undefined;
    return connections.data?.connections.find((entry) => entry.id === current.connectionId || entry.grantId === current.grantId);
  });
  const mode = () => String(binding()?.mode ?? "");
  return (
    <SettingsRow label="Sign-in" help="How the harness reaches the model.">
      <div class="ps-inline ps-inline--spread">
        <Show
          when={binding()}
          fallback={<span class="ag-static-text">No AI connection: the harness uses its own sign-in on the machine it runs on.</span>}
        >
          <Show
            when={mode() !== "router"}
            fallback={<TonePill tone="violet" compact>Routed through a connection pool</TonePill>}
          >
            <TonePill tone={connection()?.status === "connected" || !connection() ? "green" : "amber"} compact>
              {connection() ? `${connection()!.method === "subscription" ? "Subscription" : "API key"} · ${connection()!.name}` : mode() === "responsible_user" ? "The responsible person's connection" : "An AI connection"}
            </TonePill>
            <Show when={connection() && connection()!.status !== "connected"}>
              <span class="ag-changed">{connection()!.status}</span>
            </Show>
          </Show>
        </Show>
        <A class="ps-link" href={`/${company().issuePrefix}/connectors`}>
          Manage connections
        </A>
      </div>
    </SettingsRow>
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
      <Show when={result()?.checks.length}>
        <ul class="ag-checks">
          <For each={result()!.checks}>
            {(check) => (
              <li data-level={check.level}>
                <b>{check.message}</b>
                <Show when={check.hint ?? check.detail}>
                  <span>{check.hint ?? check.detail}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
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

