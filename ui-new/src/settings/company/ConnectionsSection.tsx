import type { AiManagedConnectionSummary, DecisionResult, FastResponseTestResult, PromptInjectionTestResult } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Match, on, Show, Switch as Branch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { paperclipModelsApi } from "@/api/ai-connections";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { AddConnectionDialog, ConnectionBox, ConnectionMenu, ModelField } from "./ConnectionPicker";
import {
  chosen,
  decisionDirty,
  decisionDraft,
  decisionTestSummary,
  DEFAULT_INJECTION_MODEL,
  fastDirty,
  fastDraft,
  fastModelFor,
  fastProblem,
  injectionDirty,
  injectionDraft,
  injectionProblem,
} from "./connections-model";
import { CardHead, CardNoteLine, failure, FootError, SectionTitle, SwitchRow } from "./shared";
import { TelemetryCard } from "./TelemetryCard";

/*
 * Connections (board 23): the models Paperclip itself uses on top of your agents, and where run
 * telemetry goes. Each card is a draft with Save and Discard, as in the old UI, because these
 * settings change what every agent gets; a test runs on the saved settings and is charged to the
 * connection.
 *
 * Fast responses follow the instance's `enableFastResponses` setting (decision 12): with it off,
 * the card says so instead of offering a switch the server ignores.
 */

export function ConnectionsSection() {
  const company = useCompany();
  return (
    <>
      <SectionTitle title="Connections">
        The models Paperclip itself uses on top of your agents, and where run telemetry goes. Calls are charged to the connection you pick.
      </SectionTitle>
      <DecisionCard />
      <FastResponseCard />
      <InjectionCard />
      <TelemetryCard />
      <p class="cs-muted cs-after">
        Agents' own model connections live in{" "}
        <A class="ps-link" href={`/${company().issuePrefix}/apps/ai`}>
          Connections for agents
        </A>
        .
      </p>
    </>
  );
}

function SaveFoot(props: { dirty: boolean; busy: boolean; problem: string | null; onDiscard: () => void; onSave: () => void; saveLabel?: string; test?: () => unknown; testLabel?: string; testDisabled?: boolean }) {
  return (
    <footer class="cfoot">
      <Show when={props.test}>
        <Button size="compact" disabled={props.busy || props.dirty || props.testDisabled} onClick={() => props.test?.()}>
          {props.testLabel ?? "Test"}
        </Button>
        <Show when={props.dirty}>
          <span class="cs-muted">Save before testing.</span>
        </Show>
      </Show>
      <span class="ps-foot-end">
        <FootError message={props.problem} />
        <Show when={props.dirty}>
          <Button size="compact" variant="quiet" disabled={props.busy} onClick={props.onDiscard}>
            Discard
          </Button>
          <Button size="compact" variant="primary" disabled={props.busy} onClick={props.onSave}>
            {props.busy ? "Saving…" : (props.saveLabel ?? "Save")}
          </Button>
        </Show>
      </span>
    </footer>
  );
}

function DecisionCard() {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.companySettings.decisionModel(company().id);
  const query = createQuery(() => ({ queryKey: key(), queryFn: ({ signal }) => paperclipModelsApi.decisionModel(company().id, signal) }));
  const settings = () => query.data?.settings ?? null;
  const [draft, setDraft] = createStore(decisionDraft({ companyId: "", enabled: false, allowBackground: true, connectionId: null, grantId: null, provider: null, model: null }));
  createEffect(on(() => JSON.stringify(settings()), () => settings() && setDraft(reconcile(decisionDraft(settings()!)))));
  const dirty = () => (settings() ? decisionDirty(settings()!, draft) : false);
  const selected = () => chosen(query.data?.choices ?? [], draft.grantId);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<DecisionResult | null>(null);
  const [adding, setAdding] = createSignal(false);

  const pick = (connection: AiManagedConnectionSummary) =>
    setDraft({ connectionId: connection.id, grantId: connection.grantId, enabled: draft.connectionId ? draft.enabled : true });

  const save = async () => {
    if (draft.enabled && selected()?.status !== "connected") return setProblem("Choose a working connection before turning decisions on.");
    setBusy(true);
    setProblem(null);
    try {
      const saved = await paperclipModelsApi.updateDecisionModel(company().id, { ...draft });
      client.setQueryData(key(), { ...query.data!, settings: saved });
      setResult(null);
      pushToast({ tone: "success", title: "Saved the decision model" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the decision model."));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      setResult(await paperclipModelsApi.testDecisionModel(company().id));
    } catch (caught) {
      setProblem(failure(caught, "The test couldn't run."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Show when={!query.isError} fallback={<CardNoteLine alert>Couldn't load the decision model. {failure(query.error, "")}</CardNoteLine>}>
      <Show when={query.data?.canManage !== false}>
        <section class="card settings-card" aria-labelledby="cs-decision">
          <CardHead
            id="cs-decision"
            title="Decision model"
            note="The shared connection Paperclip uses for its optional decision features."
            actions={
              <A class="btn btn--secondary btn--compact" href={`/${company().issuePrefix}/activity/costs?tab=decisions`}>
                View usage
              </A>
            }
          />
          <Show when={settings()} fallback={<CardNoteLine>{query.isLoading ? "Loading…" : "Not available."}</CardNoteLine>}>
            <SettingsRow label="Connection">
              <ConnectionBox connection={selected()} model={selected() ? (query.data!.choices.find((c) => c.grantId === draft.grantId)?.decisionModel ?? null) : null} missing={!!draft.grantId && !selected()}>
                <ConnectionMenu
                  choices={query.data!.choices}
                  grantId={draft.grantId}
                  onPick={pick}
                  onClear={() => setDraft({ connectionId: null, grantId: null, enabled: false })}
                  onAdd={() => setAdding(true)}
                />
              </ConnectionBox>
              <Show when={query.data!.choices.length === 0}>
                <span class="fhelp">Add a shared OpenAI or OpenRouter API connection to get started.</span>
              </Show>
            </SettingsRow>
            <Show when={draft.connectionId}>
              <SwitchRow label="Use decisions" help="Paperclip's optional decision features run on this connection." checked={draft.enabled} onChange={(value) => setDraft("enabled", value)} />
              <SwitchRow
                label="Allow background decisions"
                help="Background features can charge this connection without a responsible person. They show as Paperclip services in Costs."
                checked={draft.allowBackground}
                onChange={(value) => setDraft("allowBackground", value)}
              />
            </Show>
            <Show when={result()}>
              {(found) => (
                <SettingsRow label="Last test">
                  <span class={decisionTestSummary(found()).ok ? "cs-ok" : "cs-bad"} role={decisionTestSummary(found()).ok ? "status" : "alert"}>
                    {decisionTestSummary(found()).text}
                  </span>
                </SettingsRow>
              )}
            </Show>
          </Show>
          <SaveFoot
            dirty={dirty()}
            busy={busy() || testing()}
            problem={problem()}
            onDiscard={() => settings() && setDraft(reconcile(decisionDraft(settings()!)))}
            onSave={() => void save()}
            test={() => void test()}
            testLabel={testing() ? "Testing…" : "Run a test"}
            testDisabled={!settings()?.enabled || selected()?.status !== "connected"}
          />
          <AddConnectionDialog
            open={adding()}
            onOpenChange={setAdding}
            providers={["openai", "openrouter"]}
            purpose="for decisions"
            onAdded={async (connectionId) => {
              const refreshed = await query.refetch();
              const found = refreshed.data?.choices.find((choice) => choice.id === connectionId);
              if (found) pick(found);
            }}
          />
        </section>
      </Show>
    </Show>
  );
}

function FastResponseCard() {
  const company = useCompany();
  const client = useQueryClient();
  const experimental = useExperimentalSettingsQuery();
  const on_ = () => experimental.data?.enableFastResponses === true;
  const key = () => queryKeys.companySettings.fastResponse(company().id);
  const query = createQuery(() => ({ queryKey: key(), queryFn: ({ signal }) => paperclipModelsApi.fastResponse(company().id, signal), enabled: on_() }));
  const settings = () => query.data?.settings ?? null;
  const [draft, setDraft] = createStore(fastDraft({ companyId: "", enabled: false, connectionId: null, grantId: null, provider: null, model: null, allowSponsored: true }));
  createEffect(on(() => JSON.stringify(settings()), () => settings() && setDraft(reconcile(fastDraft(settings()!)))));
  const dirty = () => (settings() ? fastDirty(settings()!, draft) : false);
  const selected = () => chosen(query.data?.choices ?? [], draft.grantId);
  const models = createQuery(() => ({
    queryKey: queryKeys.companySettings.fastResponseModels(company().id, draft.connectionId ?? ""),
    queryFn: ({ signal }) => paperclipModelsApi.fastResponseModels(company().id, draft.connectionId!, signal),
    enabled: on_() && !!draft.connectionId,
    retry: false,
  }));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<FastResponseTestResult | null>(null);
  const [adding, setAdding] = createSignal(false);

  const pick = (connection: AiManagedConnectionSummary) =>
    setDraft({ connectionId: connection.id, grantId: connection.grantId, model: fastModelFor(connection), enabled: draft.connectionId ? draft.enabled : true });

  const save = async () => {
    const found = fastProblem(draft, selected());
    if (found) return setProblem(found);
    setBusy(true);
    setProblem(null);
    try {
      const saved = await paperclipModelsApi.updateFastResponse(company().id, { ...draft, model: draft.model?.trim() || null });
      client.setQueryData(key(), { ...query.data!, settings: saved });
      setResult(null);
      pushToast({ tone: "success", title: "Saved fast responses" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save fast responses."));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      setResult(await paperclipModelsApi.testFastResponse(company().id));
    } catch (caught) {
      setProblem(failure(caught, "The test couldn't run."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Branch>
      <Match when={experimental.data && !on_()}>
        <SettingsCard title="Fast responses">
          <div class="frow cs-frow-wide">
            <div class="flabel">
              Acknowledge messages right away
              <span class="fhelp">Fast responses are turned off for this instance. An instance admin can turn them on in app settings.</span>
            </div>
          </div>
        </SettingsCard>
      </Match>
      <Match when={on_() && query.isError}>
        <CardNoteLine alert>Couldn't load fast responses. {failure(query.error, "")}</CardNoteLine>
      </Match>
      <Match when={on_() && settings() && query.data?.canManage !== false}>
        <section class="card settings-card" aria-labelledby="cs-fast">
          <CardHead
            id="cs-fast"
            title="Fast responses"
            actions={
              <A class="btn btn--secondary btn--compact" href={`/${company().issuePrefix}/activity/costs?tab=fast-responses`}>
                View usage
              </A>
            }
          />
          <SwitchRow
            label="Acknowledge messages right away"
            help="When someone messages an agent, a small model replies at once, marked as automatic. The agent's full reply follows."
            checked={draft.enabled}
            onChange={(value) => setDraft("enabled", value)}
          />
          <SettingsRow label="Connection">
            <ConnectionBox connection={selected()} missing={!!draft.grantId && !selected()}>
              <ConnectionMenu choices={query.data!.choices} grantId={draft.grantId} onPick={pick} onClear={() => setDraft({ connectionId: null, grantId: null, enabled: false })} onAdd={() => setAdding(true)} />
            </ConnectionBox>
          </SettingsRow>
          <Show when={draft.connectionId}>
            <SettingsRow label="Model" for="cs-fast-model">
              <ModelField id="cs-fast-model" value={draft.model ?? ""} placeholder="Choose or enter a model ID" suggestions={models.data} onInput={(value) => setDraft("model", value || null)} />
            </SettingsRow>
            <SwitchRow
              label="Answer people without an account"
              help="Covers accepted outside messages from people with no linked Paperclip account, charged to the organization."
              checked={draft.allowSponsored}
              onChange={(value) => setDraft("allowSponsored", value)}
            />
          </Show>
          <Show when={result()}>
            {(found) => (
              <SettingsRow label="Last test">
                <Show
                  when={found().status === "succeeded" ? (found() as Extract<FastResponseTestResult, { status: "succeeded" }>) : null}
                  fallback={
                    <span class="cs-bad" role="alert">
                      {(found() as { reason?: string }).reason === "timeout" ? "The model didn't answer within three seconds. Try a faster model." : "Couldn't generate a reply. Check the connection and model."}
                    </span>
                  }
                >
                  {(ok) => (
                    <span class="cs-ok" role="status">
                      “{ok().text}” · {(ok().durationMs / 1000).toFixed(2)} s
                    </span>
                  )}
                </Show>
              </SettingsRow>
            )}
          </Show>
          <SaveFoot
            dirty={dirty()}
            busy={busy() || testing()}
            problem={problem()}
            onDiscard={() => settings() && setDraft(reconcile(fastDraft(settings()!)))}
            onSave={() => void save()}
            test={() => void test()}
            testLabel={testing() ? "Testing…" : "Send a test reply"}
            testDisabled={!settings()?.enabled}
          />
          <AddConnectionDialog
            open={adding()}
            onOpenChange={setAdding}
            providers={["openrouter", "openai"]}
            purpose="for fast responses"
            onAdded={async (connectionId) => {
              const refreshed = await query.refetch();
              const found = refreshed.data?.choices.find((choice) => choice.id === connectionId);
              if (found) pick(found);
            }}
          />
        </section>
      </Match>
    </Branch>
  );
}

function InjectionCard() {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.companySettings.promptInjection(company().id);
  const query = createQuery(() => ({ queryKey: key(), queryFn: ({ signal }) => paperclipModelsApi.promptInjection(company().id, signal) }));
  const settings = () => query.data?.settings ?? null;
  const [draft, setDraft] = createStore(injectionDraft({ companyId: "", enabled: false, connectionId: null, grantId: null, model: DEFAULT_INJECTION_MODEL }));
  createEffect(on(() => JSON.stringify(settings()), () => settings() && setDraft(reconcile(injectionDraft(settings()!)))));
  const dirty = () => (settings() ? injectionDirty(settings()!, draft) : false);
  const selected = () => chosen(query.data?.choices ?? [], draft.grantId);
  const models = createQuery(() => ({
    queryKey: queryKeys.companySettings.promptInjectionModels(company().id, draft.connectionId ?? ""),
    queryFn: ({ signal }) => paperclipModelsApi.promptInjectionModels(company().id, draft.connectionId!, signal),
    enabled: !!draft.connectionId,
    retry: false,
  }));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<PromptInjectionTestResult | null>(null);
  const [adding, setAdding] = createSignal(false);

  const pick = (connection: AiManagedConnectionSummary) =>
    setDraft({ connectionId: connection.id, grantId: connection.grantId, model: draft.model || DEFAULT_INJECTION_MODEL, enabled: true });

  const save = async () => {
    const found = injectionProblem(draft, selected());
    if (found) return setProblem(found);
    setBusy(true);
    setProblem(null);
    try {
      const saved = await paperclipModelsApi.updatePromptInjection(company().id, { ...draft, model: draft.model.trim() });
      client.setQueryData(key(), { ...query.data!, settings: saved });
      setResult(null);
      pushToast({ tone: "success", title: "Saved the prompt injection check" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the prompt injection check."));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      setResult(await paperclipModelsApi.testPromptInjection(company().id));
    } catch (caught) {
      setProblem(failure(caught, "The check couldn't run."));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Show when={!query.isError} fallback={<CardNoteLine alert>Couldn't load the prompt injection check. {failure(query.error, "")}</CardNoteLine>}>
      <Show when={settings() && query.data?.canManage !== false}>
        <section class="card settings-card" aria-labelledby="cs-inject">
          <CardHead id="cs-inject" title="Prompt injection check" />
          <SwitchRow
            label="Check tool results with a model"
            help="Looks for instructions planted in web pages, files and app responses, and holds suspicious results back. The provider receives tool content."
            checked={draft.enabled}
            onChange={(value) => setDraft("enabled", value)}
          />
          <SettingsRow label="Connection" help="A shared OpenRouter connection.">
            <ConnectionBox connection={selected()} missing={!!draft.grantId && !selected()}>
              <ConnectionMenu
                choices={query.data!.choices}
                grantId={draft.grantId}
                onPick={pick}
                onClear={() => setDraft({ connectionId: null, grantId: null, enabled: false })}
                onAdd={() => setAdding(true)}
              />
            </ConnectionBox>
          </SettingsRow>
          <SettingsRow label="Model" for="cs-inject-model">
            <ModelField id="cs-inject-model" value={draft.model} placeholder={DEFAULT_INJECTION_MODEL} suggestions={models.data} onInput={(value) => setDraft("model", value)} />
          </SettingsRow>
          <SettingsRow label="If the model is down">
            <span class="cs-static">Fall back to pattern matching</span>
            <span class="fhelp">Built-in pattern matching always runs when the model check can't.</span>
          </SettingsRow>
          <Show when={result()}>
            {(found) => (
              <SettingsRow label="Last check">
                <div class={found().passed ? "cs-ok" : "cs-bad"} role={found().passed ? "status" : "alert"}>
                  {found().passed ? "Both sample checks passed." : "The sample checks didn't pass. Check the connection and model."}
                  {found().samples.map((sample) => (
                    <span class="fhelp">
                      {sample.name}: {sample.passed ? "passed" : sample.reason ? `model unavailable (${sample.reason}), pattern matching used` : "wrong verdict"} · {(sample.durationMs / 1000).toFixed(2)} s
                    </span>
                  ))}
                </div>
              </SettingsRow>
            )}
          </Show>
          <SaveFoot
            dirty={dirty()}
            busy={busy() || testing()}
            problem={problem()}
            onDiscard={() => settings() && setDraft(reconcile(injectionDraft(settings()!)))}
            onSave={() => void save()}
            test={() => void test()}
            testLabel={testing() ? "Checking…" : "Run a sample check"}
            testDisabled={!settings()?.enabled}
          />
          <AddConnectionDialog
            open={adding()}
            onOpenChange={setAdding}
            providers={["openrouter"]}
            purpose="for prompt injection checks"
            onAdded={async (connectionId) => {
              const refreshed = await query.refetch();
              const found = refreshed.data?.choices.find((choice) => choice.id === connectionId);
              if (found) pick(found);
            }}
          />
        </section>
      </Show>
    </Show>
  );
}
