import type { Project, ProjectRepository, ProjectWorkspace, WorkspaceRuntimeService } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Book, Check, ChevronDown, FolderOpen, Lock, Plus, Search, X } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, createUniqueId, For, Match, on, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { readNote } from "@/lib/offline/read-state";
import { WorkspacePlugins } from "@/plugins/WorkspacePlugins";
import { APP_SETTINGS_PATH } from "@/settings/app/app-settings-model";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
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
  storageAvailability,
  storageEnvironmentNames,
  workspaceDraft,
  workspacePatch,
  workspaceProblem,
  type CheckoutDraft,
  type WorkspaceDraft,
} from "./settings-model";
import { failure, FootError, refreshProject, SaveStatus, useProjectSaver, useSaveRunner, type SaveState } from "./shared";
import { COMMANDS_EXAMPLE, commandEntries, commandsRequest, commandsText, parseCommands } from "./workspace-commands";

/*
 * Code and workspaces (board 11): the project's repositories and local folder, its workspaces with
 * their runtime services, and how tasks get their own checkout. Each card says what it's for behind
 * its "i" button (InfoTip.tsx); the body keeps state, empty states and errors.
 *
 * - Repositories are the company's connected GitHub repositories (`PUT /projects/:id/repositories`).
 *   The server keeps one project workspace per repository: adding one creates it, removing one
 *   removes it, or only detaches the repository when the workspace has a folder of its own
 *   (`replaceRepositories` in server/src/services/projects.ts). The list's order isn't stored, so
 *   "primary" is the repository whose workspace is the primary one, and Make primary sets that
 *   workspace as the primary. Ones added by URL before the connection existed are listed and
 *   edited as workspaces. The local folder is the primary workspace's folder, as in the old UI.
 * - Workspaces (`/projects/:id/workspaces`): add, edit, remove, make one the default (primary), and
 *   start, stop or restart their services. A workspace's commands JSON (its services and jobs,
 *   `runtimeConfig.workspaceRuntime`) is edited in the workspace's form, checked before saving
 *   (workspace-commands.ts).
 * - Task checkouts follow the instance's `enableIsolatedWorkspaces` (decision 12), and the folder
 *   paths hide under `enableManagedSandboxOnly`, as the old UI does.
 * - Workspace storage is fixed when the project is created and only shown, with the environments that
 *   can use it (#20835, build plan U126). A project has no run environment of its own: runs follow
 *   the agent's default, then the instance's.
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
  const savedById = createMemo(() => new Map(saved().map((repo) => [repo.id, repo] as const)));
  const makePrimary = createMutation(() => ({
    mutationFn: (workspaceId: string) => projectsApi.updateWorkspace(props.project.id, workspaceId, { isPrimary: true }),
    onSuccess: async () => {
      setProblem(null);
      await refreshProject(client, company().id);
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't make it the primary repository.")),
  }));

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
      info="Which GitHub repositories, from the company's GitHub connections, the project's code comes from. Adding one adds a project workspace for it and imports the skills it contains."
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
      <Show
        when={ids().length > 0 || legacy().length > 0}
        fallback={<p class="ps-list-note">{(props.project.workspaces ?? []).length > 0 ? "No repositories. Agents work in the project workspaces below." : "No repositories."}</p>}
      >
        <ul class="ps-repos" aria-label="Repositories for this project">
          <For each={ids()}>
            {(id) => (
              <li class="ps-repo">
                <Book size={15} aria-hidden="true" />
                <span class="mono ps-repo-name">{nameOf(id)}</span>
                <Show when={savedById().get(id)?.isPrimary}>
                  <span class="np-primary">primary</span>
                </Show>
                <Show when={byId().get(id)?.private}>
                  <Lock size={12} aria-label="Private repository" />
                </Show>
                <span class="ps-repo-actions">
                  <Show when={savedById().get(id)?.isPrimary === false ? savedById().get(id) : undefined}>
                    {(repo) => (
                      <Button size="compact" variant="quiet" disabled={makePrimary.isPending} onClick={() => makePrimary.mutate(repo().workspaceId)}>
                        Make primary
                      </Button>
                    )}
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
                <span class="ps-repo-actions ps-muted-line">Edit it under Project workspaces</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={options.data?.failedConnectionCount}>
        <p class="ps-list-note">Some GitHub connections couldn't load. Reconnect them in Connections.</p>
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
      fallback={<span class="ps-muted-line">No GitHub account is connected to this company. Connect one in Connections to add repositories.</span>}
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
      <SettingsRow
        label="Local folder"
        info="The primary workspace's folder on the server, where agents work on the code. Without one, agents work in a copy of the workspace's repository that Paperclip keeps."
        help={props.hideHostPaths ? "Agents check the code out in the platform's managed environment." : undefined}
      >
        <Show
          when={!props.hideHostPaths}
          fallback={
            <span class="ps-muted-line">
              {!codebase()?.workspaceId ? "None" : codebase()?.origin === "managed_checkout" ? "A folder Paperclip manages." : "Set by the project's workspace."}
            </span>
          }
        >
          <Show
            when={editing()}
            fallback={
              <div class="ps-inline ps-inline--spread">
                <span class="ps-folder">
                  <FolderOpen size={15} aria-hidden="true" />
                  {/* With no workspace there's no managed copy either: tasks start in folders of their own. */}
                  <span class="mono">{codebase()?.workspaceId ? (codebase()?.effectiveLocalFolder ?? "None") : "None"}</span>
                  <Show when={codebase()?.workspaceId && codebase()?.origin === "managed_checkout"}>
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

  const create = async (draft: WorkspaceDraft, commands: string) => {
    const extra = commandsRequest(undefined, commands);
    const payload = { ...newWorkspacePayload(draft), ...(extra.kind === "set" ? extra.data : {}) };
    if (await saver.run(() => projectsApi.createWorkspace(props.project.id, payload), "Couldn't add the workspace.")) setEditing(null);
  };
  const update = async (workspace: ProjectWorkspace, draft: WorkspaceDraft, commands: string) => {
    const extra = commandsRequest(workspace, commands);
    const fields = workspacePatch(workspace, draft);
    const patch = fields || extra.kind === "set" ? { ...fields, ...(extra.kind === "set" ? extra.data : {}) } : null;
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
        info="Where agents work on the project's code: a folder on the server, or a repository Paperclip copies for them, with its commands and services. Tasks use the primary one unless they pick another."
        description={saveNote(saver.state(), saver.error())}
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
                <WorkspaceForm
                  initial={workspaceDraft(workspace)}
                  initialCommands={commandsText(workspace)}
                  hideHostPaths={props.hideHostPaths}
                  busy={saver.state() === "saving"}
                  submitLabel="Save workspace"
                  onCancel={() => setEditing(null)}
                  onSubmit={(draft, commands) => void update(workspace, draft, commands)}
                />
              </Show>
            )}
          </For>
          <Show when={editing() === "new"}>
            <WorkspaceForm
              initial={workspaceDraft()}
              initialCommands=""
              hideHostPaths={props.hideHostPaths}
              busy={saver.state() === "saving"}
              submitLabel="Add workspace"
              onCancel={() => setEditing(null)}
              onSubmit={(draft, commands) => void create(draft, commands)}
            />
          </Show>
          <Show when={workspaces().length === 0 && editing() !== "new"}>
            <p class="ps-list-note">No workspaces. Each task starts in an empty folder, or in its agent's own folder.</p>
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
      <Show when={commandEntries(props.workspace).length > 0}>
        <span class="ps-muted-line">
          Commands: {commandEntries(props.workspace).map((entry) => (entry.kind === "job" ? `${entry.name} (job)` : entry.name)).join(", ")}
        </span>
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
      <WorkspacePlugins kind="project_workspace" workspaceId={props.workspace.id} projectId={props.project.id} />
    </div>
  );
}

function WorkspaceForm(props: {
  initial: WorkspaceDraft;
  /** The commands JSON as text; empty for none. */
  initialCommands: string;
  hideHostPaths: boolean;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: WorkspaceDraft, commands: string) => void;
}) {
  const [draft, setDraft] = createStore<WorkspaceDraft>({ ...props.initial });
  const [commands, setCommands] = createSignal(props.initialCommands);
  const [commandsOpen, setCommandsOpen] = createSignal(props.initialCommands !== "");
  const [commandsProblem, setCommandsProblem] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const commandsId = createUniqueId();
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
    const parsed = parseCommands(commands());
    if (!parsed.ok) {
      setCommandsOpen(true);
      setCommandsProblem(parsed.error);
      return setProblem("Fix the workspace commands before saving.");
    }
    setProblem(null);
    props.onSubmit({ ...draft }, commands());
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
      <div class="ps-commands">
        <button type="button" class="ps-commands-toggle" aria-expanded={commandsOpen()} aria-controls={commandsId} onClick={() => setCommandsOpen(!commandsOpen())}>
          <ChevronDown size={14} aria-hidden="true" />
          Workspace commands (JSON)
        </button>
        <Show when={commandsOpen()}>
          <div id={commandsId} class="ps-form-field">
            <span class="fhelp">
              The services and jobs agents can run here: Paperclip lists them under the workspace and task checkouts inherit them. Use <code>commands</code> entries with a{" "}
              <code>kind</code> of <code>service</code> or <code>job</code>; older <code>services</code> lists still work. Leave it empty for none.
            </span>
            <TextArea
              class="mono ps-commands-json"
              aria-label="Workspace commands JSON"
              aria-describedby={commandsProblem() ? `${commandsId}-error` : undefined}
              invalid={commandsProblem() !== null}
              spellcheck={false}
              rows={12}
              placeholder={COMMANDS_EXAMPLE}
              value={commands()}
              onInput={(event) => {
                setCommands(event.currentTarget.value);
                setCommandsProblem(null);
                setProblem(null);
              }}
              onBlur={() => {
                const parsed = parseCommands(commands());
                setCommandsProblem(parsed.ok ? null : parsed.error);
              }}
            />
            <Show when={commandsProblem()}>
              <span id={`${commandsId}-error`} class="field-error" role="alert">
                {commandsProblem()}
              </span>
            </Show>
          </div>
        </Show>
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

/** A card's save status as its description, or nothing while idle (what the card is for is in its `info`). */
function saveNote(state: SaveState, error: string | null) {
  return state === "idle" ? undefined : <SaveStatus state={state} error={error} />;
}

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
  const text = (key: "baseRef" | "branchTemplate" | "worktreeParentDir" | "provisionCommand" | "runtimeProvisionCommand" | "teardownCommand", label: string, placeholder: string, info: string) => (
    <SettingsRow label={label} info={info} for={`ps-co-${key}`}>
      <TextInput id={`ps-co-${key}`} class="mono" placeholder={placeholder} spellcheck={false} value={draft[key]} onInput={(event) => setDraft(key, event.currentTarget.value)} />
    </SettingsRow>
  );

  return (
    <SettingsCard
      title="Task checkouts"
      info="Whether each task gets its own git worktree, branched from the project workspace, instead of sharing the workspace with other tasks. Agents working at once then don't collide."
      description={saveNote(saver.state(), saver.error())}
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
            Tasks share the project workspace. To give each its own worktree, an instance admin turns on Isolated workspaces in{" "}
            <A class="ps-link" href={`/${company().issuePrefix}${APP_SETTINGS_PATH}/general`}>
              App settings → General → Features
            </A>
            .
          </p>
        }
      >
        <SettingsRow label="Separate checkout per task" info="Lets this project's tasks work in their own git worktree instead of the shared project workspace.">
          <Toggle checked={draft.enabled} onChange={(value) => setDraft("enabled", value)} label="Separate checkout per task" labelHidden />
        </SettingsRow>
        <Show when={draft.enabled}>
          <SettingsRow label="New tasks get their own" info="On: each new task gets its own worktree. Off: new tasks share the project workspace unless someone picks a worktree for them.">
            <Toggle checked={draft.isolatedByDefault} onChange={(value) => setDraft("isolatedByDefault", value)} label="New tasks get their own checkout" labelHidden />
          </SettingsRow>
          <SettingsRow
            label="Runs in the shared workspace"
            info={`Whether runs that share the project workspace wait for each other. ${CONCURRENCY_OPTIONS.find((option) => option.value === draft.concurrency)?.help ?? ""}`}
          >
            <Segmented label="Runs in the shared workspace" options={CONCURRENCY_OPTIONS} value={draft.concurrency} onChange={(value) => setDraft("concurrency", value)} />
          </SettingsRow>
          {text("baseRef", "Base branch", "origin/main", "The branch each task's worktree starts from.")}
          {text("branchTemplate", "Branch name", "{{issue.identifier}}-{{slug}}", "The name each task's branch gets.")}
          {text("worktreeParentDir", "Worktree folder", ".paperclip/worktrees", "Where task worktrees are created, relative to the repository.")}
          {text("provisionCommand", "Setup command", "bash ./scripts/provision-worktree.sh", "Runs in a task's worktree when it's created.")}
          {text("runtimeProvisionCommand", "Runtime setup command", "bash ./scripts/provision-runtime.sh", "Runs once before the first service starts, for heavy setup such as seeding a database.")}
          {text("teardownCommand", "Teardown command", "bash ./scripts/teardown-worktree.sh", "Runs when a task's worktree is cleaned up.")}
        </Show>
      </Show>
      <StorageAvailabilityRow project={props.project} />
    </SettingsCard>
  );
}

/**
 * The project's workspace storage, fixed when it was created (#20835), and the environments that can
 * use it. Shown only when a storage plugin is installed or the project uses one.
 */
function StorageAvailabilityRow(props: { project: Project }) {
  const company = useCompany();
  const availability = createMemo(() => storageAvailability(props.project));
  const options = createQuery(() => ({
    queryKey: queryKeys.projectEnvironments(company().id),
    queryFn: ({ signal }) => projectsApi.environmentOptions(company().id, signal),
    enabled: availability().kind === "list",
  }));
  const names = createMemo(() => {
    const found = availability();
    return found.kind === "list" ? storageEnvironmentNames(options.data, found.pluginId) : [];
  });
  const help = () => {
    const found = availability();
    return found.kind === "list"
      ? `${found.storageName} workspace storage was chosen when this project was created and doesn't change.`
      : "The workspace storage plugin this project was created with isn't installed. Storage doesn't change after creation.";
  };
  return (
    <Show when={availability().kind !== "hidden"}>
      <SettingsRow label="Available in" help={help()}>
        <Switch>
          <Match when={availability().kind === "unavailable"}>
            <span class="field-error" role="alert">
              Storage plugin unavailable
            </span>
          </Match>
          <Match when={names().length > 0}>
            <ul class="ps-chips" aria-label="Environments that can use this project's storage">
              <For each={names()}>{(name) => <li class="ps-chip">{name}</li>}</For>
            </ul>
          </Match>
          <Match when={true}>
            <span class="ps-muted-line">{readNote(options, "No available environments", { loading: "Loading environments…", failed: "Couldn't load the environments." })}</span>
          </Match>
        </Switch>
        <Show when={availability().kind === "list" && props.project.workspaceProvider?.error}>
          <span class="field-error" role="alert">
            {props.project.workspaceProvider!.error}
          </span>
        </Show>
      </SettingsRow>
    </Show>
  );
}
