import type { Agent, ToolProfileDefaultAction, ToolProfileWithDetails, ToolRiskLevel } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { Check, ChevronRight, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { activeAgents } from "@/api/agents";
import { toolAccessApi, type ProfileTarget } from "@/api/tool-access";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { PageHeader } from "@/ui/PageHeader";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshTools } from "../shared";
import { CardState } from "./parts";
import { NewToolsChoice } from "./ProfileDetail";
import {
  appCheckState,
  appSelectionLabel,
  assignmentChanges,
  assignmentDraft,
  buildEntries,
  CAPABILITY_LABEL,
  countAllowed,
  parseEntries,
  profileKeyFrom,
  readWizardMeta,
  resumeStep,
  RULE_KINDS,
  ruleSummary,
  selectedToolIds,
  templateSelections,
  TEMPLATES,
  toggleApp,
  toggleTool,
  toolCapability,
  withWizardMeta,
  type AdvancedRule,
  type AppGroup,
  type AssignmentDraft,
  type RuleKind,
  type Selections,
  type TemplateKey,
  type ToolCapability,
  type WizardStep,
} from "./profile-model";
import { profilesBase } from "./Profiles";
import { useCompanyCatalog, useProfiles, useTargetNames } from "./queries";

/*
 * New access profile, or finishing one (`/apps/advanced/profiles/new?template=…`,
 * `/apps/advanced/profiles/:id/edit?step=…`, the old UI's ProfileWizard), in three steps:
 *
 * 1. Name: a starting point (a template or another profile), its name and description.
 * 2. Choose tools: per app, all of its tools (and ones it adds later), all but some, or a few; whether
 *    tools apps add later are allowed; and rules by name pattern, risk level or tool id.
 * 3. Assign: the organization default, agents, and (under More) projects and recurring tasks.
 *
 * Each step saves the profile as a draft, so "Save and finish later" can leave at any point; the
 * last step turns it on. Assignments are reconciled one by one and rolled back if one fails.
 */

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: "Name" },
  { step: 2, label: "Choose tools" },
  { step: 3, label: "Assign" },
];

const CAPABILITIES: ToolCapability[] = ["read", "write", "destructive"];

export function ProfileWizard(props: { profileId?: string; template: TemplateKey | null; step: WizardStep | null }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  const profiles = useProfiles();
  const catalog = useCompanyCatalog();
  const targets = useTargetNames();
  const base = () => profilesBase(company().issuePrefix);
  const existing = createMemo(() => (props.profileId ? (profiles.data?.profiles.find((entry) => entry.id === props.profileId) ?? null) : null));

  const [step, setStep] = createSignal<WizardStep>(1);
  const [draftId, setDraftId] = createSignal<string | null>(props.profileId ?? null);
  const [template, setTemplate] = createSignal<TemplateKey | null>(props.template);
  const [copyFrom, setCopyFrom] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [key, setKey] = createSignal("");
  const [keyEdited, setKeyEdited] = createSignal(false);
  const [selections, setSelections] = createStore<Selections>({});
  const [rules, setRules] = createSignal<AdvancedRule[]>([]);
  const [newTools, setNewTools] = createSignal<ToolProfileDefaultAction>("deny");
  const [assign, setAssign] = createStore<AssignmentDraft>({ agentIds: new Set(), projectIds: new Set(), routineIds: new Set(), companyDefault: false });

  // Resuming a draft (or editing a profile): fill the steps in once its catalog has loaded.
  let hydrated = false;
  createEffect(() => {
    const profile = existing();
    if (hydrated || !profile || catalog.loading()) return;
    hydrated = true;
    setName(profile.name);
    setDescription(profile.description ?? "");
    setKey(profile.profileKey);
    setKeyEdited(true);
    setNewTools(profile.defaultAction);
    const parsed = parseEntries(catalog.groups(), profile.entries);
    setSelections(reconcile(parsed.selections));
    setRules(parsed.rules);
    const meta = readWizardMeta(profile);
    setTemplate(meta?.template ?? null);
    setStep(props.step ?? (profile.status === "draft" ? resumeStep(meta) : 1));
    setAssign(assignmentDraft(profile.bindings));
  });
  const shownKey = () => (keyEdited() ? key() : profileKeyFrom(name()));
  const count = createMemo(() => countAllowed(catalog.groups(), selections, newTools(), catalog.catalog().length));

  /** The selections step 1's starting point implies. */
  const seed = (): Selections => {
    const chosen = template();
    if (chosen === "copy") {
      const source = profiles.data?.profiles.find((entry) => entry.id === copyFrom());
      if (source) return parseEntries(catalog.groups(), source.entries).selections;
    }
    if (chosen && chosen !== "copy") return templateSelections(chosen, catalog.groups());
    return { ...selections };
  };

  const saveDraft = createMutation(() => ({
    mutationFn: async (input: { next: WizardStep; completed: WizardStep; seed?: Selections }) => {
      const entries = buildEntries(catalog.groups(), input.seed ?? selections, rules(), newTools());
      const metadata = withWizardMeta(existing()?.metadata ?? null, { lastCompletedStep: input.completed, template: template() });
      const common = { name: name().trim() || "Untitled profile", description: description().trim() || null, defaultAction: newTools(), entries, metadata };
      const id = draftId();
      return id
        ? toolAccessApi.updateProfile(id, { ...common, profileKey: shownKey() || undefined })
        : toolAccessApi.createProfile(company().id, { ...common, profileKey: shownKey() || "profile", status: "draft" });
    },
    onSuccess: (profile, input) => {
      setDraftId(profile.id);
      if (input.seed) setSelections(reconcile(input.seed));
      setStep(input.next);
    },
    onError: (error) => pushToast({ title: "Couldn't save the draft", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  const finish = createMutation(() => ({
    mutationFn: async () => {
      const id = draftId();
      if (!id) throw new Error("Save the first step before finishing.");
      const profile = await toolAccessApi.updateProfile(id, {
        defaultAction: newTools(),
        entries: buildEntries(catalog.groups(), selections, rules(), newTools()),
        metadata: withWizardMeta(existing()?.metadata ?? null, { lastCompletedStep: 3, template: template() }),
      });
      await applyAssignments(company().id, profile, assign);
      return toolAccessApi.updateProfile(id, { status: "active" });
    },
    onSuccess: (profile) => {
      pushToast({ title: "Profile saved", tone: "success" });
      const unassigned = assign.agentIds.size === 0 && assign.projectIds.size === 0 && assign.routineIds.size === 0 && !assign.companyDefault;
      navigate(`${base()}/${profile.id}${unassigned ? "?created=1" : ""}`);
    },
    onError: (error) => pushToast({ title: "Couldn't save the profile", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  const busy = () => saveDraft.isPending || finish.isPending;
  const stepOneReady = () => Boolean(name().trim()) && (template() !== "copy" || Boolean(copyFrom()));
  const saveAndLeave = () =>
    saveDraft.mutate(
      { next: step(), completed: step() },
      {
        onSuccess: () => {
          pushToast({ title: "Draft saved", body: "Pick it up again from Access profiles.", tone: "success" });
          navigate(base());
        },
      },
    );

  return (
    <Show when={!props.profileId || profiles.isSuccess} fallback={<section class="card"><CardState loading={profiles.isPending} error={profiles.error} what="the profile" /></section>}>
      <Show
        when={!props.profileId || existing()}
        fallback={
          <section class="card ap-later">
            <h2 class="disp">Profile not found</h2>
            <p>
              It may have been deleted. <A href={base()}>Back to access profiles</A>
            </p>
          </section>
        }
      >
        <PageHeader
          size="compact"
          crumbs={
            <>
              <A href={`/${company().issuePrefix}/apps/advanced`}>Advanced</A>
              <span aria-hidden="true">/</span>
              <A href={base()}>Access profiles</A>
            </>
          }
          title={props.profileId ? (existing()?.status === "draft" ? "Finish your profile" : `Edit ${existing()?.name ?? "profile"}`) : "New access profile"}
          numbers={<span>Choose which tools it allows, then who gets it.</span>}
        >
          <ol class="tl-steps" aria-label="Steps">
            <For each={STEPS}>
              {(entry) => (
                <li aria-current={step() === entry.step ? "step" : undefined} classList={{ done: step() > entry.step }}>
                  <i>{step() > entry.step ? <Check size={12} aria-hidden="true" /> : entry.step}</i>
                  {entry.label}
                </li>
              )}
            </For>
          </ol>
        </PageHeader>

        <Switch>
          <Match when={step() === 1}>
            <section class="card ap-card" aria-labelledby="pw-name">
              <header class="chead">
                <h3 id="pw-name" class="disp">
                  Start from
                </h3>
                <p>A starting point for its tools. You choose the exact tools next.</p>
              </header>
              <div class="tl-form">
                <ul class="tl-choices">
                  <For each={TEMPLATES}>
                    {(entry) => (
                      <li>
                        <button type="button" class="tl-choice" aria-pressed={template() === entry.key} onClick={() => setTemplate(entry.key)}>
                          <b>{entry.title}</b>
                          {entry.description}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={template() === "copy"}>
                  <Field label="Which profile?" for="pw-copy">
                    <select id="pw-copy" class="tl-select" value={copyFrom() ?? ""} onChange={(event) => setCopyFrom(event.currentTarget.value || null)}>
                      <option value="">Choose a profile</option>
                      <For each={(profiles.data?.profiles ?? []).filter((entry) => entry.status !== "archived" && entry.id !== props.profileId)}>
                        {(entry) => (
                          <option value={entry.id} selected={entry.id === copyFrom()}>
                            {entry.name}
                          </option>
                        )}
                      </For>
                    </select>
                  </Field>
                </Show>
                <Field label="Name" for="pw-profile-name">
                  <TextInput id="pw-profile-name" maxLength={160} placeholder="Everyday work" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
                </Field>
                <Field label="Description (optional)" for="pw-profile-description">
                  <TextArea id="pw-profile-description" rows={2} placeholder="What is this profile for?" value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
                </Field>
                <details class="ap-more">
                  <summary>Identifier</summary>
                  <div class="ap-more-body">
                    <Field label="Identifier" for="pw-profile-key" help="Used in exports and the API. Filled in from the name.">
                      <TextInput
                        id="pw-profile-key"
                        class="mono"
                        value={shownKey()}
                        onInput={(event) => {
                          setKeyEdited(true);
                          setKey(event.currentTarget.value);
                        }}
                      />
                    </Field>
                  </div>
                </details>
              </div>
            </section>
          </Match>
          <Match when={step() === 2}>
            <ToolsStep
              groups={catalog.groups()}
              loading={catalog.loading()}
              selections={selections}
              onSelect={(appKey, next) => setSelections(appKey, reconcile(next))}
              rules={rules()}
              onRules={setRules}
              newTools={newTools()}
              onNewTools={setNewTools}
            />
          </Match>
          <Match when={step() === 3}>
            <AssignStep
              draft={assign}
              onChange={(next) => setAssign(next)}
              profiles={profiles.data?.profiles ?? []}
              profileId={draftId()}
              agents={activeAgents(targets.agents.data)}
              projects={(targets.projects.data ?? []).filter((project) => !project.archivedAt).map((project) => ({ id: project.id, name: project.name }))}
              routines={(targets.routines.data ?? []).map((routine) => ({ id: routine.id, name: routine.title }))}
            />
          </Match>
        </Switch>

        <div class="card tl-footer">
          <Show when={step() >= 2}>
            <span class="cx-note">
              Allows <b>{count().allowed}</b> of {count().total} tools
            </span>
          </Show>
          <Show when={draftId()}>
            <Button size="compact" variant="quiet" disabled={busy()} onClick={saveAndLeave}>
              Save and finish later
            </Button>
          </Show>
          <span class="ap-actions-end">
            <Show
              when={step() > 1}
              fallback={
                <A class="btn btn--quiet" href={base()}>
                  Cancel
                </A>
              }
            >
              <Button disabled={busy()} onClick={() => setStep((value) => (value - 1) as WizardStep)}>
                Back
              </Button>
            </Show>
            <Switch>
              <Match when={step() === 1}>
                <Button variant="primary" disabled={!stepOneReady() || busy() || catalog.loading()} onClick={() => saveDraft.mutate({ next: 2, completed: 1, seed: seed() })}>
                  {busy() ? "Saving…" : "Continue"}
                </Button>
              </Match>
              <Match when={step() === 2}>
                <Button variant="primary" disabled={busy()} onClick={() => saveDraft.mutate({ next: 3, completed: 2 })}>
                  {busy() ? "Saving…" : "Continue"}
                </Button>
              </Match>
              <Match when={step() === 3}>
                <Button variant="primary" disabled={busy()} onClick={() => finish.mutate()}>
                  {busy() ? "Saving…" : "Save profile"}
                </Button>
              </Match>
            </Switch>
          </span>
        </div>
      </Show>
    </Show>
  );
}

/** Binds and unbinds to match the draft, undoing what was done if one fails. */
async function applyAssignments(companyId: string, profile: ToolProfileWithDetails, draft: AssignmentDraft) {
  const changes = assignmentChanges(companyId, profile.bindings, draft);
  const steps: { target: ProfileTarget; bind: boolean }[] = [
    ...changes.bind.map((target) => ({ target, bind: true })),
    ...changes.unbind.map((target) => ({ target, bind: false })),
  ];
  const done: typeof steps = [];
  for (const entry of steps) {
    try {
      if (entry.bind) await toolAccessApi.bindProfile(companyId, profile.id, entry.target);
      else await toolAccessApi.unbindProfile(companyId, profile.id, entry.target);
      done.push(entry);
    } catch (error) {
      const undone = await Promise.allSettled(
        done.reverse().map((prior) =>
          prior.bind ? toolAccessApi.unbindProfile(companyId, profile.id, prior.target) : toolAccessApi.bindProfile(companyId, profile.id, prior.target),
        ),
      );
      const failed = undone.filter((result) => result.status === "rejected").length;
      throw new Error(
        `Couldn't change the assignment to ${entry.target.targetType}${failed > 0 ? `, and ${failed} earlier ${failed === 1 ? "change" : "changes"} couldn't be undone` : ""}: ${failureText(error, "")}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Step 2

function ToolsStep(props: {
  groups: AppGroup[];
  loading: boolean;
  selections: Selections;
  onSelect: (appKey: string, next: Selections[string]) => void;
  rules: AdvancedRule[];
  onRules: (next: AdvancedRule[]) => void;
  newTools: ToolProfileDefaultAction;
  onNewTools: (next: ToolProfileDefaultAction) => void;
}) {
  const company = useCompany();
  const [query, setQuery] = createSignal("");
  const [capability, setCapability] = createSignal<ToolCapability | null>(null);
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    return props.groups
      .map((group) => ({
        group,
        tools: group.tools.filter(
          (tool) =>
            (!capability() || toolCapability(tool) === capability()) &&
            (!q || [tool.toolName, tool.title ?? "", group.name].join(" ").toLowerCase().includes(q)),
        ),
      }))
      .filter((entry) => entry.tools.length > 0);
  });
  return (
    <>
      <section class="card ap-card" aria-labelledby="pw-tools">
        <header class="chead">
          <h3 id="pw-tools" class="disp">
            Choose tools
          </h3>
          <p>Tick an app for all its tools, including ones it adds later; open it to leave some out, or to pick a few.</p>
        </header>
        <Switch>
          <Match when={props.loading}>
            <p class="ap-empty" role="status">
              Loading tools…
            </p>
          </Match>
          <Match when={props.groups.length === 0}>
            <p class="ap-empty">
              No connected app has tools yet. <A href={`/${company().issuePrefix}/apps`}>Connect an app</A>, then come back; you can save this as a draft meanwhile.
            </p>
          </Match>
          <Match when={true}>
            <div class="ap-filters">
              <label class="ap-search">
                <Search size={15} aria-hidden="true" />
                <TextInput type="search" placeholder="Find a tool" aria-label="Find a tool" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
              </label>
              <div class="ap-chips" role="group" aria-label="Capability">
                <For each={CAPABILITIES}>
                  {(entry) => (
                    <button type="button" class="ap-chip" aria-pressed={capability() === entry} onClick={() => setCapability((current) => (current === entry ? null : entry))}>
                      {CAPABILITY_LABEL[entry]}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="ap-empty">
                  <p>No tools match.</p>
                  <Button
                    size="compact"
                    variant="quiet"
                    onClick={() => {
                      setQuery("");
                      setCapability(null);
                    }}
                  >
                    Clear the search
                  </Button>
                </div>
              }
            >
              <For each={filtered()}>
                {(entry) => (
                  <AppTree
                    group={entry.group}
                    tools={entry.tools}
                    selection={props.selections[entry.group.appKey]}
                    onChange={(next) => props.onSelect(entry.group.appKey, next)}
                  />
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </section>
      <section class="card ap-card" aria-labelledby="pw-new-tools">
        <header class="chead">
          <h3 id="pw-new-tools" class="disp">
            Tools an app adds later
          </h3>
        </header>
        <div class="ap-card-body" role="radiogroup" aria-labelledby="pw-new-tools">
          <NewToolsChoice name="pw-new-tools" value={props.newTools} onChange={props.onNewTools} />
        </div>
      </section>
      <Rules rules={props.rules} onChange={props.onRules} />
    </>
  );
}

function AppTree(props: { group: AppGroup; tools: AppGroup["tools"]; selection: Selections[string] | undefined; onChange: (next: Selections[string]) => void }) {
  const [open, setOpen] = createSignal(false);
  const state = () => appCheckState(props.group, props.selection);
  const selected = createMemo(() => selectedToolIds(props.group, props.selection));
  let box!: HTMLInputElement;
  createEffect(() => {
    box.indeterminate = state() === "indeterminate";
  });
  return (
    <div class="tl-app">
      <div class="tl-app-head">
        <input
          ref={box}
          type="checkbox"
          aria-label={`All ${props.group.name} tools`}
          checked={state() === "checked"}
          onChange={() => props.onChange(toggleApp(props.group, props.selection))}
        />
        <button type="button" class="tl-app-toggle" aria-expanded={open()} onClick={() => setOpen((value) => !value)}>
          <ChevronRight size={14} aria-hidden="true" />
          <span class="ap-row-main">
            <span class="ap-row-name">
              All {props.group.name} tools ({props.group.tools.length})
            </span>
            <span class="ap-row-meta">
              {state() === "indeterminate" ? appSelectionLabel(props.group, props.selection) : state() === "checked" ? `Includes tools ${props.group.name} adds later` : "None selected"}
            </span>
          </span>
        </button>
      </div>
      <Show when={open()}>
        <ul class="tl-tools">
          <For each={props.tools}>
            {(tool) => (
              <li>
                <label class="tl-tool">
                  <input type="checkbox" checked={selected().has(tool.id)} onChange={() => props.onChange(toggleTool(props.group, props.selection, tool.id))} />
                  <span class="ap-row-main">
                    <span class="ap-row-name mono">{tool.toolName}</span>
                    <span class="ap-row-meta">
                      {CAPABILITY_LABEL[toolCapability(tool)]}
                      {tool.title || tool.description ? ` · ${tool.title || tool.description}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

const RISKS: ToolRiskLevel[] = ["read", "write", "destructive", "low", "medium", "high", "critical"];

function Rules(props: { rules: AdvancedRule[]; onChange: (next: AdvancedRule[]) => void }) {
  const [kind, setKind] = createSignal<RuleKind>("tool_name");
  const [value, setValue] = createSignal("");
  const [risk, setRisk] = createSignal<ToolRiskLevel>("destructive");
  const [effect, setEffect] = createSignal<"include" | "exclude">("include");
  const add = () => {
    const text = value().trim();
    if (kind() !== "risk_level" && !text) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now().toString(36)}`;
    props.onChange([
      ...props.rules,
      kind() === "risk_level" ? { id, kind: "risk_level", value: risk(), riskLevel: risk(), effect: effect() } : { id, kind: kind(), value: text, effect: effect() },
    ]);
    setValue("");
  };
  return (
    <section class="card ap-card" aria-labelledby="pw-rules">
      <header class="chead">
        <h3 id="pw-rules" class="disp">
          Rules (optional)
        </h3>
        <p>Match tools by a name pattern (with * wildcards), a risk level, or a tool's ID. They apply on top of the choices above.</p>
      </header>
      <div class="tl-form">
        <Show when={props.rules.length > 0}>
          <ul class="ap-rows">
            <Index each={props.rules}>
              {(rule) => (
                <li class="ap-row">
                  <span class="ap-row-main ap-row-name">{ruleSummary(rule())}</span>
                  <Button variant="icon" size="compact" aria-label={`Remove: ${ruleSummary(rule())}`} onClick={() => props.onChange(props.rules.filter((entry) => entry.id !== rule().id))}>
                    <X size={14} aria-hidden="true" />
                  </Button>
                </li>
              )}
            </Index>
          </ul>
        </Show>
        <div class="tl-rule-form">
            <select class="tl-select" aria-label="Allow or block" value={effect()} onChange={(event) => setEffect(event.currentTarget.value as "include" | "exclude")}>
              <option value="include">Allow</option>
              <option value="exclude">Block</option>
            </select>
            <select class="tl-select" aria-label="Match by" value={kind()} onChange={(event) => setKind(event.currentTarget.value as RuleKind)}>
              <For each={RULE_KINDS}>{(entry) => <option value={entry.value}>{entry.label}</option>}</For>
            </select>
            <Show
              when={kind() === "risk_level"}
              fallback={
                <TextInput
                  aria-label={kind() === "tool_name" ? "Name pattern" : "Tool ID"}
                  class="mono"
                  placeholder={kind() === "tool_name" ? "github.*" : "Tool ID"}
                  value={value()}
                  onInput={(event) => setValue(event.currentTarget.value)}
                />
              }
            >
              <select class="tl-select" aria-label="Risk level" value={risk()} onChange={(event) => setRisk(event.currentTarget.value as ToolRiskLevel)}>
                <For each={RISKS}>{(entry) => <option value={entry}>{entry}</option>}</For>
              </select>
            </Show>
            <Button size="compact" disabled={kind() !== "risk_level" && !value().trim()} onClick={add}>
              Add rule
            </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3

function AssignStep(props: {
  draft: AssignmentDraft;
  onChange: (next: AssignmentDraft) => void;
  profiles: ToolProfileWithDetails[];
  profileId: string | null;
  agents: Agent[];
  projects: { id: string; name: string }[];
  routines: { id: string; name: string }[];
}) {
  const others = createMemo(() => props.profiles.filter((profile) => profile.id !== props.profileId && profile.status !== "archived"));
  const defaultName = () => others().find((profile) => profile.summary.isCompanyDefault)?.name ?? null;
  const has = createMemo(() => {
    const map = new Map<string, string[]>();
    for (const profile of others()) {
      for (const binding of profile.bindings) {
        if (binding.targetType !== "agent") continue;
        map.set(binding.targetId, [...(map.get(binding.targetId) ?? []), profile.name]);
      }
    }
    return map;
  });
  const toggle = (field: "agentIds" | "projectIds" | "routineIds", id: string, on: boolean) => {
    const next = new Set(props.draft[field]);
    if (on) next.add(id);
    else next.delete(id);
    props.onChange({ ...props.draft, [field]: next });
  };
  const checklist = (field: "projectIds" | "routineIds", options: { id: string; name: string }[]) => (
    <ul class="cx-options">
      <For each={options}>
        {(option) => (
          <li>
            <label class="cx-option" classList={{ "cx-option--on": props.draft[field].has(option.id) }}>
              <input type="checkbox" checked={props.draft[field].has(option.id)} onChange={(event) => toggle(field, option.id, event.currentTarget.checked)} />
              <span class="cx-option-name">{option.name}</span>
            </label>
          </li>
        )}
      </For>
    </ul>
  );
  return (
    <section class="card ap-card" aria-labelledby="pw-assign">
      <header class="chead">
        <h3 id="pw-assign" class="disp">
          Assign
        </h3>
        <p>An agent with several profiles can use anything any of them allows.</p>
      </header>
      <div class="tl-form">
        <label class="tl-radio">
          <input type="checkbox" checked={props.draft.companyDefault} onChange={(event) => props.onChange({ ...props.draft, companyDefault: event.currentTarget.checked })} />
          <span>
            <b>Make this the organization default</b>
            Every agent without a profile of its own uses it.{defaultName() ? ` Replaces “${defaultName()}”.` : ""}
          </span>
        </label>
        <Field label="Agents">
          <Show when={props.agents.length > 0} fallback={<p class="cx-static">No agents yet.</p>}>
            <ul class="cx-options">
              <For each={props.agents}>
                {(agent) => {
                  const on = () => props.draft.agentIds.has(agent.id);
                  const note = () => {
                    const bits = [...(has().get(agent.id) ?? [])];
                    if (defaultName()) bits.push("the organization default");
                    return bits.length > 0 ? `has ${bits.join(", ")}` : "no profiles yet";
                  };
                  return (
                    <li>
                      <label class="cx-option" classList={{ "cx-option--on": on() }}>
                        <input type="checkbox" checked={on()} onChange={(event) => toggle("agentIds", agent.id, event.currentTarget.checked)} />
                        <AgentAvatar agent={agent} size={24} />
                        <span class="cx-option-name">{agent.name}</span>
                        <span class="cx-option-note">{note()}</span>
                      </label>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Field>
        <Show when={props.projects.length > 0 || props.routines.length > 0}>
          <details class="ap-more" open={props.draft.projectIds.size > 0 || props.draft.routineIds.size > 0}>
            <summary>Projects and recurring tasks</summary>
            <div class="ap-more-body tl-stack">
              <p class="cx-note">Give a whole project or a recurring task this profile, instead of (or as well as) single agents.</p>
              <Show when={props.projects.length > 0}>
                <Field label="Projects">{checklist("projectIds", props.projects)}</Field>
              </Show>
              <Show when={props.routines.length > 0}>
                <Field label="Recurring tasks">{checklist("routineIds", props.routines)}</Field>
              </Show>
            </div>
          </details>
        </Show>
      </div>
    </section>
  );
}
