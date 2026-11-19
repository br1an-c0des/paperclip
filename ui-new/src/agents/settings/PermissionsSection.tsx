import { resolveAgentAccess, type AgentDetail, type AgentPermissions } from "@paperclipai/shared";
import { A, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Check, ChevronRight, FolderOpen, Lock, Plus, ShieldAlert, X } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AgentPermissionUpdate } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { taskName, TaskPicker } from "@/tasks/TaskPicker";
import { Button, buttonClass } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { failure, refreshAgent, saveNote, SectionTitle, SwitchRow, useAgentSaver } from "../shared";
import { AccessCard } from "./AccessCard";
import { storedAccess } from "./access-model";
import { InteractionsCard } from "./InteractionsCard";
import {
  BOUNDARY_TYPES,
  boundaryEditable,
  boundaryHasScope,
  boundaryTarget,
  lowTrustBoundary,
  policyRows,
  TRUST_PRESETS,
  trustPreset,
  trustUpdate,
  withBoundaryTarget,
  withoutBoundaryTarget,
  withPreset,
  type BoundaryTarget,
} from "../trust-model";

/*
 * Permissions and trust (board 30's outline): the agent's access (level and actions, step 4a), its
 * trust preset, and its project access. Everything on the agent saves through
 * `PATCH /agents/:id/permissions`, always with the whole `access`, so the server never turns an old
 * flag into an override (api/agents.ts `AgentPermissionUpdate`). Project access is where the task
 * page's "can't access this project" notice links (`/agents/:key/permissions?fromTask=…`): a
 * low-trust agent reads only the projects in its boundary, and adding one keeps its other
 * restrictions (`POST /agents/:id/project-access`).
 *
 * The Access card (AccessCard.tsx) replaces the old Hire agents and Assign tasks switches, which
 * are its `agents:create` and `tasks:assign` rows now; the server answers 410 `agent_grant_retired`
 * to the old grants for them.
 *
 * The trust preset (trust-model.ts) saves at once. A low-trust agent's boundary takes one target
 * here (a project, a task and its subtasks, or one task), as upstream's community edition edits
 * it; "View policy" lists the rest of the boundary (agents, tools, secrets, where output is
 * promoted), which only the API or the EE extension sets.
 *
 * Below Trust, the Interactions card (U105, InteractionsCard.tsx) holds the deny-only switches the
 * access actions didn't absorb: the five for what other agents may do to this one, and commenting
 * and mentioning. They save through their own route; the `/permissions` body here never carries
 * `interactions`, which that route refuses.
 */

export function PermissionsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const saver = useAgentSaver(() => props.agent);
  const current = (): AgentPermissionUpdate => ({
    canCreateSkills: props.agent.permissions?.canCreateSkills !== false,
    access: storedAccess(props.agent.permissions),
  });
  const canHire = () => resolveAgentAccess(storedAccess(props.agent.permissions))["agents:create"] !== false;
  const change = (patch: AgentPermissionUpdate) =>
    void saver.run(async () => {
      const saved = await agentsApi.updatePermissions(props.agent.id, { ...current(), ...patch }, company().id);
      client.setQueryData(queryKeys.agents.detail(props.agent.id), saved);
    }, "Couldn't change the permission.");
  const saveTrust = (next: Partial<AgentPermissions>) =>
    void saver.run(async () => {
      const saved = await agentsApi.updatePermissions(props.agent.id, trustUpdate(current(), next), company().id);
      client.setQueryData(queryKeys.agents.detail(props.agent.id), saved);
      await client.invalidateQueries({ queryKey: queryKeys.agents.projectAccess(props.agent.id) });
    }, "Couldn't change the trust settings.");

  return (
    <>
      <SectionTitle
        title="Permissions and trust"
        info={`What ${props.agent.name} may do without asking, which projects it can reach, and how it deals with other agents.`}
      />
      <AccessCard agent={props.agent} />
      <ProjectAccessCard agent={props.agent} />
      <SettingsCard
        title="Trust"
        info="Changes save at once."
        description={saveNote(saver.state(), saver.error())}
      >
        <TrustRows agent={props.agent} canHire={canHire()} disabled={saver.state() === "saving"} onChange={saveTrust} />
        {/* `permissions.canCreateSkills` is saved and logged, but no route reads it: the company
            skill policy and `skills:create` grants decide (server routes/company-skills.ts). */}
        <SwitchRow
          label="Create skills"
          info="Meant to let it install, import, create and scan the company's skills. Today the company's skill policy decides that."
          help="Not used by the server yet."
          checked={current().canCreateSkills !== false}
          disabled={saver.state() === "saving"}
          onChange={(value) => change({ canCreateSkills: value })}
        />
      </SettingsCard>
      <InteractionsCard agent={props.agent} />
    </>
  );
}

/** The projects a low-trust agent may read, and adding more. */
function ProjectAccessCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [params] = useSearchParams<{ fromTask?: string }>();
  const projects = useProjectsQuery();
  const access = createQuery(() => ({
    queryKey: queryKeys.agents.projectAccess(props.agent.id),
    queryFn: ({ signal }) => agentsApi.projectAccess(props.agent.id, signal),
    retry: false,
  }));
  const [added, setAdded] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  const allowed = () => access.data?.projectIds ?? [];
  const pending = createMemo(() => added().filter((id) => !allowed().includes(id)));
  const name = (id: string) => (projects.data ?? []).find((project) => project.id === id)?.name ?? "A project you can't see";
  const lowTrust = () => props.agent.permissions?.trustPreset === "low_trust_review";
  const fromTask = () => (typeof params.fromTask === "string" && params.fromTask ? params.fromTask : null);

  const save = async () => {
    if (!pending().length) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await agentsApi.addProjectAccess(props.agent.id, pending());
      client.setQueryData(queryKeys.agents.projectAccess(props.agent.id), next);
      setAdded([]);
      setSaved(true);
      await Promise.all([refreshAgent(client, company().id, props.agent.id), client.invalidateQueries({ queryKey: ["issues"] })]);
      pushToast({ tone: "success", title: "Saved project access" });
    } catch (caught) {
      setError(failure(caught, "Couldn't save project access."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="project-access" class="ag-anchor">
      <SettingsCard
        title="Project access"
        info={lowTrust() ? `Projects whose tasks and repositories ${props.agent.name} may reach.` : undefined}
        description={lowTrust() ? undefined : `${props.agent.name} has standard trust, so no project list limits it.`}
        footer={
          fromTask() || pending().length > 0 ? (
            <>
              <Show when={fromTask()}>
                {(task) => (
                  <A class={buttonClass({ size: "compact", variant: saved() ? "primary" : "secondary" })} href={`/${company().issuePrefix}/issues/${task()}`}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    {saved() ? "Return to the task and retry" : "Return to the task"}
                  </A>
                )}
              </Show>
              <Show when={pending().length > 0}>
                <span class="ps-foot-end">
                  <Show when={error()}>
                    <span class="nt-error" role="alert">
                      {error()}
                    </span>
                  </Show>
                  <Button size="compact" variant="quiet" disabled={saving()} onClick={() => setAdded([])}>
                    Cancel
                  </Button>
                  <Button size="compact" variant="primary" disabled={saving()} onClick={() => void save()}>
                    {saving() ? "Saving…" : "Save project access"}
                  </Button>
                </span>
              </Show>
            </>
          ) : undefined
        }
      >
        <Show when={access.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load project access. {failure(access.error, "")}
          </p>
        </Show>
        <Show when={lowTrust()}>
          <ul class="ps-list">
            <For each={[...allowed(), ...pending()]} fallback={<li class="ps-list-note">No projects allowed yet.</li>}>
              {(id) => (
                <li class="ps-list-row">
                  <FolderOpen size={14} aria-hidden="true" />
                  <span class="ps-list-name">{name(id)}</span>
                  <Show
                    when={allowed().includes(id)}
                    fallback={
                      <>
                        <span class="ps-list-meta">To add</span>
                        <button type="button" class="nt-icon nt-icon--small" aria-label={`Don't add ${name(id)}`} onClick={() => setAdded((list) => list.filter((entry) => entry !== id))}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      </>
                    }
                  >
                    <span class="ps-list-meta ag-ok">
                      <Check size={13} aria-hidden="true" /> Allowed
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={pending().length > 0}>
            <p class="fhelp">
              {props.agent.name} will reach work and repositories in {pending().map(name).join(", ")}. Its other low-trust restrictions stay.
            </p>
          </Show>
          <Show when={access.data?.canManage} fallback={<Show when={access.isSuccess}><p class="fhelp">Someone who can manage agents can add projects here.</p></Show>}>
            <Menu>
              <Menu.Trigger as={Button} size="compact" icon={<Plus size={14} aria-hidden="true" />}>
                Add project
              </Menu.Trigger>
              <Menu.Content label="Add a project" width={300}>
                <For each={projects.data ?? []} fallback={<p class="nt-menu-note">No projects.</p>}>
                  {(project) => (
                    <Menu.CheckboxItem
                      checked={allowed().includes(project.id) || pending().includes(project.id)}
                      disabled={allowed().includes(project.id)}
                      description={allowed().includes(project.id) ? "Already allowed" : undefined}
                      onChange={(checked) => {
                        setSaved(false);
                        setAdded((list) => (checked ? [...new Set([...list, project.id])] : list.filter((entry) => entry !== project.id)));
                      }}
                    >
                      {project.name}
                    </Menu.CheckboxItem>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </Show>
        </Show>
      </SettingsCard>
    </section>
  );
}

/** The trust preset, and for a low-trust agent its containment and one boundary target. */
function TrustRows(props: { agent: AgentDetail; canHire: boolean; disabled: boolean; onChange: (next: Partial<AgentPermissions>) => void }) {
  const company = useCompany();
  const projects = useProjectsQuery();
  const permissions = () => props.agent.permissions as Partial<AgentPermissions> | undefined;
  const preset = () => trustPreset(permissions());
  const lowTrust = () => preset() === "low_trust_review";
  const boundary = createMemo(() => lowTrustBoundary(permissions()));
  const target = createMemo(() => boundaryTarget(boundary()));
  const [targetType, setTargetType] = createSignal<BoundaryTarget["type"] | null>(null);
  const type = () => targetType() ?? target()?.type ?? "project";
  const [taskOpen, setTaskOpen] = createSignal(false);
  // A project boundary with several projects is the project access list's (above).
  const singleEditor = () => boundaryEditable(boundary()) && (boundary()?.projectIds?.length ?? 0) <= 1;
  const issueTargetId = () => {
    const found = target();
    return found && found.type !== "project" ? found.id : null;
  };
  const issue = createQuery(() => ({
    queryKey: queryKeys.issues.detail(issueTargetId() ?? "none"),
    queryFn: ({ signal }) => issuesApi.get(issueTargetId()!, signal),
    enabled: !!issueTargetId(),
    retry: false,
  }));
  const projectName = (id: string) => (projects.data ?? []).find((project) => project.id === id)?.name ?? "A project you can't see";
  const targetName = (found: BoundaryTarget) =>
    found.type === "project" ? projectName(found.id) : issue.data?.id === found.id ? `${taskName(issue.data)} · ${issue.data.title}` : `Task ${found.id.slice(0, 8)}`;
  const pick = (next: BoundaryTarget) => props.onChange(withBoundaryTarget(permissions(), company().id, next));

  return (
    <>
      <SettingsRow
        label="Trust preset"
        info="How broadly it may read and act on the organization's work. Standard works across the organization within its permissions; low trust is contained for untrusted input such as pull request review, with output quarantined until someone trusted promotes it."
      >
        <div class="ps-stack">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" disabled={props.disabled} aria-label={`Trust preset: ${TRUST_PRESETS.find((entry) => entry.value === preset())!.label}`}>
              {TRUST_PRESETS.find((entry) => entry.value === preset())!.label}
            </Menu.Trigger>
            <Menu.Content label="Trust preset" width={340}>
              <For each={TRUST_PRESETS}>
                {(entry) => (
                  <Menu.Item
                    description={entry.description}
                    hint={entry.value === preset() ? <Check size={14} /> : undefined}
                    onSelect={() => entry.value !== preset() && props.onChange(withPreset(permissions(), entry.value))}
                  >
                    {entry.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
          <Show when={!lowTrust() && props.canHire}>
            <span class="fhelp">Choosing low trust also takes away hiring.</span>
          </Show>
        </div>
      </SettingsRow>
      <Show when={lowTrust()}>
        <SettingsRow label="Boundary" info="What it may read and change. Without one, every request is denied.">
          <div class="ps-stack ag-trust">
            <div class="ag-trust-state" data-tone={boundaryHasScope(boundary()) ? "amber" : "red"} role={boundaryHasScope(boundary()) ? "status" : "alert"}>
              <Show when={boundaryHasScope(boundary())} fallback={<Lock size={14} aria-hidden="true" />}>
                <ShieldAlert size={14} aria-hidden="true" />
              </Show>
              <span>
                <Show when={boundaryHasScope(boundary())} fallback={<><b>No boundary yet</b> Pick a project or a task below before it can run without being denied.</>}>
                  <b>Contained</b>
                  <InfoTip label="About Contained">
                    It reads and changes only the work inside its boundary. Its raw output stays quarantined from agents with more trust until a trusted reviewer promotes it.
                  </InfoTip>
                </Show>
              </span>
            </div>
            <Show
              when={singleEditor()}
              fallback={
                <span class="fhelp">
                  {boundary() && !boundaryEditable(boundary())
                    ? "This boundary has several targets, set through the API or the EE permissions extension, so it can't be edited here."
                    : "Its boundary is the projects under Project access, above."}
                </span>
              }
            >
              <div class="ps-inline">
                <Menu>
                  <Menu.Trigger as={FieldButton} class="ps-field-220" disabled={props.disabled} aria-label={`Boundary type: ${BOUNDARY_TYPES.find((entry) => entry.value === type())!.label}`}>
                    {BOUNDARY_TYPES.find((entry) => entry.value === type())!.label}
                  </Menu.Trigger>
                  <Menu.Content label="Boundary type" width={260}>
                    <For each={BOUNDARY_TYPES}>
                      {(entry) => (
                        <Menu.Item description={entry.description} hint={entry.value === type() ? <Check size={14} /> : undefined} onSelect={() => setTargetType(entry.value)}>
                          {entry.label}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Content>
                </Menu>
                <Show
                  when={type() === "project"}
                  fallback={
                    <Popover open={taskOpen()} onOpenChange={setTaskOpen}>
                      <Popover.Trigger as={FieldButton} class="ps-field-320" disabled={props.disabled} aria-label="Boundary task">
                        {target() && target()!.type === type() ? targetName(target()!) : "Pick a task"}
                      </Popover.Trigger>
                      <Popover.Content label="Boundary task" width={420} hideClose>
                        <TaskPicker
                          label="Boundary task"
                          selected={target() && target()!.type === type() ? [target()!.id] : []}
                          onPick={(picked) => {
                            setTaskOpen(false);
                            pick({ type: type(), id: picked.id });
                          }}
                        />
                      </Popover.Content>
                    </Popover>
                  }
                >
                  <Menu>
                    <Menu.Trigger as={FieldButton} class="ps-field-320" disabled={props.disabled} icon={<FolderOpen size={14} aria-hidden="true" />} aria-label="Boundary project">
                      {target()?.type === "project" ? projectName(target()!.id) : "Pick a project"}
                    </Menu.Trigger>
                    <Menu.Content label="Boundary project" width={300}>
                      <For each={projects.data ?? []} fallback={<p class="nt-menu-note">No projects.</p>}>
                        {(project) => (
                          <Menu.Item hint={target()?.type === "project" && target()!.id === project.id ? <Check size={14} /> : undefined} onSelect={() => pick({ type: "project", id: project.id })}>
                            {project.name}
                          </Menu.Item>
                        )}
                      </For>
                    </Menu.Content>
                  </Menu>
                </Show>
                <Show when={target()}>
                  <Button size="compact" variant="quiet" disabled={props.disabled} onClick={() => props.onChange(withoutBoundaryTarget(permissions()))}>
                    Clear
                  </Button>
                </Show>
              </div>
            </Show>
            <details class="ag-policy">
              <summary>
                <span class="ag-rot" aria-hidden="true">
                  <ChevronRight size={14} />
                </span>
                View policy
              </summary>
              <dl>
                <For each={policyRows(permissions(), targetName)}>
                  {(row) => (
                    <>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            </details>
          </div>
        </SettingsRow>
      </Show>
    </>
  );
}
