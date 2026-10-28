import type { AdapterEnvironmentTestResult, Agent, AgentDetail, AgentRunner } from "@paperclipai/shared";
import { A, Navigate, useNavigate, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Check, Info, Plus, RotateCw } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, untrack } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { adapterModelKeyOptions, agentsApi, type AdapterModelOptions } from "@/api/agents";
import { aiConnectionsApi } from "@/api/ai-connections";
import { environmentsApi } from "@/api/environments";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { ConnectionSetup } from "@/connectors/ConnectionSetup";
import { localLoginSupported } from "@/connectors/connection-model";
import { useCompaniesQuery, findCompanyByPrefix, lastCompanyPrefix, useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { providerForHarness } from "@/org/bulk-model";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { FieldButton, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { Tooltip } from "@/ui/Tooltip";
import { pushToast } from "@/ui/Toast";
import { managerCandidates, modelLabel, roleLabel, runnerLabel } from "../agent-model";
import {
  EnvironmentMenu,
  harnessMark,
  instanceDefaultEnvironment,
  ManagerMenu,
  ModelMenu,
  PaletteGrid,
  paletteAppearance,
  RoleMenu,
  TestChecks,
} from "../settings/fields";
import { failure } from "../shared";
import {
  defaultBinding,
  defaultProfile,
  draftCreateRequest,
  emptySetup,
  harnessChoices,
  hireOutcome,
  hireRequest,
  isSetupDraft,
  legacyHireParams,
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
  unfinishedDrafts,
  type ProfileDraft,
  type SetupDraft,
} from "./new-agent-model";
// Settings rows, menus and palettes are the agent settings' (and the project settings' they share).
import "@/projects/NewProjectDialog.css";
import "@/projects/settings/ProjectSettings.css";
import "@/tasks/NewTaskDialog.css";
import "../Agent.css";
import "./NewAgent.css";

/*
 * New agent (`/:prefix/agents/new`, boards N2 and N3): a page in two steps, Profile and Harness and
 * model, with a preview card that sums up the choices. The flow is upstream's (new-agent-model.ts):
 * Continue saves a paused setup draft, each harness choice is saved to it, Test checks it, and Hire
 * finishes it. A hire the organization must approve first waits in the Inbox, and the page lands on
 * the new agent either way.
 *
 * A draft is resumed from `?setupAgentId=` (the old UI's "Finish setup" link and this page's own
 * address once Continue saved it), or from the unfinished drafts listed on the Profile step.
 */

type Step = "profile" | "model";

export function NewAgentPage() {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const legacy = untrack(() => legacyHireParams(search));
  const base = () => `/${company().issuePrefix}`;
  const agents = useAgentsQuery();

  // ---- The draft --------------------------------------------------------------------------
  const [draftId, setDraftId] = createSignal<string | null>(legacy.setupAgentId ?? null);
  const detail = createQuery(() => ({
    queryKey: queryKeys.agents.detail(draftId() ?? "new"),
    queryFn: ({ signal }) => agentsApi.get(draftId()!, company().id, signal),
    enabled: !!draftId(),
    retry: false,
    // While the server prepares the draft's environment, check on it every second.
    refetchInterval: (query: { state: { data?: AgentDetail } }) => (preparing(query.state.data) ? 1000 : false),
  }));
  const draft = createMemo(() => (detail.data?.companyId === company().id && detail.data.id === draftId() ? detail.data : undefined));

  const [step, setStep] = createSignal<Step>(legacy.setupAgentId ? "model" : "profile");
  const [profile, setProfile] = createStore<ProfileDraft>(defaultProfile([], legacy.name ?? ""));
  const [setup, setSetup] = createStore<SetupDraft>(emptySetup());
  let profileTouched = false;
  let restored: string | null = null;

  // A new profile's defaults (role, manager, palette) need the company's agents.
  createEffect(
    on(
      () => agents.data,
      (list) => {
        if (!list || profileTouched || draftId()) return;
        setProfile(reconcile(defaultProfile(list, profile.name)));
      },
    ),
  );

  // A resumed draft fills both steps once; a finished one opens its page.
  createEffect(
    on(draft, (agent) => {
      if (!agent || restored === agent.id) return;
      restored = agent.id;
      if (!isSetupDraft(agent)) {
        navigate(`${base()}/agents/${agent.urlKey ?? agent.id}`, { replace: true });
        return;
      }
      const saved = setupFromAgent(agent);
      batch(() => {
        setProfile(reconcile(profileFromAgent(agent)));
        setSetup(reconcile(saved));
        setSavedSignature(saved.harness ? setupSignature(saved) : null);
        setStep("model");
      });
    }),
  );

  // ---- Shared data --------------------------------------------------------------------------
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
    enabled: step() === "model",
    retry: false,
  }));
  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get, enabled: step() === "model" }));
  const signIns = createMemo(() => (setup.harness ? signInChoices(setup.harness, connections.data) : []));
  const modelOptions = createMemo<AdapterModelOptions>(() => ({
    provider: setup.binding && setup.binding.mode !== "router" ? setup.binding.provider : undefined,
    environmentId: setup.environmentId || null,
  }));
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, setup.harness, adapterModelKeyOptions(modelOptions())),
    queryFn: () => agentsApi.adapterModels(company().id, setup.harness, modelOptions()),
    enabled: step() === "model" && !!setup.harness,
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const efforts = createMemo(() => (setup.harness ? setupEffortOptions(setup.harness, setup.model, runner().runner) : []));
  // A model without the chosen effort goes back to Auto.
  createEffect(() => {
    const effort = setup.effort;
    if (effort && !efforts().some((option) => option.value === effort)) setSetup("effort", "");
  });

  const candidates = createMemo(() => managerCandidates(agents.data ?? [], draftId() ?? "").filter((agent) => !isSetupDraft(agent)));
  const manager = () => agents.data?.find((agent) => agent.id === profile.reportsTo);
  const drafts = createMemo(() => unfinishedDrafts(agents.data).filter((agent) => agent.id !== draftId()));
  const needsApproval = () => company().requireBoardApprovalForNewAgents === true;

  // ---- Saving -------------------------------------------------------------------------------
  const [busy, setBusy] = createSignal<"continue" | "hire" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [savedSignature, setSavedSignature] = createSignal<string | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let inFlight: Promise<unknown> = Promise.resolve();

  const remember = (agent: Agent) => {
    client.setQueryData<AgentDetail>(queryKeys.agents.detail(agent.id), (old) => (old ? { ...old, ...agent } : old));
    void client.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
    void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
  };

  /** Saves the harness choices to the draft unless it has them already; resolves to the draft, or null when that failed. */
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
      const warnings = saved.configurationWarnings ?? [];
      if (warnings.length) pushToast({ tone: "warn", title: "Saved with a warning", body: warnings.map((warning) => warning.message).join(" ") });
      return saved;
    } catch (caught) {
      setSaveError(failure(caught, "Couldn't save the setup."));
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Each choice is saved to the draft shortly after it's made, so the server can prepare its environment.
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
        const created = await agentsApi.create(company().id, draftCreateRequest({ ...profile }, crypto.randomUUID(), provisional));
        restored = created.id;
        batch(() => {
          setDraftId(created.id);
          setProfile("name", created.name);
          if (legacy.harness && !setup.harness) pickHarness(legacy.harness);
        });
        setSearch({ setupAgentId: created.id, name: undefined, adapterType: undefined, runnerProvider: undefined, runner: undefined }, { replace: true });
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

  const hire = async () => {
    const found = profileProblem(profile) ?? setupProblem(setup);
    if (found) return setProblem(found);
    setBusy("hire");
    setProblem(null);
    try {
      const agent = await flush();
      if (!agent) throw new Error(saveError() ?? "Couldn't save the setup.");
      // As the old UI's Finish: test first unless it has been, and stop on a failing test.
      const earlier = currentTest();
      if (earlier && testBlocks(earlier)) return setProblem(`Fix what the test found before hiring ${profile.name.trim()}.`);
      if (!earlier) {
        const tested = await runTest();
        if (!tested) return;
        if (!testAllowsHire(setup.harness, tested)) return setProblem(`The test didn't confirm the sign-in. Fix what it found before hiring ${profile.name.trim()}.`);
      }
      const response = await agentsApi.hire(company().id, hireRequest(agent, { ...profile }, { ...setup }, runner().runner));
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.agents.detail(response.agent.id) }),
        client.invalidateQueries({ queryKey: ["approvals", company().id] }),
        client.invalidateQueries({ queryKey: queryKeys.sidebarBadges(company().id) }),
      ]);
      if (hireOutcome(response) === "approval") {
        pushToast({
          tone: "info",
          title: `Asked to hire ${response.agent.name}`,
          body: "The request is waiting in the Inbox. The agent starts work once it's approved.",
          action: { label: "Open the Inbox", href: `${base()}/inbox` },
          ttlMs: 8000,
        });
      } else {
        pushToast({ tone: "success", title: `Hired ${response.agent.name}`, body: "Assign it a task when you're ready." });
      }
      navigate(`${base()}/agents/${response.agent.urlKey ?? response.agent.id}`);
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

  const resume = (agentId: string) => {
    setDraftId(agentId);
    setSearch({ setupAgentId: agentId }, { replace: true });
  };

  // ---- Connect Claude -----------------------------------------------------------------------
  const [connectOpen, setConnectOpen] = createSignal(false);
  const provider = () => (setup.harness ? providerForHarness(setup.harness) : undefined);

  // ---- View ---------------------------------------------------------------------------------
  const working = () => busy() !== null || testing();
  const runnerRow = createMemo(() => runnerSwitch(setup.runner, runner()));
  const resuming = () => !!draftId() && !draft() && !detail.isError;
  const effortLabel = () => efforts().find((option) => option.value === setup.effort)?.label ?? "Auto";
  const previewRows = createMemo(() => {
    const rows: [string, string][] = [
      ["Role", roleLabel(profile.role)],
      ["Reports to", manager()?.name ?? "No one"],
    ];
    if (step() === "model" && setup.harness) {
      rows.push(
        ["Harness", runner().label],
        ["Model", `${modelLabel(setup.model, models.data) ?? "Harness default"}${efforts().length ? ` · ${effortLabel()}` : ""}`],
        ["Runs on", environment()?.name ?? "Organization default"],
      );
    }
    return rows;
  });

  return (
    <Show when={!legacy.createdAgentId} fallback={<Navigate href={`${base()}/agents/${legacy.createdAgentId}`} />}>
      <div class="na">
        <header class="card na-head">
          <div class="na-head-text">
            <nav aria-label="Breadcrumb" class="na-crumbs">
              <A href={`${base()}/agents`}>Agents</A>
              <span aria-hidden="true">/</span>
              <span aria-current="page">New agent</span>
            </nav>
            <h1 class="disp">New agent</h1>
          </div>
          <ol class="na-steps" aria-label="Steps">
            <li>
              <button type="button" aria-current={step() === "profile" ? "step" : undefined} disabled={working()} onClick={() => setStep("profile")}>
                <span class="na-step-disc" data-state={step() === "profile" ? "current" : "done"} aria-hidden="true">
                  <Show when={step() === "profile"} fallback={<Check size={13} stroke-width={3} />}>
                    1
                  </Show>
                </span>
                Profile
              </button>
            </li>
            <li>
              <button type="button" aria-current={step() === "model" ? "step" : undefined} disabled={working()} onClick={() => step() !== "model" && void toModel()}>
                <span class="na-step-disc" data-state={step() === "model" ? "current" : "todo"} aria-hidden="true">
                  2
                </span>
                Harness and model
              </button>
            </li>
          </ol>
        </header>

        <Show when={detail.isError}>
          <section class="card na-note" role="alert">
            Couldn't open that draft: {failure(detail.error, "it may have been hired or removed")}.{" "}
            <A class="ps-link" href={`${base()}/agents/new`} onClick={() => (setDraftId(null), setSearch({ setupAgentId: undefined }))}>
              Start a new agent
            </A>
          </section>
        </Show>

        <Show when={step() === "profile" && !draftId() && drafts().length > 0}>
          <section class="card na-drafts" aria-label="Unfinished agents">
            <span class="na-drafts-title">
              {drafts().length === 1 ? "1 agent isn't finished yet" : `${drafts().length} agents aren't finished yet`}
            </span>
            <ul>
              <For each={drafts().slice(0, 4)}>
                {(agent) => (
                  <li>
                    <AgentAvatar agent={agent} size={24} ring={false} />
                    <span class="na-drafts-name">{agent.name}</span>
                    <button type="button" class="ps-link" onClick={() => resume(agent.id)}>
                      Finish setup
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <div class="na-grid">
          <section class="card settings-card na-form" aria-labelledby="na-step-title">
            <header class="na-form-head">
              <h2 class="disp" id="na-step-title">
                {step() === "profile" ? "Profile" : "Harness and model"}
              </h2>
              <Show when={step() === "model" && (saving() || saveError())}>
                <span class="na-save" classList={{ "na-save--error": !!saveError() }} role={saveError() ? "alert" : "status"}>
                  {saveError() ?? "Saving…"}
                </span>
              </Show>
            </header>

            <Show when={!resuming()} fallback={<p class="na-loading cap" role="status">Opening the draft…</p>}>
              <div class="settings-rows">
                <Switch>
                  <Match when={step() === "profile"}>
                    <ProfileFields
                      profile={profile}
                      onChange={(key, value) => {
                        profileTouched = true;
                        setProfile(key, value as never);
                      }}
                      seed={draftId() ?? "new-agent"}
                      candidates={candidates()}
                      manager={manager()}
                      onSubmit={() => void toModel()}
                    />
                  </Match>
                  <Match when={step() === "model"}>
                    <SettingsRow label="Harness" help="The program the agent works in.">
                      <Show when={harnesses().length > 0} fallback={<span class="ag-static-text">{adapters.isError ? "Couldn't load the harnesses." : "Loading harnesses…"}</span>}>
                        <div class="na-harnesses" role="radiogroup" aria-label="Harness">
                          <For each={harnesses()}>
                            {(choice) => (
                              <button
                                type="button"
                                role="radio"
                                class="na-harness"
                                aria-checked={setup.harness === choice.type}
                                disabled={working()}
                                onClick={() => pickHarness(choice.type)}
                              >
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
                            <Show
                              when={draft()?.lifecycleError}
                              fallback={
                                <span class="ag-static-text" role="status">
                                  Preparing the agent's environment…
                                </span>
                              }
                            >
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

                      <SettingsRow label="Sign-in" help="How the harness reaches its model.">
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
                          <Show
                            when={provider() === "anthropic" && connections.data}
                            fallback={
                              <A class="ps-link" href={`${base()}/apps/ai`}>
                                Manage connections
                              </A>
                            }
                          >
                            <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setConnectOpen(true)}>
                              Connect Claude
                            </Button>
                          </Show>
                        </div>
                        <span class="fhelp">{selectedSignIn(signIns(), setup.binding)?.description}</span>
                      </SettingsRow>

                      <SettingsRow label="Model" for={models.data?.length ? undefined : "na-model"}>
                        <Show
                          when={models.data?.length}
                          fallback={
                            <TextInput
                              id="na-model"
                              class="ps-field-320 mono"
                              value={setup.model}
                              autocomplete="off"
                              spellcheck={false}
                              placeholder={requiresProviderModel(setup.harness) ? "provider/model" : models.isLoading ? "Loading models…" : "Harness default"}
                              onChange={(event) => setSetup("model", event.currentTarget.value.trim())}
                            />
                          }
                        >
                          <ModelMenu
                            models={models.data}
                            loading={models.isLoading}
                            value={setup.model}
                            allowDefault={!requiresProviderModel(setup.harness)}
                            onChange={(model) => setSetup("model", model)}
                          />
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
                            <span class="na-test" role="status" data-tone={currentTest() ? (testBlocks(currentTest()!) ? "red" : currentTest()!.status === "warn" ? "amber" : "green") : undefined}>
                              <span class="na-test-glyph" aria-hidden="true" />
                              {testError() ?? (currentTest() ? testSummary(currentTest()!) : "Not tested yet. Hire tests it first.")}
                            </span>
                          </div>
                          <TestChecks result={currentTest()} />
                        </div>
                      </SettingsRow>
                    </Show>
                  </Match>
                </Switch>
              </div>
            </Show>

            <footer class="na-foot">
              <Show
                when={step() === "model"}
                fallback={
                  <A class={buttonClass({ variant: "quiet", size: "compact" })} href={`${base()}/agents`}>
                    Cancel
                  </A>
                }
              >
                <Button variant="quiet" size="compact" disabled={working()} icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={() => setStep("profile")}>
                  Back
                </Button>
              </Show>
              <span class="na-foot-end">
                <Show when={problem()}>
                  <span class="na-problem" role="alert">
                    {problem()}
                  </span>
                </Show>
                <Show when={step() === "model" && needsApproval()}>
                  <Tooltip title="Approval first" content="This organization approves new agents first. The request goes to the Inbox, and the agent starts work once it's approved.">
                    {(triggerProps) => (
                      <button type="button" {...triggerProps} class="na-info" aria-label="Why it asks for approval">
                        <Info size={15} aria-hidden="true" />
                      </button>
                    )}
                  </Tooltip>
                </Show>
                <Show
                  when={step() === "model"}
                  fallback={
                    <Button variant="primary" disabled={working() || resuming()} onClick={() => void toModel()}>
                      {busy() === "continue" ? "Saving…" : "Continue"}
                    </Button>
                  }
                >
                  <Button variant="primary" disabled={working() || saving() || !setup.harness || preparing(draft())} onClick={() => void hire()}>
                    {busy() === "hire" ? (testing() ? "Testing…" : "Hiring…") : needsApproval() ? "Ask for approval" : "Hire agent"}
                  </Button>
                </Show>
              </span>
            </footer>
            <Show when={step() === "model" && needsApproval()}>
              <p class="na-approval-note">The request goes to the Inbox; the agent starts work once it's approved.</p>
            </Show>
          </section>

          <aside class="card na-preview" aria-label="Preview">
            <div class="na-preview-avatar">
              <AgentAvatar agent={{ id: draftId() ?? "new-agent", name: profile.name || "New agent", appearance: paletteAppearance(profile.paletteId) }} size={128} ring={false} />
            </div>
            <div class="na-preview-text">
              <div class="na-preview-name disp">{profile.name.trim() || "New agent"}</div>
              <div class="na-preview-line">{previewLine(profile, manager()?.name)}</div>
            </div>
            <Show when={draftId()}>
              <Tooltip content="Saved as a paused draft when you continued, so you can finish it later from here or the Agents page.">
                {(triggerProps) => (
                  <span {...triggerProps} class="na-draft-pill" tabindex="0">
                    <span class="na-draft-glyph" aria-hidden="true" />
                    Draft, paused
                  </span>
                )}
              </Tooltip>
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
        </div>

        <Show when={connections.data}>
          {(list) => (
            <ConnectionSetup
              open={connectOpen()}
              onOpenChange={setConnectOpen}
              list={list()}
              subscriptionSupported={localLoginSupported(health.data)}
              onSaved={async (name, result) => {
                setConnectOpen(false);
                pushToast({ tone: "success", title: `Connected ${name}` });
                const fresh = await connections.refetch();
                const choice = signInChoices(setup.harness, fresh.data).find((entry) => entry.binding && "connectionId" in entry.binding && entry.binding.connectionId === result.connectionId);
                setSetup("binding", choice?.binding ?? defaultBinding(setup.harness, fresh.data));
              }}
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

function ProfileFields(props: {
  profile: ProfileDraft;
  onChange: <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => void;
  seed: string;
  candidates: readonly Agent[];
  manager: Agent | undefined;
  onSubmit: () => void;
}) {
  return (
    <>
      <SettingsRow label="Avatar" help="One of the ClipLab palettes.">
        <PaletteGrid
          class="na-palettes"
          agent={{ id: props.seed, name: props.profile.name || "New agent" }}
          value={props.profile.paletteId}
          onPick={(palette) => props.onChange("paletteId", palette)}
        />
      </SettingsRow>
      <SettingsRow label="Name" for="na-name">
        <TextInput
          id="na-name"
          variant="title"
          value={props.profile.name}
          placeholder="Agent name"
          autocomplete="off"
          maxLength={100}
          onInput={(event) => props.onChange("name", event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && props.onSubmit()}
        />
      </SettingsRow>
      <SettingsRow label="Role">
        <RoleMenu value={props.profile.role} onChange={(role) => props.onChange("role", role)} />
      </SettingsRow>
      <SettingsRow label="Reports to" help="Its manager in the org chart.">
        <ManagerMenu candidates={props.candidates} manager={props.manager} value={props.profile.reportsTo} onChange={(id) => props.onChange("reportsTo", id)} />
      </SettingsRow>
      <SettingsRow label="Title" help="Shown in place of the role." for="na-title">
        <TextInput
          id="na-title"
          value={props.profile.title}
          placeholder="Optional, such as Head of options research"
          autocomplete="off"
          onInput={(event) => props.onChange("title", event.currentTarget.value)}
        />
      </SettingsRow>
      <SettingsRow label="What they do" help="Other agents read this when they decide what to hand over." for="na-caps">
        <TextArea
          id="na-caps"
          rows={4}
          value={props.profile.capabilities}
          placeholder="The work this agent takes on"
          onInput={(event) => props.onChange("capabilities", event.currentTarget.value)}
        />
      </SettingsRow>
    </>
  );
}

/** The old UI's unprefixed `/agents/new`: opens it in the last company you were in. */
export function UnprefixedNewAgent() {
  const companies = useCompaniesQuery();
  const [search] = useSearchParams();
  const target = () => {
    const list = companies.data;
    if (!list?.length) return null;
    return findCompanyByPrefix(list, lastCompanyPrefix() ?? undefined) ?? list[0]!;
  };
  const query = () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) if (typeof value === "string") params.set(key, value);
    return params.size ? `?${params}` : "";
  };
  return (
    <Show when={!companies.isLoading}>
      <Navigate href={target() ? `/${target()!.issuePrefix}/agents/new${query()}` : "/companies"} />
    </Show>
  );
}

