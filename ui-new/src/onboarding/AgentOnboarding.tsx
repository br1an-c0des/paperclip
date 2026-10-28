import type { AdapterEnvironmentTestResult, Agent, AgentDetail, AgentRunner } from "@paperclipai/shared";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Check, Plus, RotateCw } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, untrack } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { adapterModelKeyOptions, agentsApi, type AdapterModelOptions } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { approvalsApi } from "@/api/approvals";
import { environmentsApi } from "@/api/environments";
import { goalsApi } from "@/api/goals";
import { healthApi } from "@/api/health";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { modelLabel, runnerLabel } from "@/agents/agent-model";
import {
  defaultBinding,
  draftCreateRequest,
  emptySetup,
  harnessChoices,
  hireRequest,
  isSetupDraft,
  needsRunnerQualification,
  preparing,
  previewLine,
  profileFromAgent,
  profilePatch,
  profileProblem,
  provisionalAdapter,
  qualificationProblem,
  requiresProviderModel,
  resolveRunner,
  runnerSwitch,
  selectedSignIn,
  setupAdapterConfig,
  setupEffortOptions,
  setupFromAgent,
  setupPatch,
  setupProblem,
  setupSignature,
  signInChoices,
  testAllowsHire,
  testBlocks,
  testSetup,
  testSummary,
  type ProfileDraft,
  type SetupDraft,
} from "@/agents/new/new-agent-model";
import { EnvironmentMenu, harnessMark, instanceDefaultEnvironment, ModelMenu, PaletteGrid, paletteAppearance, TestChecks } from "@/agents/settings/fields";
import { failure } from "@/agents/shared";
import { ConnectionSetup } from "@/connectors/ConnectionSetup";
import { localLoginSupported } from "@/connectors/connection-model";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { providerForHarness } from "@/org/bulk-model";
import { Splash } from "@/routes/Splash";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsRow, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { OnboardingFrame } from "./OnboardingFrame";
import { DEFAULT_TASK_TITLE, launchFirstTask, onboardingEntry, onboardingProfile, onboardingTaskHref, type OnboardingStep } from "./onboarding-model";
// Settings rows, menus and palettes are the agent settings' (and the project settings' they share).
import "@/projects/NewProjectDialog.css";
import "@/projects/settings/ProjectSettings.css";
import "@/tasks/NewTaskDialog.css";
import "@/agents/Agent.css";

/*
 * Onboarding inside an organization (`/:prefix/onboarding`): its first agent, then its first task.
 * The agent goes through New agent's flow (src/agents/new/new-agent-model.ts) with onboarding's
 * defaults: "Chief of staff", a general role, and the `onboardingFirstAgent` marker on the draft and
 * the hire so the server seeds its instructions. A hire that needs approval is approved here, as the
 * old wizard does: the person onboarding is the board. The page keeps its place in the address
 * (`?setupAgentId=`, then `?agentId=`), so a reload resumes it.
 */

type AgentStep = Exclude<OnboardingStep, "organization">;

export function AgentOnboarding() {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams<{ setupAgentId?: string; agentId?: string }>();
  const agents = useAgentsQuery();
  const base = () => `/${company().issuePrefix}`;

  // ---- Where to start -----------------------------------------------------------------------
  const [step, setStep] = createSignal<AgentStep | null>(null);
  const [draftId, setDraftId] = createSignal<string | null>(null);
  const [hiredId, setHiredId] = createSignal<string | null>(null);
  const [profile, setProfile] = createStore<ProfileDraft>(onboardingProfile([]));
  const [setup, setSetup] = createStore<SetupDraft>(emptySetup());
  let restored: string | null = null;

  createEffect(() => {
    const list = agents.data;
    if (!list || untrack(step)) return;
    const entry = untrack(() => onboardingEntry({ hasCompany: true, agentId: search.agentId, setupAgentId: search.setupAgentId, agents: list }));
    batch(() => {
      if (entry.step === "task") setHiredId(entry.agentId);
      else if (entry.step !== "organization") {
        setDraftId(entry.draftId);
        if (!entry.draftId) setProfile(reconcile(onboardingProfile(list)));
      }
      setStep(entry.step === "organization" ? "agent" : entry.step);
    });
  });

  // ---- The draft --------------------------------------------------------------------------
  const detail = createQuery(() => ({
    queryKey: queryKeys.agents.detail(draftId() ?? "new"),
    queryFn: ({ signal }) => agentsApi.get(draftId()!, company().id, signal),
    enabled: !!draftId(),
    retry: false,
    refetchInterval: (query: { state: { data?: AgentDetail } }) => (preparing(query.state.data) ? 1000 : false),
  }));
  const draft = createMemo(() => (detail.data?.companyId === company().id && detail.data.id === draftId() ? detail.data : undefined));
  const [savedSignature, setSavedSignature] = createSignal<string | null>(null);

  // A resumed draft fills the profile and the harness choices once; one that was hired goes on to the task.
  createEffect(
    on(draft, (agent) => {
      if (!agent || restored === agent.id) return;
      restored = agent.id;
      if (!isSetupDraft(agent)) {
        batch(() => {
          setHiredId(agent.id);
          setStep("task");
        });
        setSearch({ agentId: agent.id, setupAgentId: undefined }, { replace: true });
        return;
      }
      const saved = setupFromAgent(agent);
      batch(() => {
        setProfile(reconcile(profileFromAgent(agent)));
        setSetup(reconcile(saved));
        setSavedSignature(saved.harness ? setupSignature(saved) : null);
      });
    }),
  );

  // ---- Shared data --------------------------------------------------------------------------
  const onModel = () => step() === "model";
  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
  }));
  const environment = createMemo(() =>
    setup.environmentId ? environments.data?.find((entry) => entry.id === setup.environmentId) : instanceDefaultEnvironment(environments.data),
  );
  const adapters = createQuery(() => ({
    queryKey: queryKeys.agents.adapters(company().id, setup.environmentId || null),
    queryFn: ({ signal }) => agentsApi.adapters(company().id, setup.environmentId || null, signal),
    staleTime: 60_000,
  }));
  const harnesses = createMemo(() => harnessChoices(adapters.data, agents.data));
  const runner = createMemo(() => resolveRunner(setup.harness, setup.runner, adapters.data));
  const connections = createQuery(() => ({
    queryKey: [...queryKeys.aiConnections.list(company().id), "agent", draftId() ?? "new"] as const,
    queryFn: () => aiConnectionsApi.list(company().id, draftId() ?? undefined),
    enabled: onModel(),
    retry: false,
  }));
  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get, enabled: onModel() }));
  const signIns = createMemo(() => (setup.harness ? signInChoices(setup.harness, connections.data) : []));
  const modelOptions = createMemo<AdapterModelOptions>(() => ({
    provider: setup.binding && setup.binding.mode !== "router" ? setup.binding.provider : undefined,
    environmentId: setup.environmentId || null,
  }));
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, setup.harness, adapterModelKeyOptions(modelOptions())),
    queryFn: () => agentsApi.adapterModels(company().id, setup.harness, modelOptions()),
    enabled: onModel() && !!setup.harness,
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const efforts = createMemo(() => (setup.harness ? setupEffortOptions(setup.harness, setup.model, runner().runner) : []));
  createEffect(() => {
    const effort = setup.effort;
    if (effort && !efforts().some((option) => option.value === effort)) setSetup("effort", "");
  });

  // ---- Saving -------------------------------------------------------------------------------
  const [busy, setBusy] = createSignal<"continue" | "hire" | "launch" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let inFlight: Promise<unknown> = Promise.resolve();

  const remember = (agent: Agent) => {
    client.setQueryData<AgentDetail>(queryKeys.agents.detail(agent.id), (old) => (old ? { ...old, ...agent } : old));
    void client.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
    void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
  };

  const saveSetup = async (): Promise<Agent | null> => {
    await inFlight.catch(() => undefined);
    const agent = draft();
    if (!agent || !setup.harness) return agent ?? null;
    const signature = setupSignature(setup);
    if (signature === savedSignature()) return agent;
    setSaving(true);
    setSaveError(null);
    const work = agentsApi.update(agent.id, setupPatch(agent, { ...setup }, runner().runner), company().id);
    inFlight = work;
    try {
      const saved = await work;
      setSavedSignature(signature);
      remember(saved);
      return saved;
    } catch (caught) {
      setSaveError(failure(caught, "Couldn't save the setup."));
      return null;
    } finally {
      setSaving(false);
    }
  };

  let saveTimer: number | undefined;
  onCleanup(() => window.clearTimeout(saveTimer));
  createEffect(
    on(
      () => setupSignature(setup),
      () => {
        window.clearTimeout(saveTimer);
        if (!draft() || !setup.harness) return;
        saveTimer = window.setTimeout(() => void saveSetup(), 500);
      },
      { defer: true },
    ),
  );
  const flush = () => {
    window.clearTimeout(saveTimer);
    return saveSetup();
  };

  /** The agent step's Continue: saves a paused draft (or the profile's changes to it). */
  const toModel = async () => {
    const found = profileProblem(profile);
    if (found) return setProblem(found);
    setBusy("continue");
    setProblem(null);
    try {
      const agent = draft();
      if (!agent) {
        const provisional = provisionalAdapter(adapters.data);
        if (!provisional) throw new Error("No harness is available on this instance.");
        const created = await agentsApi.create(company().id, {
          ...draftCreateRequest({ ...profile }, crypto.randomUUID(), provisional),
          onboardingFirstAgent: true,
        });
        restored = created.id;
        batch(() => {
          setDraftId(created.id);
          setProfile("name", created.name);
        });
        setSearch({ setupAgentId: created.id, agentId: undefined }, { replace: true });
        void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
      } else {
        const patch = profilePatch(agent, profile);
        if (patch) remember(await agentsApi.update(agent.id, patch, company().id));
      }
      setStep("model");
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the agent."));
    } finally {
      setBusy(null);
    }
  };

  // ---- Harness choices ----------------------------------------------------------------------
  const [test, setTest] = createSignal<{ signature: string; result: AdapterEnvironmentTestResult } | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [testError, setTestError] = createSignal<string | null>(null);
  const currentTest = () => (test()?.signature === setupSignature(setup) ? test()!.result : null);

  function pickHarness(type: string) {
    if (setup.harness === type) return;
    setSetup(reconcile({ ...emptySetup(type), environmentId: setup.environmentId, binding: defaultBinding(type, connections.data) }));
    setTestError(null);
    setProblem(null);
  }

  const runTest = async (): Promise<AdapterEnvironmentTestResult | null> => {
    const found = setupProblem(setup);
    if (found) {
      setTestError(found);
      return null;
    }
    setTesting(true);
    setTestError(null);
    try {
      const agent = await flush();
      if (!agent) throw new Error(saveError() ?? "Save the setup first.");
      if (preparing(draft())) throw new Error("The agent's environment is still being prepared. Test again in a moment.");
      const env = environment();
      if (needsRunnerQualification(setup.harness, setup.runner, runner().recommended, env) && env) {
        const why = qualificationProblem(await environmentsApi.probe(env.id, company().id));
        if (why) throw new Error(why);
        await client.invalidateQueries({ queryKey: queryKeys.agents.adapters(company().id, setup.environmentId || null) });
      }
      const signature = setupSignature(setup);
      const result = await testSetup((type, body) => agentsApi.testEnvironment(company().id, type, body), {
        agentId: agent.id,
        setup: { ...setup },
        runner: runner().runner,
        runnerChoice: setup.runner,
        environmentId: env?.id ?? null,
        adapterConfig: setupAdapterConfig(setup, runner().runner, (agent.adapterConfig ?? {}) as Record<string, unknown>),
      });
      setTest({ signature, result });
      return result;
    } catch (caught) {
      setTestError(failure(caught, "The test couldn't run."));
      return null;
    } finally {
      setTesting(false);
    }
  };

  /** Hire: test first unless it has been, then finish the draft; an approval is approved here. */
  const hire = async () => {
    const found = profileProblem(profile) ?? setupProblem(setup);
    if (found) return setProblem(found);
    setBusy("hire");
    setProblem(null);
    try {
      const agent = await flush();
      if (!agent) throw new Error(saveError() ?? "Couldn't save the setup.");
      const earlier = currentTest();
      if (earlier && testBlocks(earlier)) return setProblem(`Fix what the test found before hiring ${profile.name.trim()}.`);
      if (!earlier) {
        const tested = await runTest();
        if (!tested) return;
        if (!testAllowsHire(setup.harness, tested)) return setProblem(`The test didn't confirm the sign-in. Fix what it found before hiring ${profile.name.trim()}.`);
      }
      const response = await agentsApi.hire(company().id, { ...hireRequest(agent, { ...profile }, { ...setup }, runner().runner), onboardingFirstAgent: true });
      if (response.approval) await approvalsApi.approve(response.approval.id, "Approved during onboarding first-agent setup.");
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.agents.detail(response.agent.id) }),
        client.invalidateQueries({ queryKey: ["approvals", company().id] }),
      ]);
      batch(() => {
        setHiredId(response.agent.id);
        setStep("task");
      });
      setSearch({ agentId: response.agent.id, setupAgentId: undefined }, { replace: true });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't hire the agent."));
    } finally {
      setBusy(null);
    }
  };

  const retryPreparation = async () => {
    const agent = draft();
    if (!agent) return;
    try {
      remember(await agentsApi.retryLifecycle(agent.id, company().id));
    } catch (caught) {
      setSaveError(failure(caught, "Couldn't retry preparing the environment."));
    }
  };

  // ---- The first task -----------------------------------------------------------------------
  const hired = () => agents.data?.find((agent) => agent.id === hiredId());
  const [taskTitle, setTaskTitle] = createSignal(DEFAULT_TASK_TITLE);
  const launch = async () => {
    const agentId = hiredId();
    if (!agentId) return;
    setBusy("launch");
    setProblem(null);
    try {
      const { issueRef } = await launchFirstTask(
        { goals: goalsApi.list, projects: projectsApi.list, createProject: projectsApi.create, createIssue: issuesApi.create },
        { companyId: company().id, agentId, title: taskTitle() },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) }),
      ]);
      navigate(onboardingTaskHref(company().issuePrefix, issueRef));
    } catch (caught) {
      setProblem(failure(caught, "Couldn't create the first task."));
    } finally {
      setBusy(null);
    }
  };

  // ---- Connect Claude -----------------------------------------------------------------------
  const [connectOpen, setConnectOpen] = createSignal(false);
  const provider = () => (setup.harness ? providerForHarness(setup.harness) : undefined);

  // ---- View ---------------------------------------------------------------------------------
  const working = () => busy() !== null || testing();
  const runnerRow = createMemo(() => runnerSwitch(setup.runner, runner()));
  const resuming = () => !!draftId() && !draft() && !detail.isError;
  const effortLabel = () => efforts().find((option) => option.value === setup.effort)?.label ?? "Auto";
  const previewAgent = () => hired() ?? { id: draftId() ?? "new-agent", name: profile.name || "New agent", appearance: paletteAppearance(profile.paletteId) };
  const previewRows = createMemo(() => {
    const rows: [string, string][] = [["Organization", company().name]];
    if (step() !== "agent" && setup.harness) {
      rows.push(
        ["Harness", runner().label],
        ["Model", `${modelLabel(setup.model, models.data) ?? "Harness default"}${efforts().length ? ` · ${effortLabel()}` : ""}`],
        ["Runs on", environment()?.name ?? "Organization default"],
      );
    }
    return rows;
  });
  const title = () => (step() === "task" ? "Give it a first task" : step() === "model" ? "Connect a model" : "Create your first agent");

  const preview = (
    <aside class="card na-preview" aria-label="Preview">
      <div class="na-preview-avatar">
        <AgentAvatar agent={previewAgent()} size={128} ring={false} />
      </div>
      <div class="na-preview-text">
        <div class="na-preview-name disp">{hired()?.name ?? (profile.name.trim() || "New agent")}</div>
        <div class="na-preview-line">{step() === "task" ? "Hired, ready for work" : previewLine(profile, null)}</div>
      </div>
      <Show when={draftId() && step() !== "task"}>
        <span class="na-draft-pill">
          <span class="na-draft-glyph" aria-hidden="true" />
          Draft, paused
        </span>
      </Show>
      <dl class="na-preview-rows">
        <For each={previewRows()}>
          {([key, value]) => (
            <>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </>
          )}
        </For>
      </dl>
    </aside>
  );

  return (
    <Show when={step()} fallback={<Splash title="Loading" quiet />}>
      <OnboardingFrame
        step={step()!}
        title={title()}
        organization={company().name}
        aside={preview}
        leave={
          <>
            Finish later from here, or{" "}
            <A class="ps-link" href={`${base()}/dashboard`}>
              go to the dashboard
            </A>
            .
          </>
        }
      >
        <section class="card settings-card na-form ob-card" aria-label={title()}>
          <Show when={detail.isError && step() !== "task"}>
            <p class="na-note" role="alert">
              Couldn't open that draft: {failure(detail.error, "it may have been hired or removed")}.{" "}
              <button
                type="button"
                class="ps-link"
                onClick={() => {
                  batch(() => {
                    setDraftId(null);
                    setStep("agent");
                    setProfile(reconcile(onboardingProfile(agents.data)));
                    setSetup(reconcile(emptySetup()));
                  });
                  setSearch({ setupAgentId: undefined }, { replace: true });
                }}
              >
                Start a new agent
              </button>
            </p>
          </Show>
          <header class="na-form-head">
            <h2 class="disp">{step() === "task" ? "First task" : step() === "model" ? "Harness and model" : "First agent"}</h2>
            <Show when={step() === "model" && (saving() || saveError())}>
              <span class="na-save" classList={{ "na-save--error": !!saveError() }} role={saveError() ? "alert" : "status"}>
                {saveError() ?? "Saving…"}
              </span>
            </Show>
          </header>

          <Show when={!resuming() || step() === "task"} fallback={<p class="na-loading cap" role="status">Opening the draft…</p>}>
            <div class="settings-rows">
              <Switch>
                <Match when={step() === "agent"}>
                  <SettingsRow label="Name" for="ob-agent-name" help="Your first agent runs the organization with you. Its instructions are written for that.">
                    <TextInput
                      id="ob-agent-name"
                      variant="title"
                      value={profile.name}
                      placeholder="Agent name"
                      autocomplete="off"
                      maxLength={100}
                      onInput={(event) => setProfile("name", event.currentTarget.value)}
                      onKeyDown={(event) => event.key === "Enter" && void toModel()}
                    />
                  </SettingsRow>
                  <SettingsRow label="Avatar" help="One of the ClipLab palettes.">
                    <PaletteGrid
                      class="na-palettes"
                      agent={{ id: draftId() ?? "new-agent", name: profile.name || "New agent" }}
                      value={profile.paletteId}
                      onPick={(palette) => setProfile("paletteId", palette)}
                    />
                  </SettingsRow>
                </Match>

                <Match when={step() === "model"}>
                  <SettingsRow label="Harness" help="The program the agent works in.">
                    <Show when={harnesses().length > 0} fallback={<span class="ag-static-text">{adapters.isError ? "Couldn't load the harnesses." : "Loading harnesses…"}</span>}>
                      <div class="na-harnesses" role="radiogroup" aria-label="Harness">
                        <For each={harnesses()}>
                          {(choice) => (
                            <button type="button" role="radio" class="na-harness" aria-checked={setup.harness === choice.type} disabled={working()} onClick={() => pickHarness(choice.type)}>
                              <span class="na-harness-mark mono" aria-hidden="true">
                                {harnessMark(choice.type)}
                              </span>
                              <span class="na-harness-text">
                                <span class="na-harness-name">{choice.label}</span>
                                <span class="na-harness-meta">{choice.meta}</span>
                              </span>
                              <Show when={setup.harness === choice.type}>
                                <span class="na-harness-check" aria-hidden="true">
                                  <Check size={11} stroke-width={3} />
                                </span>
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </SettingsRow>

                  <Show when={setup.harness}>
                    <Show when={draft()?.lifecycleError || preparing(draft())}>
                      <div class="frow na-prep">
                        <span class="flabel">Environment setup</span>
                        <div class="ps-inline">
                          <Show when={draft()?.lifecycleError} fallback={<span class="ag-static-text" role="status">Preparing the agent's environment…</span>}>
                            <span class="na-warn" role="alert">
                              {draft()!.lifecycleError}
                            </span>
                            <Button size="compact" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => void retryPreparation()}>
                              Retry preparation
                            </Button>
                          </Show>
                        </div>
                      </div>
                    </Show>

                    <SettingsRow label="Sign-in" help="How the harness reaches its model: your subscription or an API key.">
                      <div class="ps-inline">
                        <Menu>
                          <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label={`Sign-in: ${selectedSignIn(signIns(), setup.binding)?.name ?? "an AI connection"}`}>
                            {selectedSignIn(signIns(), setup.binding)?.name ?? "An AI connection"}
                          </Menu.Trigger>
                          <Menu.Content label="Sign-in" width={360}>
                            <Show when={connections.isLoading}>
                              <p class="nt-menu-note">Loading connections…</p>
                            </Show>
                            <For each={signIns()}>
                              {(choice) => (
                                <Menu.Item
                                  disabled={choice.disabled}
                                  description={choice.description}
                                  onSelect={() => setSetup("binding", choice.binding)}
                                  hint={selectedSignIn(signIns(), setup.binding)?.id === choice.id ? <Check size={14} /> : undefined}
                                >
                                  {choice.name}
                                </Menu.Item>
                              )}
                            </For>
                          </Menu.Content>
                        </Menu>
                        <Show when={provider() === "anthropic" && connections.data}>
                          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setConnectOpen(true)}>
                            Connect Claude
                          </Button>
                        </Show>
                      </div>
                      <span class="fhelp">{selectedSignIn(signIns(), setup.binding)?.description}</span>
                    </SettingsRow>

                    <SettingsRow label="Model" for={models.data?.length ? undefined : "ob-model"}>
                      <Show
                        when={models.data?.length}
                        fallback={
                          <TextInput
                            id="ob-model"
                            class="ps-field-320 mono"
                            value={setup.model}
                            autocomplete="off"
                            spellcheck={false}
                            placeholder={requiresProviderModel(setup.harness) ? "provider/model" : models.isLoading ? "Loading models…" : "Harness default"}
                            onChange={(event) => setSetup("model", event.currentTarget.value.trim())}
                          />
                        }
                      >
                        <ModelMenu models={models.data} loading={models.isLoading} value={setup.model} allowDefault={!requiresProviderModel(setup.harness)} onChange={(model) => setSetup("model", model)} />
                      </Show>
                    </SettingsRow>

                    <SettingsRow label="Where it runs">
                      <EnvironmentMenu environments={environments.data} value={setup.environmentId} onChange={(id) => setSetup("environmentId", id)} disabled={working()} />
                    </SettingsRow>

                    <Show when={efforts().length > 0}>
                      <SettingsRow label="Thinking effort" help="More effort is slower and costs more.">
                        <Segmented label="Thinking effort" options={[{ value: "", label: "Auto" }, ...efforts()]} value={setup.effort} onChange={(value) => setSetup("effort", value)} />
                      </SettingsRow>
                    </Show>

                    <Show when={runner().applies}>
                      <SettingsRow label="Runner" help="Picked for this harness and machine. You can switch it later in the agent's settings.">
                        <div class="ps-inline">
                          <TonePill tone={runner().runner === "paperclip" ? "run" : "violet"} compact>
                            {runnerLabel(runner().runner)}
                          </TonePill>
                          <Show when={runnerRow().recommended}>
                            <span class="ps-muted-line">Recommended here</span>
                          </Show>
                          <Switch>
                            <Match when={runnerRow().offer?.kind === "recommended"}>
                              <button type="button" class="ps-link" onClick={() => setSetup("runner", "auto")}>
                                Use the recommended runner
                              </button>
                            </Match>
                            <Match when={runnerRow().offer?.kind === "runner" && (runnerRow().offer as { runner: AgentRunner }).runner}>
                              {(other) => (
                                <button type="button" class="ps-link" onClick={() => setSetup("runner", other())}>
                                  Use the {other() === "paperclip" ? "Paperclip Runner" : "legacy runner"}
                                </button>
                              )}
                            </Match>
                          </Switch>
                        </div>
                      </SettingsRow>
                    </Show>

                    <SettingsRow label="Test" help="Checks the harness is installed, signed in and can reach the model.">
                      <div class="ps-stack">
                        <div class="ps-inline">
                          <Button size="compact" disabled={working() || saving()} icon={<Check size={14} aria-hidden="true" />} onClick={() => void runTest()}>
                            {testing() ? "Testing…" : currentTest() ? "Test again" : "Test"}
                          </Button>
                          <span
                            class="na-test"
                            role="status"
                            data-tone={currentTest() ? (testBlocks(currentTest()!) ? "red" : currentTest()!.status === "warn" ? "amber" : "green") : undefined}
                          >
                            <span class="na-test-glyph" aria-hidden="true" />
                            {testError() ?? (currentTest() ? testSummary(currentTest()!) : "Not tested yet. Hire tests it first.")}
                          </span>
                        </div>
                        <TestChecks result={currentTest()} />
                      </div>
                    </SettingsRow>
                  </Show>
                </Match>

                <Match when={step() === "task"}>
                  <SettingsRow label="Task" for="ob-task-title" help="Paperclip writes the brief. It's where you and your agent plan what comes next.">
                    <TextInput
                      id="ob-task-title"
                      variant="title"
                      value={taskTitle()}
                      maxLength={200}
                      autocomplete="off"
                      onInput={(event) => setTaskTitle(event.currentTarget.value)}
                      onKeyDown={(event) => event.key === "Enter" && void launch()}
                    />
                  </SettingsRow>
                  <SettingsRow label="Assigned to">
                    <span class="ob-task-ready">
                      <AgentAvatar agent={previewAgent()} size={32} ring={false} />
                      <span class="ag-static-text">{hired()?.name ?? "Your agent"}</span>
                    </span>
                  </SettingsRow>
                </Match>
              </Switch>
            </div>
          </Show>

          <footer class="na-foot">
            <Show when={step() === "model"} fallback={<span />}>
              <Button variant="quiet" size="compact" disabled={working()} icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setStep("agent")}>
                Back
              </Button>
            </Show>
            <span class="na-foot-end">
              <Show when={problem()}>
                <span class="na-problem" role="alert">
                  {problem()}
                </span>
              </Show>
              <Switch>
                <Match when={step() === "agent"}>
                  <Button variant="primary" disabled={working() || resuming()} onClick={() => void toModel()}>
                    {busy() === "continue" ? "Saving…" : "Continue"}
                  </Button>
                </Match>
                <Match when={step() === "model"}>
                  <Button variant="primary" disabled={working() || saving() || !setup.harness || preparing(draft())} onClick={() => void hire()}>
                    {busy() === "hire" ? (testing() ? "Testing…" : "Hiring…") : `Hire ${profile.name.trim() || "agent"}`}
                  </Button>
                </Match>
                <Match when={step() === "task"}>
                  <Button variant="primary" disabled={working() || !hiredId()} onClick={() => void launch()}>
                    {busy() === "launch" ? "Starting…" : "Get started"}
                  </Button>
                </Match>
              </Switch>
            </span>
          </footer>
        </section>

        <Show when={connections.data}>
          {(list) => (
            <ConnectionSetup
              open={connectOpen()}
              onOpenChange={setConnectOpen}
              list={list()}
              subscriptionSupported={localLoginSupported(health.data)}
              onSaved={async (name, result) => {
                setConnectOpen(false);
                const fresh = await connections.refetch();
                const choice = signInChoices(setup.harness, fresh.data).find(
                  (entry) => entry.binding && "connectionId" in entry.binding && entry.binding.connectionId === result.connectionId,
                );
                setSetup("binding", choice?.binding ?? defaultBinding(setup.harness, fresh.data));
                pushToast({ tone: "success", title: `Connected ${name}` });
              }}
            />
          )}
        </Show>
      </OnboardingFrame>
    </Show>
  );
}
