import type { Agent, IssuePriority, IssueReviewPolicy, IssueStatus } from "@paperclipai/shared";
import { useLocation, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  Check,
  ChevronDown,
  Eye,
  FileText,
  GitBranch,
  Lock,
  Paperclip,
  Plus,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserCheck,
  X,
} from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { personName } from "@/api/access";
import { activeAgents, agentsApi } from "@/api/agents";
import { issuePath, issuesApi } from "@/api/issues";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { agentState, runningAgentIds } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import {
  useAgentsQuery,
  useExperimentalSettingsQuery,
  useGoalsQuery,
  useLabelsQuery,
  useLiveRunsQuery,
  usePeopleQuery,
  useProjectsQuery,
} from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Dialog } from "@/ui/Dialog";
import { TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Capsule, LabelPill, PriorityBars, StatusCapsule } from "@/ui/Status";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import {
  agentRunDefaults,
  buildCreatePayload,
  clearDraft,
  defaultWorkspaceMode,
  draftProblem,
  effortOptions,
  emptyDraft,
  loadDraft,
  newId,
  saveDraft,
  supportsOverrides,
  workspaceChoiceAvailable,
  type ExtraField,
  type NewTaskDraft,
  type Principal,
  type WorkspaceMode,
} from "./new-task";
import { TaskPicker, taskName } from "./TaskPicker";
import "./NewTaskDialog.css";

/*
 * The new-task dialog (board 7b), opened from the nav's + button, `c`, the command palette, or any
 * page through `useCommands().openNewTask()`:
 *
 * - Project, then status, priority, labels and "More fields" (parent, goal and blocked by under
 *   Plan; billing code and private under Admin).
 * - A bordered title and description, then attachments, uploaded once the task exists.
 * - One assignment row: the assignee capsule (agent or person, with the run's model and effort
 *   where the adapter allows it, decision 7), a reviewer, and a + menu for approver and watchdog.
 * - Work mode, workspace (when the project and instance allow it) and review policy as small pills
 *   beside Cancel and Create task (Cmd/Ctrl+Enter).
 *
 * The draft is kept per company in local storage, so closing the dialog by accident loses nothing;
 * Cancel discards it. The payload rules live in new-task.ts.
 *
 * Not yet: "Open as full page" (there's no full-page editor until M2's task page), @-mentions in
 * the description (the M2 composer), reusing another task's worktree (needs the workspace list).
 */

const STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"];
const PRIORITIES: IssuePriority[] = ["critical", "high", "medium", "low"];

const WORK_MODES = [
  { value: "standard", label: "Do the work", description: "Make the change and report back" },
  { value: "ask", label: "Answer a question", description: "Reply with findings, change nothing" },
  { value: "planning", label: "Plan first", description: "Propose a plan for you to approve" },
] as const;

const WORKSPACES: { value: WorkspaceMode; label: string; description: string }[] = [
  { value: "shared_workspace", label: "Shared workspace", description: "The project's main checkout" },
  { value: "isolated_workspace", label: "New worktree", description: "A fresh branch just for this task" },
];

const REVIEW_POLICIES: { value: IssueReviewPolicy; label: string; description: string }[] = [
  { value: "anyone", label: "Anyone approves", description: "Any reviewer can approve the result" },
  { value: "not_creator", label: "Not the creator", description: "Whoever made the task can't approve it" },
  { value: "human_only", label: "People only", description: "Agents can't approve the result" },
];

const EXTRA_META: Record<ExtraField, { label: string; description: string; icon: () => JSX.Element }> = {
  parent: { label: "Parent task", description: "Nest it under another task", icon: () => <GitBranch size={16} /> },
  goal: { label: "Goal", description: "Link it to a company goal", icon: () => <Target size={16} /> },
  blocked: { label: "Blocked by", description: "Wait for other tasks to finish first", icon: () => <X size={16} /> },
  billing: { label: "Billing code", description: "Charge the run cost to a code", icon: () => <Receipt size={16} /> },
  private: { label: "Private", description: "Only you and the assignee can see it", icon: () => <Lock size={16} /> },
  approver: { label: "Approver", description: "Signs off after the review", icon: () => <UserCheck size={16} /> },
  watchdog: { label: "Watchdog", description: "An agent that checks the work stays on track", icon: () => <Eye size={16} /> },
};

/** `name` is what lists show ("You" for the signed-in person); `fullName` gives the disc its initials. */
type Person = { id: string; name: string; fullName: string; you: boolean };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NewTaskDialog() {
  const commands = useCommands();
  const open = () => commands.newTask() !== null;
  return (
    <Dialog
      open={open()}
      onOpenChange={(next) => !next && commands.closeNewTask()}
      title="New task"
      titleHidden
      hideClose
      width={760}
      initialFocus={() => document.getElementById("nt-title")}
    >
      <Show when={open()}>
        <NewTaskForm />
      </Show>
    </Dialog>
  );
}

function NewTaskForm() {
  const commands = useCommands();
  const company = useCompany();
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();

  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const labels = useLabelsQuery();
  const people = usePeopleQuery();
  const experimental = useExperimentalSettingsQuery();

  // The project from the page the dialog opened over, when it wasn't given.
  const routeProjectId = () => {
    const key = /^\/[^/]+\/projects\/([^/?#]+)/.exec(location.pathname)?.[1];
    return key ? (projects.data?.find((project) => project.urlKey === key || project.id === key)?.id ?? null) : null;
  };
  const defaults = commands.newTask() ?? {};
  const saved = loadDraft(company().id);
  const start = saved ?? emptyDraft({ projectId: routeProjectId() });
  // Defaults from where the dialog was opened win over a saved draft's.
  if (defaults.projectId !== undefined) start.projectId = defaults.projectId;
  if (defaults.parentId) {
    start.parentId = defaults.parentId;
    if (!start.extras.includes("parent")) start.extras = [...start.extras, "parent"];
  }
  if (defaults.assigneeAgentId) start.assignee = { kind: "agent", id: defaults.assigneeAgentId };
  if (defaults.status) start.status = defaults.status;
  if (defaults.title) start.title = defaults.title;
  const [draft, setDraft] = createStore<NewTaskDraft>(start);
  const [files, setFiles] = createSignal<File[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [whoOpen, setWhoOpen] = createSignal(false);
  // A retry of the same submission reuses its key, so the server makes one task.
  let submission: { fingerprint: string; key: string } | null = null;

  createEffect(on(() => JSON.stringify(draft), () => saveDraft(company().id, unwrap(draft)), { defer: true }));

  const project = createMemo(() => projects.data?.find((candidate) => candidate.id === draft.projectId) ?? null);
  const agentList = createMemo(() => activeAgents(agents.data));
  const running = createMemo(() => runningAgentIds(liveRuns.data));
  const youId = () => session.youId();
  const personList = createMemo<Person[]>(() =>
    (people.data?.users ?? []).map((entry) => ({
      id: entry.principalId,
      name: entry.principalId === youId() ? "You" : personName(entry),
      fullName: personName(entry),
      you: entry.principalId === youId(),
    })),
  );
  const agentById = (id: string | null | undefined) => agentList().find((agent) => agent.id === id);
  const assigneeAgent = () => (draft.assignee?.kind === "agent" ? agentById(draft.assignee.id) : undefined);
  const isolatedWorkspaces = () => experimental.data?.enableIsolatedWorkspaces === true;
  const showWorkspace = () => workspaceChoiceAvailable(project(), isolatedWorkspaces());
  const has = (field: ExtraField) => draft.extras.includes(field);

  // A new project brings its own default workspace mode; a saved draft keeps its choice.
  let workspaceFor: string | null | undefined = saved ? draft.projectId : undefined;
  createEffect(() => {
    if (!projects.data) return;
    const current = project();
    const id = current?.id ?? null;
    if (id === workspaceFor) return;
    workspaceFor = id;
    setDraft("workspace", defaultWorkspaceMode(current));
  });

  const toggleExtra = (field: ExtraField) => {
    if (has(field)) {
      batch(() => {
        setDraft("extras", (list) => list.filter((entry) => entry !== field));
        if (field === "private") setDraft("private", false);
      });
    } else {
      batch(() => {
        setDraft("extras", (list) => [...list, field]);
        if (field === "private") setDraft("private", true);
      });
    }
  };

  const principalName = (principal: Principal | null) => {
    if (!principal) return null;
    if (principal.kind === "agent") return agentById(principal.id)?.name ?? "Agent";
    return personList().find((person) => person.id === principal.id)?.name ?? "Someone";
  };

  // 28px discs; agent avatars come in fixed sizes, so theirs is drawn at 32 and shrunk in CSS.
  const principalDisc = (principal: Principal | null, size = 28) => {
    if (!principal) return <span class="nt-disc-empty" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
    if (principal.kind === "agent") {
      const agent = agentById(principal.id);
      return agent ? <AgentAvatar agent={agent} size={32} ring={false} /> : <InitialsDisc name="?" size={size} />;
    }
    const person = personList().find((candidate) => candidate.id === principal.id);
    return <InitialsDisc name={person?.fullName ?? "?"} seed={principal.id} you={person?.you} size={size} />;
  };

  const create = createMutation(() => ({
    mutationFn: async (payload: Record<string, unknown>) => {
      const issue = await issuesApi.create(company().id, payload);
      const failed: string[] = [];
      for (const file of files()) {
        try {
          await issuesApi.uploadAttachment(company().id, issue.id, file);
        } catch {
          failed.push(file.name);
        }
      }
      return { issue, failed };
    },
  }));

  const submit = async (openAfter: boolean) => {
    const problem = draftProblem(draft);
    if (problem) return setError(problem);
    setError(null);
    const base = unwrap(draft);
    const fingerprint = JSON.stringify(base);
    if (submission?.fingerprint !== fingerprint) submission = { fingerprint, key: newId() };
    const payload = buildCreatePayload(base, {
      adapterType: assigneeAgent()?.adapterType ?? null,
      project: project(),
      isolatedWorkspacesEnabled: isolatedWorkspaces(),
      idempotencyKey: submission.key,
    });
    try {
      const { issue, failed } = await create.mutateAsync(payload);
      clearDraft(company().id);
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.sidebarBadges(company().id) });
      const ref = issue.identifier ?? "the task";
      const href = issuePath(company().issuePrefix, issue);
      if (failed.length > 0) {
        pushToast({ tone: "warn", title: `Created ${ref}, but some files didn't upload`, body: failed.join(", "), action: { label: `Open ${ref}`, href } });
      } else {
        pushToast({ tone: "success", title: `Created ${ref}`, body: issue.title, action: openAfter ? undefined : { label: `Open ${ref}`, href } });
      }
      commands.closeNewTask();
      if (openAfter) navigate(href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't create the task.");
    }
  };

  const cancel = () => {
    clearDraft(company().id);
    commands.closeNewTask();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      void submit(false);
    }
  };

  let fileInput: HTMLInputElement | undefined;
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((current) => [...current, ...Array.from(list)]);
  };

  const effortValue = () => draft.effort;
  const assigneeDefaults = () => {
    const agent = assigneeAgent();
    return agent ? agentRunDefaults(agent.adapterType, agent.adapterConfig) : { model: null, effort: null };
  };
  const shownModel = () => draft.model ?? assigneeDefaults().model;
  const shownEffort = () => effortValue() ?? assigneeDefaults().effort;

  return (
    <div
      class="nt"
      onKeyDown={onKeyDown}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(event.dataTransfer?.files ?? null);
      }}
    >
      <header class="nt-head">
        <Menu>
          <Menu.Trigger class="nt-pill" aria-label={`Project: ${project()?.name ?? "No project"}`}>
            <Show when={project()} fallback={<span class="nt-project-none" aria-hidden="true" />}>
              {(current) => <InitialsDisc name={current().name.slice(0, 1)} seed={current().id} size={18} />}
            </Show>
            {project()?.name ?? "No project"}
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Project" width={280}>
            <Menu.Item onSelect={() => setDraft("projectId", null)} hint={draft.projectId ? undefined : <Check size={14} />}>
              No project
            </Menu.Item>
            <Menu.Separator />
            <For each={openProjects(projects.data)}>
              {(item) => (
                <Menu.Item
                  onSelect={() => setDraft("projectId", item.id)}
                  icon={<InitialsDisc name={item.name.slice(0, 1)} seed={item.id} size={20} />}
                  hint={item.id === draft.projectId ? <Check size={14} /> : undefined}
                >
                  {item.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
        <span class="nt-slash" aria-hidden="true">
          /
        </span>
        <h2 class="nt-title-label disp">New task</h2>
        <button type="button" class="nt-icon nt-close" aria-label="Close" onClick={() => commands.closeNewTask()}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div class="nt-fields">
        <Menu>
          <Menu.Trigger class="nt-pill" aria-label={`Status: ${STATUS_META[draft.status].label}`}>
            <StatusCapsule status={draft.status} size="tiny" />
            {STATUS_META[draft.status].label}
          </Menu.Trigger>
          <Menu.Content label="Status" width={220}>
            <For each={STATUSES}>
              {(status) => (
                <Menu.Item
                  onSelect={() => setDraft("status", status)}
                  icon={<StatusCapsule status={status} size="row" />}
                  hint={status === draft.status ? <Check size={14} /> : undefined}
                >
                  {STATUS_META[status].label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>

        <Menu>
          <Menu.Trigger class="nt-pill" aria-label={`Priority: ${PRIORITY_META[draft.priority].label}`}>
            <PriorityBars priority={draft.priority} />
            {PRIORITY_META[draft.priority].label}
          </Menu.Trigger>
          <Menu.Content label="Priority" width={220}>
            <For each={PRIORITIES}>
              {(priority) => (
                <Menu.Item
                  onSelect={() => setDraft("priority", priority)}
                  icon={<PriorityBars priority={priority} />}
                  hint={priority === draft.priority ? <Check size={14} /> : undefined}
                >
                  {PRIORITY_META[priority].label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>

        <span class="nt-pill nt-pill--labels">
          <For each={draft.labelIds} fallback={<span class="nt-muted">Labels</span>}>
            {(id) => {
              const label = () => labels.data?.find((candidate) => candidate.id === id);
              return (
                <Show when={label()}>
                  {(found) => <LabelPill name={found().name} color={found().color} />}
                </Show>
              );
            }}
          </For>
          <Menu>
            <Menu.Trigger class="nt-icon nt-icon--small" aria-label="Add or remove labels">
              <Plus size={14} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Labels" width={240}>
              <For each={labels.data ?? []} fallback={<p class="nt-menu-note">This company has no labels yet.</p>}>
                {(label) => (
                  <Menu.CheckboxItem
                    checked={draft.labelIds.includes(label.id)}
                    onChange={(checked) =>
                      setDraft("labelIds", (list) => (checked ? [...list, label.id] : list.filter((id) => id !== label.id)))
                    }
                    icon={<i class="nt-label-dot" style={{ background: label.color }} aria-hidden="true" />}
                  >
                    {label.name}
                  </Menu.CheckboxItem>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </span>

        <Show when={has("parent")}>
          <ExtraPill field="parent" value={draft.parentId ? (draft.names[draft.parentId] ?? "Picked") : null} onRemove={() => toggleExtra("parent")}>
            {(close) => (
              <TaskPicker
                label="Parent task"
                selected={draft.parentId ? [draft.parentId] : []}
                onPick={(issue) => {
                  batch(() => {
                    setDraft("parentId", draft.parentId === issue.id ? null : issue.id);
                    setDraft("names", issue.id, taskName(issue));
                  });
                  close();
                }}
              />
            )}
          </ExtraPill>
        </Show>
        <Show when={has("goal")}>
          <GoalPill
            value={draft.goalId}
            name={draft.goalId ? draft.names[draft.goalId] : undefined}
            onPick={(goal) =>
              batch(() => {
                setDraft("goalId", goal?.id ?? null);
                if (goal) setDraft("names", goal.id, goal.title);
              })
            }
            onRemove={() => toggleExtra("goal")}
          />
        </Show>
        <Show when={has("blocked")}>
          <ExtraPill
            field="blocked"
            value={
              draft.blockedByIssueIds.length > 0
                ? draft.blockedByIssueIds.map((id) => draft.names[id] ?? "a task").join(", ")
                : null
            }
            onRemove={() => toggleExtra("blocked")}
          >
{() => (
            <TaskPicker
              label="Blocked by"
              selected={draft.blockedByIssueIds}
              excludeId={draft.parentId}
              onPick={(issue) =>
                batch(() => {
                  setDraft("blockedByIssueIds", (list) =>
                    list.includes(issue.id) ? list.filter((id) => id !== issue.id) : [...list, issue.id],
                  );
                  setDraft("names", issue.id, taskName(issue));
                })
              }
            />
            )}
          </ExtraPill>
        </Show>
        <Show when={has("billing")}>
          <ExtraPill field="billing" value={draft.billingCode.trim() || null} onRemove={() => toggleExtra("billing")}>
{() => (
            <TextInput
              aria-label="Billing code"
              placeholder="RESEARCH-OPS"
              value={draft.billingCode}
              onInput={(event) => setDraft("billingCode", event.currentTarget.value)}
              autofocus
            />
            )}
          </ExtraPill>
        </Show>
        <Show when={has("private")}>
          <span class="nt-pill nt-pill--extra">
            <Lock size={13} aria-hidden="true" />
            <span class="nt-muted">Private</span>
            <b>On</b>
            <button type="button" class="nt-icon nt-icon--small" aria-label="Remove Private" onClick={() => toggleExtra("private")}>
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        </Show>

        <Menu>
          <Menu.Trigger class="nt-pill nt-pill--quiet">
            <SlidersHorizontal size={13} aria-hidden="true" />
            More fields
          </Menu.Trigger>
          <Menu.Content label="More fields" width={300}>
            <For each={[["Plan", ["parent", "goal", "blocked"]], ["Admin", ["billing", "private"]]] as const}>
              {([title, fields]) => (
                <Menu.Group label={title}>
                  <For each={fields}>
                    {(field) => (
                      <Menu.CheckboxItem
                        checked={has(field)}
                        onChange={() => toggleExtra(field)}
                        icon={EXTRA_META[field].icon()}
                        description={EXTRA_META[field].description}
                      >
                        {EXTRA_META[field].label}
                      </Menu.CheckboxItem>
                    )}
                  </For>
                </Menu.Group>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </div>

      <div class="nt-text">
        <label class="sr-only" for="nt-title">
          Task title
        </label>
        <TextInput
          id="nt-title"
          variant="title"
          class="nt-input"
          placeholder="Task title"
          autocomplete="off"
          value={draft.title}
          onInput={(event) => setDraft("title", event.currentTarget.value)}
          autofocus
        />
        <label class="sr-only" for="nt-desc">
          Description
        </label>
        <TextArea
          id="nt-desc"
          class="nt-input nt-input--desc"
          rows={6}
          placeholder="Add a description, acceptance criteria or context."
          value={draft.description}
          onInput={(event) => setDraft("description", event.currentTarget.value)}
        />
      </div>

      <div class="nt-files">
        <For each={files()}>
          {(file, index) => (
            <span class="nt-file">
              <FileText size={12} aria-hidden="true" />
              {file.name}
              <span class="nt-muted">· {formatSize(file.size)}</span>
              <button
                type="button"
                class="nt-icon nt-icon--small"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((list) => list.filter((_, at) => at !== index()))}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
        <button type="button" class="nt-attach" onClick={() => fileInput?.click()}>
          <Paperclip size={13} aria-hidden="true" />
          Attach files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div class="nt-assign">
        <Popover open={whoOpen()} onOpenChange={setWhoOpen}>
          <Popover.Trigger
            class="nt-capsule"
            aria-label={
              draft.assignee
                ? `Assignee: ${principalName(draft.assignee)}${
                    supportsOverrides(assigneeAgent()?.adapterType)
                      ? `. Model: ${shownModel() ?? "agent default"}. Effort: ${shownEffort() ?? "agent default"}`
                      : ""
                  }`
                : "Assign the task"
            }
          >
            {principalDisc(draft.assignee)}
            <span class="nt-capsule-name">{principalName(draft.assignee) ?? "Assign"}</span>
            <Show when={assigneeAgent()}>
              {(agent) => (
                <>
                  <Capsule gradient={agentState(agent(), running()).key === "running" ? "ion" : "ash"} size="tiny" live={agentState(agent(), running()).key === "running"} />
                  <Show when={supportsOverrides(agent().adapterType)}>
                    <span class="nt-capsule-rule" aria-hidden="true" />
                    <span class="nt-capsule-run" classList={{ "nt-capsule-run--set": !!draft.model }} aria-hidden="true">
                      {shownModel() ?? "Default model"}
                    </span>
                    <Show when={shownEffort()}>
                      <span class="nt-capsule-run" classList={{ "nt-capsule-run--set": !!draft.effort }} aria-hidden="true">
                        {shownEffort()}
                      </span>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          </Popover.Trigger>
          <Popover.Content label="Assignee and run settings" width={620} hideClose class="nt-who">
            <AssigneeMenu
              agents={agentList()}
              people={personList()}
              running={running()}
              assignee={draft.assignee}
              model={draft.model}
              effort={draft.effort}
              onAssign={(next) =>
                batch(() => {
                  setDraft("assignee", next);
                  setDraft("model", null);
                  setDraft("effort", null);
                  // An assigned task is ready to work on.
                  if (next && draft.status === "backlog") setDraft("status", "todo");
                })
              }
              onModel={(model) => setDraft("model", model)}
              onEffort={(effort) => setDraft("effort", effort)}
              onDone={() => setWhoOpen(false)}
            />
          </Popover.Content>
        </Popover>

        <RolePill
          verb="Review"
          value={draft.reviewer}
          name={principalName(draft.reviewer)}
          disc={principalDisc(draft.reviewer)}
          agents={agentList()}
          people={personList()}
          onPick={(next) => setDraft("reviewer", next)}
        />
        <Show when={has("approver")}>
          <RolePill
            verb="Approve"
            value={draft.approver}
            name={principalName(draft.approver)}
            disc={principalDisc(draft.approver)}
            agents={agentList()}
            people={personList()}
            onPick={(next) => setDraft("approver", next)}
            onRemove={() => toggleExtra("approver")}
          />
        </Show>
        <Show when={has("watchdog")}>
          <RolePill
            verb="Watch"
            value={draft.watchdogAgentId ? { kind: "agent", id: draft.watchdogAgentId } : null}
            name={agentById(draft.watchdogAgentId)?.name ?? null}
            disc={principalDisc(draft.watchdogAgentId ? { kind: "agent", id: draft.watchdogAgentId } : null)}
            agents={agentList()}
            onPick={(next) => setDraft("watchdogAgentId", next?.id ?? null)}
            onRemove={() => toggleExtra("watchdog")}
          />
        </Show>

        <Menu placement="bottom-end">
          <Menu.Trigger class="nt-add-role" aria-label="Add an assignment role">
            <Plus size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Assignment roles" width={320}>
            <Menu.Group label="Add a role">
              <For each={["approver", "watchdog"] as const}>
                {(field) => (
                  <Menu.CheckboxItem
                    checked={has(field)}
                    onChange={() => toggleExtra(field)}
                    icon={EXTRA_META[field].icon()}
                    description={EXTRA_META[field].description}
                  >
                    {EXTRA_META[field].label}
                  </Menu.CheckboxItem>
                )}
              </For>
            </Menu.Group>
          </Menu.Content>
        </Menu>
      </div>

      <footer class="nt-foot">
        <ChoicePill
          label="Work mode"
          icon={<SlidersHorizontal size={13} />}
          value={draft.workMode}
          options={WORK_MODES}
          onPick={(value) => setDraft("workMode", value)}
        />
        <Show when={showWorkspace()}>
          <ChoicePill
            label="Workspace"
            icon={<GitBranch size={13} />}
            value={draft.workspace}
            options={WORKSPACES}
            onPick={(value) => setDraft("workspace", value)}
          />
        </Show>
        <ChoicePill
          label="Review policy"
          icon={<ShieldCheck size={13} />}
          value={draft.reviewPolicy}
          options={REVIEW_POLICIES}
          onPick={(value) => setDraft("reviewPolicy", value)}
        />
        <div class="nt-foot-end">
          <Show when={error()}>
            <span class="nt-error" role="alert">
              {error()}
            </span>
          </Show>
          <button type="button" class="nt-cancel" onClick={cancel}>
            Cancel
          </button>
          <div class="nt-create">
            <button type="button" class="nt-create-main" disabled={create.isPending} onClick={() => void submit(false)}>
              {create.isPending ? "Creating…" : "Create task"}
              <kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl ↵"}</kbd>
            </button>
            <Menu placement="top-end">
              <Menu.Trigger class="nt-create-more" aria-label="Create options: create and open, save draft and close" disabled={create.isPending}>
                <ChevronDown size={14} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Create options" width={240}>
                <Menu.Item onSelect={() => void submit(true)}>Create and open</Menu.Item>
                <Menu.Item onSelect={() => commands.closeNewTask()} description="Kept until you create or cancel it">
                  Save draft and close
                </Menu.Item>
              </Menu.Content>
            </Menu>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A "More fields" pill in the top row: its label, value, a picker on click, and remove. */
function ExtraPill(props: {
  field: ExtraField;
  value: string | null;
  onRemove: () => void;
  /** The picker; `close` is for single-choice fields. */
  children: (close: () => void) => JSX.Element;
}) {
  const meta = () => EXTRA_META[props.field];
  // A just-added field with no value opens its picker.
  const [open, setOpen] = createSignal(props.value === null);
  return (
    <span class="nt-pill nt-pill--extra">
      <Popover open={open()} onOpenChange={setOpen}>
        <Popover.Trigger class="nt-extra-trigger" aria-label={`${meta().label}: ${props.value ?? "none"}`}>
          <span class="nt-muted">{meta().label}</span>
          <b>{props.value ?? "Pick"}</b>
        </Popover.Trigger>
        <Popover.Content label={meta().label} width={420} hideClose>
          {props.children(() => setOpen(false))}
        </Popover.Content>
      </Popover>
      <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${meta().label}`} onClick={() => props.onRemove()}>
        <X size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

function GoalPill(props: {
  value: string | null;
  name: string | undefined;
  onPick: (goal: { id: string; title: string } | null) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(props.value === null);
  const goals = useGoalsQuery(() => open() || props.value !== null);
  const label = () => (props.value ? (goals.data?.find((goal) => goal.id === props.value)?.title ?? props.name ?? "Picked") : null);
  return (
    <span class="nt-pill nt-pill--extra">
      <Menu open={open()} onOpenChange={setOpen}>
        <Menu.Trigger class="nt-extra-trigger" aria-label={`Goal: ${label() ?? "none"}`}>
          <span class="nt-muted">Goal</span>
          <b>{label() ?? "Pick"}</b>
        </Menu.Trigger>
        <Menu.Content label="Goal" width={300}>
          <For each={goals.data ?? []} fallback={<p class="nt-menu-note">{goals.isLoading ? "Loading goals…" : "No goals yet."}</p>}>
            {(goal) => (
              <Menu.Item onSelect={() => props.onPick(goal)} hint={goal.id === props.value ? <Check size={14} /> : undefined}>
                {goal.title}
              </Menu.Item>
            )}
          </For>
        </Menu.Content>
      </Menu>
      <button type="button" class="nt-icon nt-icon--small" aria-label="Remove Goal" onClick={() => props.onRemove()}>
        <X size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

/** Reviewer, approver or watchdog: a pill that picks an agent (and, unless watchdog, a person). */
function RolePill(props: {
  verb: string;
  value: Principal | null;
  name: string | null;
  disc: JSX.Element;
  agents: Agent[];
  people?: Person[];
  onPick: (next: Principal | null) => void;
  onRemove?: () => void;
}) {
  return (
    <span class="nt-role">
      <Menu>
        <Menu.Trigger class="nt-role-trigger" aria-label={`${props.verb}: ${props.name ?? "no one"}`}>
          {props.disc}
          <span class="nt-muted">{props.verb}</span>
          <b>{props.name ?? "No one"}</b>
        </Menu.Trigger>
        <Menu.Content label={props.verb} width={280}>
          <Show when={!props.onRemove}>
            <Menu.Item onSelect={() => props.onPick(null)} hint={props.value ? undefined : <Check size={14} />}>
              No one
            </Menu.Item>
          </Show>
          <Show when={props.people?.length}>
            <Menu.Group label="People">
              <For each={props.people}>
                {(person) => (
                  <Menu.Item
                    onSelect={() => props.onPick({ kind: "user", id: person.id })}
                    icon={<InitialsDisc name={person.fullName} seed={person.id} you={person.you} size={22} />}
                    hint={props.value?.kind === "user" && props.value.id === person.id ? <Check size={14} /> : undefined}
                  >
                    {person.name}
                  </Menu.Item>
                )}
              </For>
            </Menu.Group>
          </Show>
          <Menu.Group label="Agents">
            <For each={props.agents}>
              {(agent) => (
                <Menu.Item
                  onSelect={() => props.onPick({ kind: "agent", id: agent.id })}
                  icon={<AgentAvatar agent={agent} size={24} ring={false} />}
                  hint={props.value?.kind === "agent" && props.value.id === agent.id ? <Check size={14} /> : undefined}
                >
                  {agent.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Group>
        </Menu.Content>
      </Menu>
      <Show when={props.onRemove}>
        <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${props.verb.toLowerCase()} role`} onClick={() => props.onRemove?.()}>
          <X size={13} aria-hidden="true" />
        </button>
      </Show>
    </span>
  );
}

/** A small footer pill with a menu of described choices (work mode, workspace, review policy). */
function ChoicePill<T extends string>(props: {
  label: string;
  icon: JSX.Element;
  value: T;
  options: readonly { value: T; label: string; description: string }[];
  onPick: (value: T) => void;
}) {
  const current = () => props.options.find((option) => option.value === props.value) ?? props.options[0]!;
  return (
    <Menu placement="top-start">
      <Menu.Trigger class="nt-choice" aria-label={`${props.label}: ${current().label}`}>
        {props.icon}
        {current().label}
        <ChevronDown size={12} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label={props.label} width={280}>
        <Menu.Group label={props.label}>
          <For each={props.options}>
            {(option) => (
              <Menu.Item
                onSelect={() => props.onPick(option.value)}
                description={option.description}
                hint={option.value === props.value ? <Check size={14} /> : undefined}
              >
                {option.label}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

/**
 * The assignee capsule's menu: agents and people on the left, the run's model and effort on the
 * right. It stays open until Done, since it offers several picks (design-system.md).
 */
function AssigneeMenu(props: {
  agents: Agent[];
  people: Person[];
  running: ReadonlySet<string>;
  assignee: Principal | null;
  model: string | null;
  effort: string | null;
  onAssign: (next: Principal | null) => void;
  onModel: (model: string | null) => void;
  onEffort: (effort: string | null) => void;
  onDone: () => void;
}) {
  const company = useCompany();
  const [query, setQuery] = createSignal("");
  const matches = (name: string) => name.toLowerCase().includes(query().trim().toLowerCase());
  const agent = () => (props.assignee?.kind === "agent" ? props.agents.find((candidate) => candidate.id === props.assignee!.id) : undefined);
  const overridable = () => supportsOverrides(agent()?.adapterType);
  const defaults = () => {
    const current = agent();
    return current ? agentRunDefaults(current.adapterType, current.adapterConfig) : { model: null, effort: null };
  };
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, agent()?.adapterType ?? "none"),
    queryFn: () => agentsApi.adapterModels(company().id, agent()!.adapterType),
    enabled: overridable(),
    staleTime: 5 * 60_000,
  }));
  const efforts = () => (agent() ? effortOptions(agent()!.adapterType, props.model ?? defaults().model, agent()!.adapterConfig) : []);
  const isAssignee = (kind: Principal["kind"], id: string) => props.assignee?.kind === kind && props.assignee.id === id;

  return (
    <div class="nt-who-grid">
      <div class="nt-who-list" role="listbox" aria-label="Assignee">
        <TextInput
          type="search"
          aria-label="Find an agent or person"
          placeholder="Assign to…"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          autofocus
        />
        <button type="button" class="nt-option" role="option" aria-selected={!props.assignee} onClick={() => props.onAssign(null)}>
          <span class="nt-disc-empty" style={{ width: "24px", height: "24px" }} aria-hidden="true" />
          <span class="nt-option-label">No one</span>
        </button>
        <div class="mh">Agents</div>
        <For each={props.agents.filter((candidate) => matches(candidate.name))}>
          {(candidate) => {
            const state = () => agentState(candidate, props.running);
            return (
              <button
                type="button"
                class="nt-option"
                role="option"
                aria-selected={isAssignee("agent", candidate.id)}
                onClick={() => props.onAssign({ kind: "agent", id: candidate.id })}
              >
                <AgentAvatar agent={candidate} size={24} ring={state().key === "running"} />
                <span class="nt-option-label">{candidate.name}</span>
                <span class="nt-option-state" style={{ color: state().tone }}>
                  {state().label}
                </span>
              </button>
            );
          }}
        </For>
        <Show when={props.people.some((person) => matches(person.name))}>
          <div class="mh">People</div>
          <For each={props.people.filter((person) => matches(person.name))}>
            {(person) => (
              <button
                type="button"
                class="nt-option"
                role="option"
                aria-selected={isAssignee("user", person.id)}
                onClick={() => props.onAssign({ kind: "user", id: person.id })}
              >
                <InitialsDisc name={person.fullName} seed={person.id} you={person.you} size={24} />
                <span class="nt-option-label">{person.name}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="nt-who-run">
        <Show
          when={overridable()}
          fallback={
            <p class="nt-menu-note">
              {props.assignee?.kind === "user"
                ? "People don't run on a model, so there's nothing to set here."
                : agent()
                  ? "This agent's runner doesn't take a model or effort per task. It uses its own settings."
                  : "Pick an agent to choose the model and effort for this task."}
            </p>
          }
        >
          <div role="radiogroup" aria-label="Model" class="nt-radios nt-radios--models">
            <div class="mh">Model</div>
            <button type="button" class="nt-radio" role="radio" aria-checked={props.model === null} onClick={() => props.onModel(null)}>
              <span>Agent default</span>
              <small>{defaults().model ?? "Its own setting"}</small>
            </button>
            <For each={models.data ?? []} fallback={<p class="nt-menu-note">{models.isLoading ? "Loading models…" : "No models listed."}</p>}>
              {(model) => (
                <button type="button" class="nt-radio" role="radio" aria-checked={props.model === model.id} onClick={() => props.onModel(model.id)}>
                  <span>{model.label}</span>
                  <Show when={model.label !== model.id}>
                    <small class="mono">{model.id}</small>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <div role="radiogroup" aria-label="Effort" class="nt-radios">
            <div class="mh">Effort</div>
            <button type="button" class="nt-radio" role="radio" aria-checked={props.effort === null} onClick={() => props.onEffort(null)}>
              <span>Agent default</span>
              <small>{defaults().effort ?? "Its own setting"}</small>
            </button>
            <For each={efforts()}>
              {(option) => (
                <button type="button" class="nt-radio" role="radio" aria-checked={props.effort === option.value} onClick={() => props.onEffort(option.value)}>
                  <span>{option.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <button type="button" class="nt-done" onClick={() => props.onDone()}>
          Done
        </button>
      </div>
    </div>
  );
}

