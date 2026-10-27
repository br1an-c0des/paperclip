import type { Project, ProjectRepository, ProjectWorkspace, WorkspaceRuntimeService } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Book, Check, FolderOpen, Lock, Plus, Search, X } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { environmentsApi } from "@/api/environments";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  checkoutDirty,
  checkoutDraft,
  checkoutPolicy,
  CONCURRENCY_OPTIONS,
  legacyRepositories,
  localFolderRequest,
  newWorkspacePayload,
  sameIds,
  savedRepositories,
  workspaceDraft,
  workspacePatch,
  workspaceProblem,
  type CheckoutDraft,
  type WorkspaceDraft,
} from "./settings-model";
import { CardNote, failure, FootError, refreshProject, useProjectSaver, useSaveRunner } from "./shared";

/*
 * Code and workspaces (board 11): the project's repositories and local folder, its workspaces with
 * their runtime services, and how tasks get their own checkout.
 *
 * - Repositories are the company's connected GitHub repositories (`PUT /projects/:id/repositories`,
 *   the first is the primary). Ones added by URL before the connection existed are listed and edited
 *   as workspaces. The local folder is the primary workspace's folder, as in the old UI.
 * - Workspaces (`/projects/:id/workspaces`): add, edit, remove, make one the default (primary), and
 *   start, stop or restart their services. A workspace's runtime command JSON stays in the old UI.
 * - Task checkouts follow the instance's `enableIsolatedWorkspaces` (decision 12), and the folder
 *   paths hide under `enableManagedSandboxOnly`, as the old UI does.
 */

export function CodeSection(props: { project: Project }) {
  const experimental = useExperimentalSettingsQuery();
  // Unknown counts as managed, so a failed read never shows host paths the policy hides.
  const hideHostPaths = () => experimental.data === undefined || experimental.data.enableManagedSandboxOnly === true;
  return (
    <>
      <RepositoriesCard project={props.project} hideHostPaths={hideHostPaths()} />
      <WorkspacesCard project={props.project} hideHostPaths={hideHostPaths()} />
      <CheckoutsCard project={props.project} isolatedEnabled={experimental.data?.enableIsolatedWorkspaces === true} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function RepositoriesCard(props: { project: Project; hideHostPaths: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const saved = createMemo(() => savedRepositories(props.project));
  const [draft, setDraft] = createSignal<string[] | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const ids = () => draft() ?? saved().map((repo) => repo.id);
  const dirty = () => draft() !== null && !sameIds(draft()!, saved().map((repo) => repo.id));
  const options = createQuery(() => ({
    queryKey: queryKeys.projectRepositories(company().id),
    queryFn: ({ signal }) => projectsApi.repositoryOptions(company().id, signal),
    staleTime: 30_000,
  }));
  const byId = createMemo(() => new Map((options.data?.repositories ?? []).map((repo) => [repo.id, repo] as const)));
  const nameOf = (id: string) => saved().find((repo) => repo.id === id)?.fullName ?? byId().get(id)?.fullName ?? `Repository ${id}`;
  const legacy = createMemo(() => legacyRepositories(props.project));

  const save = createMutation(() => ({
    mutationFn: (repositoryIds: string[]) => projectsApi.setRepositories(props.project.id, repositoryIds),
    onSuccess: async () => {
      await refreshProject(client, company().id);
      batch(() => {
        setDraft(null);
        setProblem(null);
      });
      pushToast({ tone: "success", title: "Saved the repositories" });
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't save the repositories.")),
  }));
  const change = (next: string[]) => {
    setProblem(null);
    setDraft(next);
  };

  return (
    <SettingsCard
      title="Repositories"
      description="Where the project's code comes from. Skills in a repository are imported too."
      footer={
        <>
          <RepositoryPicker selected={ids()} options={options} onToggle={(id) => change(ids().includes(id) ? ids().filter((entry) => entry !== id) : [...ids(), id])} />
          <Show when={dirty()}>
            <span class="ps-foot-end">
              <FootError message={problem()} />
              <Button size="compact" variant="quiet" disabled={save.isPending} onClick={() => change(saved().map((repo) => repo.id))}>
                Discard
              </Button>
              <Button size="compact" variant="primary" disabled={save.isPending} onClick={() => save.mutate(ids())}>
                {save.isPending ? "Saving…" : "Save repositories"}
              </Button>
            </span>
          </Show>
          <Show when={!dirty()}>
            <FootError message={problem()} />
          </Show>
        </>
      }
    >
      <Show when={ids().length > 0 || legacy().length > 0} fallback={<p class="ps-list-note">No repositories. Agents work in the project's folder.</p>}>
        <ul class="ps-repos" aria-label="Repositories for this project">
          <For each={ids()}>
            {(id, index) => (
              <li class="ps-repo">
                <Book size={15} aria-hidden="true" />
                <span class="mono ps-repo-name">{nameOf(id)}</span>
                <Show when={index() === 0}>
                  <span class="np-primary">primary</span>
                </Show>
                <Show when={byId().get(id)?.private}>
                  <Lock size={12} aria-label="Private repository" />
                </Show>
                <span class="ps-repo-actions">
                  <Show when={index() > 0}>
                    <Button size="compact" variant="quiet" onClick={() => change([id, ...ids().filter((entry) => entry !== id)])}>
                      Make primary
                    </Button>
                  </Show>
                  <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${nameOf(id)}`} onClick={() => change(ids().filter((entry) => entry !== id))}>
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              </li>
            )}
          </For>
          <For each={legacy()}>
            {(workspace) => (
              <li class="ps-repo">
                <Book size={15} aria-hidden="true" />
                <a class="mono ps-repo-name" href={workspace.repoUrl!} target="_blank" rel="noreferrer">
                  {workspace.repoUrl}
                </a>
                <span class="ps-chip">added by URL</span>
                <span class="ps-repo-actions ps-muted-line">Edit it under Workspaces</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={options.data?.failedConnectionCount}>
        <p class="ps-list-note">Some GitHub connections couldn't load. Reconnect them under Apps.</p>
      </Show>
      <LocalFolder project={props.project} hideHostPaths={props.hideHostPaths} />
    </SettingsCard>
  );
}

function RepositoryPicker(props: {
  selected: string[];
  options: { data?: { repositories: ProjectRepository[]; connectionCount: number }; isPending: boolean; isError: boolean; refetch: () => unknown };
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => {
    const terms = query().toLowerCase().split(/\s+/).filter(Boolean);
    return (props.options.data?.repositories ?? []).filter((repo) => terms.every((term) => `${repo.fullName} ${repo.connections.join(" ")}`.toLowerCase().includes(term)));
  });
  return (
    <Show
      when={props.options.data?.connectionCount !== 0}
      fallback={<span class="ps-muted-line">No GitHub account is connected to this company. Connect one under Apps to add repositories.</span>}
    >
      <Popover open={open()} onOpenChange={setOpen} placement="top-start">
        <Popover.Trigger class="btn btn--secondary btn--compact">
          <Plus size={14} aria-hidden="true" />
          Add repository
        </Popover.Trigger>
        <Popover.Content label="Connected repositories" width={380} hideClose class="np-repo-pop">
          <div class="np-repo-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" aria-label="Find a repository" placeholder="Search repositories" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} autofocus />
          </div>
          <div class="np-repo-list" role="listbox" aria-label="Connected repositories" aria-multiselectable="true">
            <Switch>
              <Match when={props.options.isPending}>
                <p class="nt-menu-note">Loading repositories…</p>
              </Match>
              <Match when={props.options.isError}>
                <p class="nt-menu-note">
                  Couldn't load the repositories.{" "}
                  <button type="button" class="np-link" onClick={() => void props.options.refetch()}>
                    Try again
                  </button>
                </p>
              </Match>
              <Match when={matches().length === 0}>
                <p class="nt-menu-note">{query() ? "No repository matches." : "The connected accounts have no repositories."}</p>
              </Match>
              <Match when={true}>
                <For each={matches()}>
                  {(repo) => (
                    <button type="button" class="nt-option" role="option" aria-selected={props.selected.includes(repo.id)} onClick={() => props.onToggle(repo.id)}>
                      <span class="np-check" aria-hidden="true">
                        <Show when={props.selected.includes(repo.id)}>
                          <Check size={11} stroke-width={3} />
                        </Show>
                      </span>
                      <span class="nt-option-label mono">{repo.fullName}</span>
                      <Show when={repo.connections.length > 0}>
                        <span class="nt-option-state">{repo.connections.join(" · ")}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </Match>
            </Switch>
          </div>
        </Popover.Content>
      </Popover>
    </Show>
  );
}

/** The folder on the server agents write code in: the primary workspace's folder, or one Paperclip manages. */
function LocalFolder(props: { project: Project; hideHostPaths: boolean }) {
  const saver = useSaveRunner();
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  const codebase = () => props.project.codebase;

  const submit = async (draft: string) => {
    const request = localFolderRequest(props.project, draft);
    if (request.kind === "problem") return setProblem(request.message);
    setProblem(null);
    if (request.kind === "none") return setEditing(false);
    const ok = await saver.run(() => {
      if (request.kind === "create") return projectsApi.createWorkspace(props.project.id, request.data);
      if (request.kind === "update") return projectsApi.updateWorkspace(props.project.id, request.workspaceId, request.data);
      return projectsApi.removeWorkspace(props.project.id, request.workspaceId);
    }, "Couldn't save the folder.");
    if (ok) setEditing(false);
    else setProblem(saver.error());
  };

  return (
    <div class="ps-subrow">
      <SettingsRow label="Local folder" help={props.hideHostPaths ? "Agents check the code out in the platform's managed environment." : "Where agents write code on the server."}>
        <Show
          when={!props.hideHostPaths}
          fallback={<span class="ps-muted-line">{codebase()?.origin === "managed_checkout" ? "A folder Paperclip manages." : "Set by the project's workspace."}</span>}
        >
          <Show
            when={editing()}
            fallback={
              <div class="ps-inline ps-inline--spread">
                <span class="ps-folder">
                  <FolderOpen size={15} aria-hidden="true" />
                  <span class="mono">{codebase()?.effectiveLocalFolder ?? "None"}</span>
                  <Show when={codebase()?.origin === "managed_checkout"}>
                    <span class="ps-chip">managed by Paperclip</span>
                  </Show>
                </span>
                <span class="ps-inline">
                  <Button
                    size="compact"
                    onClick={() => {
                      setValue(codebase()?.localFolder ?? "");
                      setProblem(null);
                      setEditing(true);
                    }}
                  >
                    {codebase()?.localFolder ? "Change folder" : "Use a local folder"}
                  </Button>
                  <Show when={codebase()?.localFolder}>
                    <Button size="compact" variant="quiet" disabled={saver.state() === "saving"} onClick={() => void submit("")}>
                      Clear
                    </Button>
                  </Show>
                </span>
              </div>
            }
          >
            <form
              class="ps-inline"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(value());
              }}
            >
              <TextInput class="mono ps-grow" aria-label="Folder on the server" placeholder="/home/you/code/project" spellcheck={false} value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
              <Button size="compact" variant="quiet" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="compact" variant="primary" type="submit" disabled={saver.state() === "saving"}>
                Save folder
              </Button>
            </form>
          </Show>
          <Show when={problem()}>
            <span class="field-error" role="alert">
              {problem()}
            </span>
          </Show>
        </Show>
      </SettingsRow>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function WorkspacesCard(props: { project: Project; hideHostPaths: boolean }) {
  const saver = useSaveRunner();
  const [editing, setEditing] = createSignal<string | "new" | null>(null);
  const [removing, setRemoving] = createSignal<ProjectWorkspace | null>(null);
  const workspaces = () => props.project.workspaces ?? [];

  const create = async (draft: WorkspaceDraft) => {
    if (await saver.run(() => projectsApi.createWorkspace(props.project.id, newWorkspacePayload(draft)), "Couldn't add the workspace.")) setEditing(null);
  };
  const update = async (workspace: ProjectWorkspace, draft: WorkspaceDraft) => {
    const patch = workspacePatch(workspace, draft);
    if (!patch) return setEditing(null);
    if (await saver.run(() => projectsApi.updateWorkspace(props.project.id, workspace.id, patch), "Couldn't save the workspace.")) setEditing(null);
  };
  const makePrimary = (workspace: ProjectWorkspace) =>
    void saver.run(() => projectsApi.updateWorkspace(props.project.id, workspace.id, { isPrimary: true }), "Couldn't make it the default.");
  const remove = async (workspace: ProjectWorkspace) => {
    setRemoving(null);
    if (await saver.run(() => projectsApi.removeWorkspace(props.project.id, workspace.id), "Couldn't remove the workspace.")) {
      pushToast({ tone: "success", title: `Removed ${workspace.name}` });
    }
  };

  return (
    <>
      <SettingsCard
        title="Project workspaces"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            The checkouts agents work in, and the services they can run. The primary one is the default.
          </CardNote>
        }
        footer={
          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} disabled={editing() === "new"} onClick={() => setEditing("new")}>
            Add workspace
          </Button>
        }
      >
        <div class="ps-workspaces">
          <For each={workspaces()}>
            {(workspace) => (
              <Show
                when={editing() === workspace.id}
                fallback={
                  <WorkspaceRow
                    project={props.project}
                    workspace={workspace}
                    hideHostPaths={props.hideHostPaths}
                    onEdit={() => setEditing(workspace.id)}
                    onPrimary={() => makePrimary(workspace)}
                    onRemove={() => setRemoving(workspace)}
                  />
                }
              >
                <WorkspaceForm initial={workspaceDraft(workspace)} hideHostPaths={props.hideHostPaths} busy={saver.state() === "saving"} submitLabel="Save workspace" onCancel={() => setEditing(null)} onSubmit={(draft) => void update(workspace, draft)} />
              </Show>
            )}
          </For>
          <Show when={editing() === "new"}>
            <WorkspaceForm initial={workspaceDraft()} hideHostPaths={props.hideHostPaths} busy={saver.state() === "saving"} submitLabel="Add workspace" onCancel={() => setEditing(null)} onSubmit={(draft) => void create(draft)} />
          </Show>
          <Show when={workspaces().length === 0 && editing() !== "new"}>
            <p class="ps-list-note">No workspaces. Agents work in the folder Paperclip manages for the project.</p>
          </Show>
        </div>
      </SettingsCard>
      <Dialog
        open={removing() !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing()?.name ?? "the workspace"}?`}
        width={460}
        description="Agents stop using it for new work. The folder and repository themselves aren't deleted."
        footer={
          <>
            <Button variant="quiet" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void remove(removing()!)}>
              Remove workspace
            </Button>
          </>
        }
      />
    </>
  );
}

const SERVICE_GRADIENT: Record<WorkspaceRuntimeService["status"], "lagoon" | "ion" | "flare" | "ash"> = {
  running: "lagoon",
  starting: "ion",
  provisioning: "ion",
  failed: "flare",
  stopped: "ash",
};

function WorkspaceRow(props: { project: Project; workspace: ProjectWorkspace; hideHostPaths: boolean; onEdit: () => void; onPrimary: () => void; onRemove: () => void }) {
  const client = useQueryClient();
  const company = useCompany();
  const [problem, setProblem] = createSignal<string | null>(null);
  const control = createMutation(() => ({
    mutationFn: (input: { action: "start" | "stop" | "restart"; serviceId?: string }) =>
      projectsApi.controlRuntimeServices(props.project.id, props.workspace.id, input.action, input.serviceId),
    onSuccess: () => {
      setProblem(null);
      void refreshProject(client, company().id);
      void client.invalidateQueries({ queryKey: queryKeys.workspaceOverview(company().id, props.project.id) });
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't change the service.")),
  }));
  const services = () => props.workspace.runtimeServices ?? [];
  const hasRuntime = () => Boolean(props.workspace.runtimeConfig?.workspaceRuntime);
  const ref = () => props.workspace.repoRef ?? props.workspace.defaultRef;

  return (
    <div class="ps-workspace">
      <div class="ps-inline ps-workspace-head">
        <span class="ps-workspace-name">{props.workspace.name}</span>
        <Show when={props.workspace.isPrimary}>
          <span class="np-primary">primary</span>
        </Show>
        <Show when={!props.hideHostPaths && props.workspace.cwd}>
          <span class="mono ps-path">{props.workspace.cwd}</span>
        </Show>
        <Show when={ref()}>
          <span class="ps-chip mono">{ref()}</span>
        </Show>
        <span class="ps-repo-actions">
          <Show when={!props.workspace.isPrimary}>
            <Button size="compact" variant="quiet" onClick={() => props.onPrimary()}>
              Make primary
            </Button>
          </Show>
          <Button size="compact" onClick={() => props.onEdit()}>
            Edit
          </Button>
          <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${props.workspace.name}`} onClick={() => props.onRemove()}>
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
      <Show when={props.workspace.repoUrl}>
        <a class="mono ps-path" href={props.workspace.repoUrl!} target="_blank" rel="noreferrer">
          {props.workspace.repoUrl}
        </a>
      </Show>
      <Show when={services().length > 0 || hasRuntime()}>
        <div class="ps-list">
          <For each={services()}>
            {(service) => (
              <div class="ps-list-row">
                <Capsule gradient={SERVICE_GRADIENT[service.status]} size="tiny" live={service.status === "running"} />
                <span class="ps-list-name">{service.serviceName}</span>
                <Show when={service.url} fallback={<span class="mono ps-list-meta">{service.command ?? ""}</span>}>
                  <a class="mono ps-list-meta" href={service.url!} target="_blank" rel="noreferrer">
                    {service.url!.replace(/^https?:\/\//, "")}
                  </a>
                </Show>
                <span class="ps-list-meta">{service.status[0]!.toUpperCase() + service.status.slice(1)}</span>
                <span class="ps-repo-actions">
                  <Show
                    when={service.status === "running" || service.status === "starting"}
                    fallback={
                      <Button size="compact" variant="quiet" disabled={control.isPending} onClick={() => control.mutate({ action: "start", serviceId: service.id })}>
                        Start
                      </Button>
                    }
                  >
                    <Button size="compact" variant="quiet" disabled={control.isPending} onClick={() => control.mutate({ action: "restart", serviceId: service.id })}>
                      Restart
                    </Button>
                    <Button size="compact" variant="quiet" disabled={control.isPending} onClick={() => control.mutate({ action: "stop", serviceId: service.id })}>
                      Stop
                    </Button>
                  </Show>
                </span>
              </div>
            )}
          </For>
          <Show when={services().length === 0}>
            <div class="ps-list-row">
              <span class="ps-list-name ps-muted-line">Services are set up but not running.</span>
              <span class="ps-repo-actions">
                <Button size="compact" variant="quiet" disabled={control.isPending} onClick={() => control.mutate({ action: "start" })}>
                  Start services
                </Button>
              </span>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={problem()}>
        <span class="field-error" role="alert">
          {problem()}
        </span>
      </Show>
    </div>
  );
}

function WorkspaceForm(props: { initial: WorkspaceDraft; hideHostPaths: boolean; busy: boolean; submitLabel: string; onCancel: () => void; onSubmit: (draft: WorkspaceDraft) => void }) {
  const [draft, setDraft] = createStore<WorkspaceDraft>({ ...props.initial });
  const [problem, setProblem] = createSignal<string | null>(null);
  const field = (key: keyof WorkspaceDraft, label: string, placeholder: string, mono = true) => (
    <label class="ps-form-field">
      <span class="field-label">{label}</span>
      <TextInput class={mono ? "mono" : ""} placeholder={placeholder} spellcheck={false} value={draft[key]} onInput={(event) => setDraft(key, event.currentTarget.value)} />
    </label>
  );
  const submit = (event: Event) => {
    event.preventDefault();
    const found = workspaceProblem(draft);
    if (found) return setProblem(found);
    setProblem(null);
    props.onSubmit({ ...draft });
  };
  return (
    <form class="ps-goal-form ps-workspace-form" onSubmit={submit} onKeyDown={(event) => event.key === "Escape" && props.onCancel()}>
      <div class="ps-form-grid">
        {field("name", "Name", "Optional", false)}
        <Show when={!props.hideHostPaths}>{field("cwd", "Folder on the server", "/home/you/code/project")}</Show>
        {field("repoUrl", "Repository URL", "https://github.com/org/repo")}
        {field("repoRef", "Branch or ref", "main")}
        {field("defaultRef", "Default ref", "origin/main")}
        {field("setupCommand", "Setup command", "Runs when the workspace is set up")}
        {field("cleanupCommand", "Cleanup command", "Runs before a task checkout is torn down")}
      </div>
      <div class="ps-form-foot">
        <Show when={problem()}>
          <span class="nt-error" role="alert">
            {problem()}
          </span>
        </Show>
        <Button size="compact" variant="quiet" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button size="compact" variant="primary" type="submit" disabled={props.busy}>
          {props.busy ? "Saving…" : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------

function CheckoutsCard(props: { project: Project; isolatedEnabled: boolean }) {
  const company = useCompany();
  const saver = useProjectSaver(() => props.project);
  const [draft, setDraft] = createStore<CheckoutDraft>(checkoutDraft(props.project));
  // Follows the saved policy when it changes and nothing is being edited.
  createEffect(
    on(
      () => JSON.stringify(checkoutDraft(props.project)),
      () => setDraft(reconcile(checkoutDraft(props.project))),
      { defer: true },
    ),
  );
  const dirty = () => checkoutDirty(props.project, draft);
  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
    enabled: props.isolatedEnabled,
  }));
  // Local, SSH and real sandboxes; the old UI offers the choice only when there's more than one.
  const runnable = createMemo(() =>
    (environments.data ?? []).filter((environment) => {
      if (environment.status !== "active") return false;
      if (environment.driver === "local" || environment.driver === "ssh") return true;
      const provider = typeof environment.config?.provider === "string" ? environment.config.provider : null;
      return environment.driver === "sandbox" && provider !== null && provider !== "fake";
    }),
  );
  const providers = () => props.project.workspaceProvider?.providers ?? [];
  const environmentName = () => runnable().find((environment) => environment.id === draft.environmentId)?.name ?? "No environment";
  const text = (key: "baseRef" | "branchTemplate" | "worktreeParentDir" | "provisionCommand" | "runtimeProvisionCommand" | "teardownCommand", label: string, placeholder: string, help?: string) => (
    <SettingsRow label={label} help={help} for={`ps-co-${key}`}>
      <TextInput id={`ps-co-${key}`} class="mono" placeholder={placeholder} spellcheck={false} value={draft[key]} onInput={(event) => setDraft(key, event.currentTarget.value)} />
    </SettingsRow>
  );

  return (
    <SettingsCard
      title="Task checkouts"
      description={
        <CardNote state={saver.state()} error={saver.error()}>
          How each task gets a copy of the code to work in.
        </CardNote>
      }
      footer={
        dirty() ? (
          <span class="ps-foot-end">
            <Button size="compact" variant="quiet" onClick={() => setDraft(reconcile(checkoutDraft(props.project)))}>
              Discard
            </Button>
            <Button size="compact" variant="primary" disabled={saver.state() === "saving"} onClick={() => void saver.save({ executionWorkspacePolicy: checkoutPolicy(props.project, { ...draft }) })}>
              {saver.state() === "saving" ? "Saving…" : "Save checkouts"}
            </Button>
          </span>
        ) : undefined
      }
    >
      <Show
        when={props.isolatedEnabled}
        fallback={
          <p class="ps-list-note">
            Every task works in the project's shared checkout. Separate checkouts per task are off on this instance; an instance admin can turn on isolated workspaces in
            the instance settings.
          </p>
        }
      >
        <SettingsRow label="Separate checkout per task" help="Each task can get its own git worktree, so agents working at once don't collide.">
          <Toggle checked={draft.enabled} onChange={(value) => setDraft("enabled", value)} label="Separate checkout per task" labelHidden />
        </SettingsRow>
        <Show when={draft.enabled}>
          <SettingsRow label="New tasks get their own" help="Off: new tasks use the shared checkout unless someone picks their own.">
            <Toggle checked={draft.isolatedByDefault} onChange={(value) => setDraft("isolatedByDefault", value)} label="New tasks get their own checkout" labelHidden />
          </SettingsRow>
          <SettingsRow label="Runs in the shared checkout" help={CONCURRENCY_OPTIONS.find((option) => option.value === draft.concurrency)?.help}>
            <Segmented label="Runs in the shared checkout" options={CONCURRENCY_OPTIONS} value={draft.concurrency} onChange={(value) => setDraft("concurrency", value)} />
          </SettingsRow>
          <Show when={runnable().length > 1}>
            <SettingsRow label="Runs on" help="The execution environment for this project's task checkouts.">
              <Menu>
                <Menu.Trigger as={FieldButton} class="ps-field-360" aria-label={`Runs on: ${environmentName()}`}>
                  {environmentName()}
                </Menu.Trigger>
                <Menu.Content label="Execution environment" width={300}>
                  <Menu.Item onSelect={() => setDraft("environmentId", "")} hint={draft.environmentId ? undefined : <Check size={14} />}>
                    No environment
                  </Menu.Item>
                  <For each={runnable()}>
                    {(environment) => (
                      <Menu.Item onSelect={() => setDraft("environmentId", environment.id)} description={environment.driver} hint={draft.environmentId === environment.id ? <Check size={14} /> : undefined}>
                        {environment.name}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </SettingsRow>
          </Show>
          {text("baseRef", "Base branch", "origin/main")}
          {text("branchTemplate", "Branch name", "{{issue.identifier}}-{{slug}}", "The name each task's branch gets.")}
          {text("worktreeParentDir", "Worktree folder", ".paperclip/worktrees")}
          {text("provisionCommand", "Setup command", "bash ./scripts/provision-worktree.sh", "Runs when a checkout is created.")}
          {text("runtimeProvisionCommand", "Runtime setup command", "bash ./scripts/provision-runtime.sh", "Runs once before the first service starts, for heavy setup such as seeding a database.")}
          {text("teardownCommand", "Teardown command", "bash ./scripts/teardown-worktree.sh", "Runs when a checkout is closed.")}
        </Show>
      </Show>
      <Show when={providers().length > 0}>
        <SettingsRow label="Workspace storage" help={props.project.workspaceProvider?.source === "default" ? `Inherited: ${props.project.workspaceProvider.displayName}` : undefined}>
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-360" aria-label="Workspace storage">
              {draft.storage === "inherit" ? "The installed default" : draft.storage === "core" ? "Core, on this server" : (providers().find((provider) => provider.id === draft.storage)?.displayName ?? "An unavailable provider")}
            </Menu.Trigger>
            <Menu.Content label="Workspace storage" width={300}>
              <Menu.Item onSelect={() => setDraft("storage", "inherit")} hint={draft.storage === "inherit" ? <Check size={14} /> : undefined}>
                The installed default
              </Menu.Item>
              <Menu.Item onSelect={() => setDraft("storage", "core")} hint={draft.storage === "core" ? <Check size={14} /> : undefined}>
                Core, on this server
              </Menu.Item>
              <For each={providers()}>
                {(provider) => (
                  <Menu.Item onSelect={() => setDraft("storage", provider.id)} hint={draft.storage === provider.id ? <Check size={14} /> : undefined}>
                    {provider.displayName}
                    {provider.isDefault ? " (default)" : ""}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
          <Show when={props.project.workspaceProvider?.error}>
            <span class="field-error" role="alert">
              {props.project.workspaceProvider!.error}
            </span>
          </Show>
        </SettingsRow>
      </Show>
    </SettingsCard>
  );
}
