import type { ProjectIconName, ProjectRepository } from "@paperclipai/shared";
import { useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  Book,
  Briefcase,
  Bug,
  CalendarDays,
  Check,
  ChevronDown,
  Code,
  Compass,
  Database,
  Flame,
  Folder,
  FolderOpen,
  Globe,
  Layers,
  Lightbulb,
  Lock,
  Package,
  Plus,
  Rocket,
  Search,
  Target,
  Terminal,
  X,
  Zap,
} from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { personName } from "@/api/access";
import { activeAgents } from "@/api/agents";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, usePeopleQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { newId } from "@/tasks/new-task";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Dialog } from "@/ui/Dialog";
import { TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  buildProjectPayload,
  emptyProjectDraft,
  membersToAdd,
  NEW_PROJECT_STATUSES,
  projectProblem,
  TILE_COLORS,
  TILE_ICONS,
  tileGradient,
  type CodeSource,
  type Member,
  type NewProjectDraft,
} from "./new-project";
import "@/tasks/NewTaskDialog.css";
import "./NewProjectDialog.css";

/*
 * New project (board N1), opened from the + beside Projects in the nav through
 * `useCommands().openNewProject()`. It's laid out like New task and reuses its pills, fields and
 * footer (`.nt-*`):
 *
 * - the tile (a color, and the name's first letter or an icon), then the name and description;
 * - pills for status, lead and visibility (a private project lists its members), and a target date;
 * - Code: GitHub repositories from the company's connections, a folder on the server, or none.
 *
 * Creating goes to the new project's dashboard. The form rules and the request live in
 * new-project.ts.
 *
 * Not here: connecting a GitHub account from inside the dialog (the old UI's connection flow isn't
 * ported yet), and each repository's branch, which the repository list doesn't return.
 */

const ICONS: Record<string, (props: { size: number }) => JSX.Element> = {
  folder: (p) => <Folder size={p.size} />,
  rocket: (p) => <Rocket size={p.size} />,
  code: (p) => <Code size={p.size} />,
  terminal: (p) => <Terminal size={p.size} />,
  database: (p) => <Database size={p.size} />,
  globe: (p) => <Globe size={p.size} />,
  package: (p) => <Package size={p.size} />,
  layers: (p) => <Layers size={p.size} />,
  briefcase: (p) => <Briefcase size={p.size} />,
  compass: (p) => <Compass size={p.size} />,
  target: (p) => <Target size={p.size} />,
  flame: (p) => <Flame size={p.size} />,
  zap: (p) => <Zap size={p.size} />,
  bug: (p) => <Bug size={p.size} />,
  lightbulb: (p) => <Lightbulb size={p.size} />,
};

const STATUS_GRADIENT = { backlog: "ash", planned: "ember", in_progress: "ion" } as const;

/** A project's tile: its color with the name's first letter or its icon. */
export function ProjectTile(props: { name: string; color: string | null; icon: ProjectIconName | null; size?: number }) {
  const size = () => props.size ?? 50;
  return (
    <span
      class="np-tile disp"
      style={{ width: `${size()}px`, height: `${size()}px`, background: tileGradient(props.color) ?? "var(--g-ash)", "font-size": `${Math.round(size() * 0.4)}px` }}
      aria-hidden="true"
    >
      <Show when={props.icon && ICONS[props.icon]} fallback={(props.name.trim()[0] ?? "P").toLowerCase()}>
        {(icon) => icon()({ size: Math.round(size() * 0.44) })}
      </Show>
    </span>
  );
}

export function NewProjectDialog() {
  const commands = useCommands();
  return (
    <Dialog
      open={commands.newProject()}
      onOpenChange={(next) => !next && commands.closeNewProject()}
      title="New project"
      titleHidden
      hideClose
      width={720}
      initialFocus={() => document.getElementById("np-name")}
    >
      <Show when={commands.newProject()}>
        <NewProjectForm />
      </Show>
    </Dialog>
  );
}

function NewProjectForm() {
  const commands = useCommands();
  const company = useCompany();
  const session = useSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const people = usePeopleQuery();

  const [draft, setDraft] = createStore<NewProjectDraft>(emptyProjectDraft());
  const [error, setError] = createSignal<string | null>(null);
  const [tileOpen, setTileOpen] = createSignal(false);
  // A retry of the same submission reuses its key, so the server makes one project.
  let submission: { fingerprint: string; key: string } | null = null;
  // A problem shown on Create goes away once the form changes.
  createEffect(on(() => JSON.stringify(draft), () => setError(null), { defer: true }));

  const agentList = createMemo(() => activeAgents(agents.data));
  const agentById = (id: string | null) => agentList().find((agent) => agent.id === id);
  const personList = createMemo(() =>
    (people.data?.users ?? []).map((entry) => ({
      id: entry.principalId,
      name: entry.principalId === session.youId() ? "You" : personName(entry),
      fullName: personName(entry),
      you: entry.principalId === session.youId(),
    })),
  );
  const memberName = (member: Member) =>
    member.kind === "agent" ? (agentById(member.id)?.name ?? "Agent") : (personList().find((person) => person.id === member.id)?.name ?? "Someone");
  const hasMember = (member: Member) => draft.members.some((entry) => entry.kind === member.kind && entry.id === member.id);
  const toggleMember = (member: Member) =>
    setDraft("members", (list) => (hasMember(member) ? list.filter((entry) => !(entry.kind === member.kind && entry.id === member.id)) : [...list, member]));

  const create = createMutation(() => ({
    mutationFn: async (payload: Record<string, unknown>) => {
      const project = await projectsApi.create(company().id, payload);
      const failed: string[] = [];
      for (const member of membersToAdd(unwrap(draft), session.youId())) {
        try {
          await projectsApi.addAccessMember(project.id, { subjectType: member.kind, subjectId: member.id });
        } catch {
          failed.push(memberName(member));
        }
      }
      return { project, failed };
    },
  }));

  const submit = async () => {
    const problem = projectProblem(draft);
    if (problem) return setError(problem);
    setError(null);
    const base = unwrap(draft);
    const fingerprint = JSON.stringify(base);
    if (submission?.fingerprint !== fingerprint) submission = { fingerprint, key: newId() };
    try {
      const { project, failed } = await create.mutateAsync(buildProjectPayload(base, submission.key));
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) });
      if (failed.length > 0) pushToast({ tone: "warn", title: `Created ${project.name}, but some members weren't added`, body: failed.join(", ") });
      else pushToast({ tone: "success", title: `Created ${project.name}` });
      commands.closeNewProject();
      navigate(`/${company().issuePrefix}/projects/${project.urlKey}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't create the project.");
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const status = () => NEW_PROJECT_STATUSES.find((option) => option.value === draft.status)!;
  const lead = () => agentById(draft.leadAgentId);

  return (
    <div class="nt np" onKeyDown={onKeyDown}>
      <header class="nt-head np-head">
        <h2 class="nt-title-label disp">New project</h2>
        <button type="button" class="nt-icon nt-close" aria-label="Close" onClick={() => commands.closeNewProject()}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div class="nt-text">
        <div class="np-identity">
          <Popover open={tileOpen()} onOpenChange={setTileOpen}>
            <Popover.Trigger class="np-tile-button" aria-label="Icon and color">
              <ProjectTile name={draft.name} color={draft.color} icon={draft.icon} />
              <span class="np-tile-caret" aria-hidden="true">
                <ChevronDown size={12} />
              </span>
            </Popover.Trigger>
            <Popover.Content label="Icon and color" width={344} hideClose class="np-tile-pop">
              <div class="lbl" id="np-color-l">
                Color
              </div>
              <div class="np-colors" role="radiogroup" aria-labelledby="np-color-l">
                <For each={TILE_COLORS}>
                  {(color) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.color === color.stops[0]}
                      aria-label={color.name}
                      class="np-color"
                      style={{ background: `linear-gradient(160deg, ${color.stops[0]}, ${color.stops[1]})` }}
                      onClick={() => setDraft("color", color.stops[0])}
                    />
                  )}
                </For>
              </div>
              <div class="lbl" id="np-icon-l">
                Icon
              </div>
              <div class="np-icons" role="radiogroup" aria-labelledby="np-icon-l">
                <button type="button" role="radio" aria-checked={draft.icon === null} aria-label="First letter" class="np-icon disp" onClick={() => setDraft("icon", null)}>
                  {(draft.name.trim()[0] ?? "P").toLowerCase()}
                </button>
                <For each={TILE_ICONS}>
                  {(icon) => (
                    <button type="button" role="radio" aria-checked={draft.icon === icon.value} aria-label={icon.label} class="np-icon" onClick={() => setDraft("icon", icon.value)}>
                      {ICONS[icon.value]!({ size: 16 })}
                    </button>
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover>
          <label class="sr-only" for="np-name">
            Project name
          </label>
          <TextInput
            id="np-name"
            variant="title"
            class="nt-input np-name"
            placeholder="Project name"
            autocomplete="off"
            value={draft.name}
            onInput={(event) => setDraft("name", event.currentTarget.value)}
            autofocus
          />
        </div>
        <label class="sr-only" for="np-desc">
          Description
        </label>
        <TextArea
          id="np-desc"
          class="nt-input nt-input--desc"
          rows={3}
          placeholder="What this project is for. Agents read it before every task."
          value={draft.description}
          onInput={(event) => setDraft("description", event.currentTarget.value)}
        />
      </div>

      <div class="nt-fields np-fields">
        <Menu>
          <Menu.Trigger class="nt-pill" aria-label={`Status: ${status().label}`}>
            <Capsule gradient={STATUS_GRADIENT[draft.status]} size="tiny" live={draft.status === "in_progress"} />
            <b class="np-pill-value">{status().label}</b>
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Status" width={240}>
            <For each={NEW_PROJECT_STATUSES}>
              {(option) => (
                <Menu.Item
                  onSelect={() => setDraft("status", option.value)}
                  icon={<Capsule gradient={STATUS_GRADIENT[option.value]} size="row" />}
                  hint={option.value === draft.status ? <Check size={14} /> : undefined}
                >
                  {option.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>

        <Menu>
          <Menu.Trigger class="nt-pill np-pill--disc" aria-label={`Lead: ${lead()?.name ?? "No lead"}`}>
            <Show when={lead()} fallback={<span class="nt-disc-empty np-disc" aria-hidden="true" />}>
              {(agent) => <AgentAvatar agent={agent()} size={24} ring={false} />}
            </Show>
            <span class="nt-muted">Lead</span>
            <b class="np-pill-value">{lead()?.name ?? "No lead"}</b>
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Lead" width={272}>
            <For each={agentList()} fallback={<p class="nt-menu-note">This company has no agents yet.</p>}>
              {(agent) => (
                <Menu.Item
                  onSelect={() => setDraft("leadAgentId", agent.id)}
                  icon={<AgentAvatar agent={agent} size={24} ring={false} />}
                  hint={agent.id === draft.leadAgentId ? <Check size={14} /> : undefined}
                >
                  {agent.name}
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
            <Menu.Item onSelect={() => setDraft("leadAgentId", null)} hint={draft.leadAgentId ? undefined : <Check size={14} />}>
              No lead
            </Menu.Item>
          </Menu.Content>
        </Menu>

        <Menu>
          <Menu.Trigger class="nt-pill" aria-label={`Visibility: ${draft.visibility === "private" ? "Private" : "Open"}`}>
            {draft.visibility === "private" ? <Lock size={13} aria-hidden="true" /> : <Globe size={13} aria-hidden="true" />}
            <b class="np-pill-value">{draft.visibility === "private" ? "Private" : "Open"}</b>
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Visibility" width={272}>
            <Menu.Item
              onSelect={() => setDraft("visibility", "open")}
              description={`Everyone in ${company().name}`}
              hint={draft.visibility === "open" ? <Check size={14} /> : undefined}
            >
              Open
            </Menu.Item>
            <Menu.Item
              onSelect={() => setDraft("visibility", "private")}
              description="Only the members you add"
              hint={draft.visibility === "private" ? <Check size={14} /> : undefined}
            >
              Private
            </Menu.Item>
          </Menu.Content>
        </Menu>

        <TargetDatePill value={draft.targetDate} onChange={(value) => setDraft("targetDate", value)} />
      </div>

      <Show when={draft.visibility === "private"}>
        <div class="np-members">
          <span class="lbl">Members</span>
          <span class="np-member">
            <InitialsDisc name="You" seed={session.youId() ?? "you"} you size={22} />
            You
          </span>
          <For each={draft.members}>
            {(member) => (
              <span class="np-member">
                <Show when={member.kind === "agent" && agentById(member.id)} fallback={<InitialsDisc name={memberName(member)} seed={member.id} size={22} />}>
                  {(agent) => <AgentAvatar agent={agent()} size={24} ring={false} />}
                </Show>
                {memberName(member)}
                <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${memberName(member)}`} onClick={() => toggleMember(member)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            )}
          </For>
          <Menu>
            <Menu.Trigger class="nt-add-role np-add-member" aria-label="Add a member">
              <Plus size={14} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Members" width={280}>
              <Show when={personList().some((person) => !person.you)}>
                <Menu.Group label="People">
                  <For each={personList().filter((person) => !person.you)}>
                    {(person) => (
                      <Menu.CheckboxItem
                        checked={hasMember({ kind: "user", id: person.id })}
                        onChange={() => toggleMember({ kind: "user", id: person.id })}
                        icon={<InitialsDisc name={person.fullName} seed={person.id} size={22} />}
                      >
                        {person.name}
                      </Menu.CheckboxItem>
                    )}
                  </For>
                </Menu.Group>
              </Show>
              <Menu.Group label="Agents">
                <For each={agentList()} fallback={<p class="nt-menu-note">No agents yet.</p>}>
                  {(agent) => (
                    <Menu.CheckboxItem
                      checked={hasMember({ kind: "agent", id: agent.id })}
                      onChange={() => toggleMember({ kind: "agent", id: agent.id })}
                      icon={<AgentAvatar agent={agent} size={24} ring={false} />}
                    >
                      {agent.name}
                    </Menu.CheckboxItem>
                  )}
                </For>
              </Menu.Group>
            </Menu.Content>
          </Menu>
        </div>
      </Show>

      <section class="np-code" aria-labelledby="np-code-h">
        <div class="np-code-head">
          <h3 id="np-code-h" class="disp">
            Code
          </h3>
          <span class="cap">Where agents check out the project's code</span>
          <Segmented<CodeSource>
            label="Where the code comes from"
            value={draft.source}
            options={[
              { value: "github", label: "GitHub" },
              { value: "local", label: "Local folder" },
              { value: "none", label: "None" },
            ]}
            onChange={(value) => setDraft("source", value)}
          />
        </div>
        <Switch>
          <Match when={draft.source === "github"}>
            <Repositories selected={draft.repositoryIds} onChange={(ids) => setDraft("repositoryIds", ids)} />
          </Match>
          <Match when={draft.source === "local"}>
            <div class="np-folder">
              <FolderOpen size={15} aria-hidden="true" />
              <label class="sr-only" for="np-path">
                Folder on the server
              </label>
              <input
                id="np-path"
                class="mono"
                placeholder="/home/you/code/project"
                autocomplete="off"
                spellcheck={false}
                value={draft.folder}
                onInput={(event) => setDraft("folder", event.currentTarget.value)}
              />
            </div>
          </Match>
          <Match when={draft.source === "none"}>
            <p class="np-code-note">No code. Agents work in a folder Paperclip manages for the project, and you can add a repository later in Settings.</p>
          </Match>
        </Switch>
      </section>

      <footer class="nt-foot np-foot">
        <div class="nt-foot-end">
          <Show when={error()}>
            <span class="nt-error" role="alert">
              {error()}
            </span>
          </Show>
          <button type="button" class="nt-cancel" onClick={() => commands.closeNewProject()}>
            Cancel
          </button>
          <div class="nt-create">
            <button type="button" class="nt-create-main" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? "Creating…" : "Create project"}
              <kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl ↵"}</kbd>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A dashed pill until a date is set; the date input sits in a small popover. */
function TargetDatePill(props: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const label = () => {
    if (!props.value) return null;
    const date = new Date(`${props.value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? props.value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <Popover.Trigger class="nt-pill" classList={{ "nt-pill--quiet": !props.value }} aria-label={`Target date: ${label() ?? "none"}`}>
        <CalendarDays size={13} aria-hidden="true" />
        <Show when={label()} fallback="Target date">
          {(text) => (
            <>
              <span class="nt-muted">Target</span>
              <b class="np-pill-value">{text()}</b>
            </>
          )}
        </Show>
      </Popover.Trigger>
      <Popover.Content label="Target date" width={260} hideClose class="np-date-pop">
        <TextInput type="date" aria-label="Target date" value={props.value} onInput={(event) => props.onChange(event.currentTarget.value)} autofocus />
        <div class="np-date-actions">
          <button
            type="button"
            class="nt-cancel"
            onClick={() =>
              batch(() => {
                props.onChange("");
                setOpen(false);
              })
            }
          >
            Clear
          </button>
          <button type="button" class="nt-done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </Popover.Content>
    </Popover>
  );
}

/** The repositories picked so far, the first marked primary, and a searchable list of the rest. */
function Repositories(props: { selected: string[]; onChange: (ids: string[]) => void }) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const options = createQuery(() => ({
    queryKey: queryKeys.projectRepositories(company().id),
    queryFn: ({ signal }) => projectsApi.repositoryOptions(company().id, signal),
    staleTime: 30_000,
  }));
  const byId = createMemo(() => new Map((options.data?.repositories ?? []).map((repo) => [repo.id, repo] as const)));
  const picked = () => props.selected.map((id) => byId().get(id)).filter((repo): repo is ProjectRepository => Boolean(repo));
  const matches = createMemo(() => {
    const terms = query().toLowerCase().split(/\s+/).filter(Boolean);
    return (options.data?.repositories ?? []).filter((repo) => terms.every((term) => `${repo.fullName} ${repo.connections.join(" ")}`.toLowerCase().includes(term)));
  });
  const toggle = (id: string) => props.onChange(props.selected.includes(id) ? props.selected.filter((entry) => entry !== id) : [...props.selected, id]);
  const disconnected = () => options.data !== undefined && options.data.connectionCount === 0;

  return (
    <>
      <Show when={picked().length > 0}>
        <ul class="np-repos" aria-label="Repositories for this project">
          <For each={picked()}>
            {(repo, index) => (
              <li class="np-repo">
                <Book size={15} aria-hidden="true" />
                <span class="mono np-repo-name">{repo.fullName}</span>
                <Show when={index() === 0}>
                  <span class="np-primary">primary</span>
                </Show>
                <Show when={repo.private}>
                  <Lock size={12} aria-label="Private repository" />
                </Show>
                <button type="button" class="nt-icon nt-icon--small np-repo-remove" aria-label={`Remove ${repo.fullName}`} onClick={() => toggle(repo.id)}>
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="np-repo-add">
        <Switch>
          <Match when={disconnected()}>
            <p class="np-code-note">
              No GitHub account is connected to this company yet. Connect one under Apps, then pick its repositories here, or choose Local folder.
            </p>
          </Match>
          <Match when={true}>
            <Popover open={open()} onOpenChange={setOpen} placement="top-start">
              <Popover.Trigger class="nt-pill nt-pill--quiet">
                <Plus size={13} aria-hidden="true" />
                Add repository
              </Popover.Trigger>
              <Popover.Content label="Connected repositories" width={380} hideClose class="np-repo-pop">
                <div class="np-repo-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Find a repository"
                    placeholder="Search repositories"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    autofocus
                  />
                </div>
                <div class="np-repo-list" role="listbox" aria-label="Connected repositories" aria-multiselectable="true">
                  <Switch>
                    <Match when={options.isPending}>
                      <p class="nt-menu-note">Loading repositories…</p>
                    </Match>
                    <Match when={options.isError}>
                      <p class="nt-menu-note">
                        Couldn't load the repositories.{" "}
                        <button type="button" class="np-link" onClick={() => void options.refetch()}>
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
                          <button type="button" class="nt-option" role="option" aria-selected={props.selected.includes(repo.id)} onClick={() => toggle(repo.id)}>
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
                <Show when={options.data?.failedConnectionCount}>
                  <p class="nt-menu-note">Some GitHub connections couldn't load. Reconnect them under Apps.</p>
                </Show>
              </Popover.Content>
            </Popover>
          </Match>
        </Switch>
      </div>
    </>
  );
}
