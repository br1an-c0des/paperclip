import type { AgentDetail } from "@paperclipai/shared";
import { A, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Check, FolderOpen, Plus, X } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AgentPermissionUpdate } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { Button, buttonClass } from "@/ui/Button";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { taskAssignHelp } from "../agent-model";
import { CardNote, failure, refreshAgent, SectionTitle, SwitchRow, useAgentSaver } from "../shared";

/*
 * Permissions and trust (board 30's outline): the agent's trust preset, what it may do without
 * asking (`PATCH /agents/:id/permissions`, which takes all three switches together), and its project
 * access. Project access is where the task page's "can't access this project" notice links
 * (`/agents/:key/permissions?fromTask=…`): a low-trust agent reads only the projects in its
 * boundary, and adding one keeps its other restrictions (`POST /agents/:id/project-access`).
 *
 * Changing the trust preset and editing the rest of the low-trust boundary (tasks, agents, tools,
 * secrets) stay in the old UI for now.
 */

export function PermissionsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const saver = useAgentSaver(() => props.agent);
  const lowTrust = () => props.agent.permissions?.trustPreset === "low_trust_review";
  const current = (): AgentPermissionUpdate => ({
    canCreateAgents: Boolean(props.agent.permissions?.canCreateAgents),
    canCreateSkills: props.agent.permissions?.canCreateSkills !== false,
    canAssignTasks: Boolean(props.agent.access?.canAssignTasks),
  });
  const assignLocked = () => props.agent.role === "ceo" || current().canCreateAgents;
  const change = (patch: Partial<AgentPermissionUpdate>) => {
    const next = { ...current(), ...patch };
    // Hiring authority brings task assignment with it, as the old UI sets it.
    if (patch.canCreateAgents) next.canAssignTasks = true;
    void saver.run(async () => {
      const saved = await agentsApi.updatePermissions(props.agent.id, next, company().id);
      client.setQueryData(queryKeys.agents.detail(props.agent.id), saved);
    }, "Couldn't change the permission.");
  };

  return (
    <>
      <SectionTitle title="Permissions and trust">What {props.agent.name} may do without asking, and which projects it can reach.</SectionTitle>
      <ProjectAccessCard agent={props.agent} />
      <SettingsCard
        title="Trust"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            Changes save at once.
          </CardNote>
        }
      >
        <SettingsRow label="Trust preset" help="Changing it is in the classic UI for now.">
          <div class="ps-stack">
            <TonePill tone={lowTrust() ? "amber" : "green"} compact>
              {lowTrust() ? "Low trust, with review" : "Standard"}
            </TonePill>
            <span class="fhelp">
              {lowTrust()
                ? "Its work is reviewed, and it reaches only the projects, tasks, agents, tools and secrets in its boundary."
                : "It can work across the company within its permissions."}
            </span>
          </div>
        </SettingsRow>
        <SwitchRow label="Hire agents" help="Create or hire agents. This also lets it assign tasks." checked={current().canCreateAgents} disabled={saver.state() === "saving"} onChange={(value) => change({ canCreateAgents: value })} />
        <SwitchRow label="Create skills" help="Install, import, create and scan the company's skills." checked={current().canCreateSkills} disabled={saver.state() === "saving"} onChange={(value) => change({ canCreateSkills: value })} />
        <SwitchRow
          label="Assign tasks"
          help={taskAssignHelp(props.agent.access?.taskAssignSource ?? "none")}
          checked={current().canAssignTasks}
          disabled={saver.state() === "saving" || assignLocked()}
          onChange={(value) => change({ canAssignTasks: value })}
        />
      </SettingsCard>
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
        description={lowTrust() ? `Projects whose tasks and repositories ${props.agent.name} may reach.` : `${props.agent.name} has standard trust, so no project list limits it.`}
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
        <Show when={lowTrust()} fallback={<p class="ps-list-note">Project access lists only apply to agents with low trust, under Trust below.</p>}>
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
