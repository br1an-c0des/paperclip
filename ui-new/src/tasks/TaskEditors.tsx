import type { Agent, CompactIssue, ExecutionWorkspace, Issue, IssueLabel, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ChevronDown, Pencil, Play, Plus, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import { agentsApi } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery, useGoalsQuery, useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextArea, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { LabelPill, PriorityBars } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { agentRunDefaults, effortOptions, supportsOverrides } from "./new-task";
import type { TaskPeople } from "./people";
import { Assignee, assigneeName } from "./people";
import { AssigneeItems, LabelItems, PriorityItems, StatusItems } from "./pickers";
import { buildPolicy, executionStatus, nextRunnableStage, readPolicy, reviewSentence, stageKeys, toggleKey, type StageType } from "./review-stages";
import {
  billingCodeEdit,
  canMarkDone,
  descriptionEdit,
  nextStatus,
  runOverrides,
  runOverridesEdit,
  runSummary,
  titleEdit,
  workspaceChoice,
  workspaceEdit,
  workspacePickerAvailable,
  type Patch,
  type WorkspaceChoice,
} from "./task-edits";
import { TaskPicker } from "./TaskPicker";
import { useTaskUpdates } from "./task-updates";
import "./TaskEditors.css";

/*
 * The editable parts of the Details section (board 2): the title, the description with an edit
 * mode, and a trigger for each property that opens the same menus the task list uses (pickers.tsx).
 * Every change goes through useTaskUpdates, so it shows at once in the open task and in every list,
 * and rolls back with a toast if the server refuses it.
 *
 * Each trigger shows its value with a small caret, so it reads as editable without hovering.
 */

/** Sends one change to a task, optimistically. Null sends nothing. */
export function useTaskChange(task: () => Issue | undefined) {
  const updates = useTaskUpdates();
  return (data: Patch | null) => {
    const current = task();
    if (!current || !data) return;
    void updates.update([{ task: current as unknown as CompactIssue, data }]);
  };
}

export type ChangeTask = ReturnType<typeof useTaskChange>;

const caret = () => <ChevronDown size={13} aria-hidden="true" class="te-caret" />;

// --- Title and description ------------------------------------------------------------------------

/** The title as a button that turns into a field. Enter or leaving the field saves; Escape cancels. */
export function TitleEditor(props: { title: string; onChange: ChangeTask; class?: string }) {
  const [editing, setEditing] = createSignal(false);
  let field: HTMLTextAreaElement | undefined;
  const finish = (save: boolean) => {
    if (!editing()) return;
    setEditing(false);
    if (save && field) props.onChange(titleEdit(props.title, field.value));
  };
  return (
    <Show
      when={editing()}
      fallback={
        <button type="button" class={`te-title ${props.class ?? ""}`} aria-label={`Title: ${props.title}. Edit the title`} onClick={() => setEditing(true)}>
          {props.title}
        </button>
      }
    >
      <TextArea
        ref={(element) => {
          field = element;
          queueMicrotask(() => {
            element.focus();
            element.select();
          });
        }}
        class={`te-title-input disp ${props.class ?? ""}`}
        aria-label="Title"
        rows={1}
        value={props.title}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </Show>
  );
}

/** The description as Markdown, with Edit for a plain Markdown field. ⌘/Ctrl+Enter saves. */
export function DescriptionEditor(props: { task: Issue; onChange: ChangeTask }) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const text = () => props.task.description ?? "";
  const start = () => {
    setDraft(text());
    setEditing(true);
  };
  const save = () => {
    props.onChange(descriptionEdit(props.task.description, draft()));
    setEditing(false);
  };
  // Another task opened in the same place ends the edit.
  createEffect(on(() => props.task.id, () => setEditing(false), { defer: true }));

  return (
    <Show
      when={editing()}
      fallback={
        <div class="te-desc">
          <Show
            when={text().trim()}
            fallback={
              <button type="button" class="te-desc-empty" onClick={start}>
                <Plus size={14} aria-hidden="true" />
                Add a description
              </button>
            }
          >
            {(source) => (
              <>
                <Markdown source={source()} />
                <button
                  type="button"
                  class="btn btn--icon btn--ghost btn--compact te-desc-edit"
                  aria-label="Edit the description"
                  title="Edit the description"
                  disabled={props.task.descriptionTruncated === true}
                  onClick={start}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </>
            )}
          </Show>
        </div>
      }
    >
      <div class="te-desc-form">
        <TextArea
          ref={(element) => queueMicrotask(() => element.focus())}
          aria-label="Description, in Markdown"
          class="te-desc-input"
          rows={8}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <div class="te-desc-actions">
          <span class="te-hint">Markdown. ⌘↵ saves, Esc cancels.</span>
          <Button variant="quiet" size="compact" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="compact" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Show>
  );
}

// --- Status, priority, labels -----------------------------------------------------------------------

const STATUS_TONE: Record<IssueStatus, string> = {
  in_progress: "run",
  in_review: "violet",
  todo: "amber",
  blocked: "red",
  backlog: "neutral",
  done: "green",
  cancelled: "neutral",
};

/** Board 2's status control: the status pill opens the menu, ▸ moves it one step on, ✓ marks it done. */
export function StatusControl(props: { status: IssueStatus; onChange: ChangeTask }) {
  const next = () => nextStatus(props.status);
  return (
    <span class="te-status-row">
      <span class="te-status" data-tone={STATUS_TONE[props.status]}>
        <Menu>
          <Menu.Trigger class="te-status-main" aria-label={`Status: ${STATUS_META[props.status].label}. Change status`}>
            {STATUS_META[props.status].label}
          </Menu.Trigger>
          <Menu.Content label="Status" width={220}>
            <StatusItems current={props.status} onPick={(status) => status !== props.status && props.onChange({ status })} />
          </Menu.Content>
        </Menu>
        <Show when={next()}>
          {(step) => (
            <button
              type="button"
              class="te-status-step"
              aria-label={`Move to ${STATUS_META[step()].label}`}
              title={`Move to ${STATUS_META[step()].label}`}
              onClick={() => props.onChange({ status: step() })}
            >
              <Play size={10} fill="currentColor" aria-hidden="true" />
            </button>
          )}
        </Show>
      </span>
      <Show when={canMarkDone(props.status) && props.status !== "in_review"}>
        <button type="button" class="te-done" aria-label="Mark done" title="Mark done" onClick={() => props.onChange({ status: "done" })}>
          <Check size={14} aria-hidden="true" />
        </button>
      </Show>
    </span>
  );
}

export function PriorityControl(props: { priority: IssuePriority; onChange: ChangeTask }) {
  return (
    <Menu>
      <Menu.Trigger class="te-trigger" aria-label={`Priority: ${props.priority}. Change priority`}>
        <PriorityBars priority={props.priority} withLabel />
        {caret()}
      </Menu.Trigger>
      <Menu.Content label="Priority" width={200}>
        <PriorityItems current={props.priority} onPick={(priority) => priority !== props.priority && props.onChange({ priority })} />
      </Menu.Content>
    </Menu>
  );
}

export function LabelsControl(props: { task: Issue; onChange: ChangeTask }) {
  const ids = () => props.task.labelIds ?? (props.task.labels ?? []).map((label) => label.id);
  const [creating, setCreating] = createSignal(false);
  return (
    <span class="te-labels">
      <For each={props.task.labels ?? []}>
        {(label) => (
          <span class="te-label">
            <LabelPill name={label.name} color={label.color} />
            <button
              type="button"
              class="te-x"
              aria-label={`Remove the label ${label.name}`}
              onClick={() => props.onChange({ labelIds: ids().filter((id) => id !== label.id) })}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        )}
      </For>
      <Menu>
        <Menu.Trigger class="te-add" aria-label="Add a label">
          <Plus size={14} aria-hidden="true" />
          <Show when={(props.task.labels ?? []).length === 0}>Add label</Show>
        </Menu.Trigger>
        <Menu.Content label="Labels" width={240}>
          <LabelItems
            checked={(id) => ids().includes(id)}
            onChange={(id, on) => props.onChange({ labelIds: on ? [...ids(), id] : ids().filter((each) => each !== id) })}
          />
          <Menu.Separator />
          <Menu.Item icon={<Plus size={15} />} onSelect={() => setCreating(true)}>
            New label…
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <NewLabelDialog open={creating()} onClose={() => setCreating(false)} onCreated={(id) => props.onChange({ labelIds: [...ids(), id] })} />
    </span>
  );
}

const LABEL_COLORS = ["#6366f1", "#22b5a5", "#f5822a", "#f2286f", "#8b2cf0", "#2fd12f"];

/** A new company label (`POST /companies/:id/labels`), added to the task once it exists. */
function NewLabelDialog(props: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [name, setName] = createSignal("");
  const [color, setColor] = createSignal(LABEL_COLORS[0]!);
  const [busy, setBusy] = createSignal(false);
  const close = () => {
    setName("");
    props.onClose();
  };
  const create = async () => {
    const trimmed = name().trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const created = await taskActionsApi.createLabel(company().id, { name: trimmed, color: color() });
      client.setQueryData<IssueLabel[]>(queryKeys.issues.labels(company().id), (current) =>
        current?.some((label) => label.id === created.id) ? current : [...(current ?? []), created],
      );
      void client.invalidateQueries({ queryKey: queryKeys.issues.labels(company().id) });
      props.onCreated(created.id);
      close();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't create the label", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && close()}
      title="New label"
      width={420}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy() || !name().trim()} onClick={() => void create()}>
            {busy() ? "Creating…" : "Create and add"}
          </Button>
        </>
      }
    >
      <form
        class="te-row"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input type="color" class="te-color" aria-label="Label color" value={color()} onInput={(event) => setColor(event.currentTarget.value)} />
        <TextInput aria-label="Label name" placeholder="Label name" value={name()} onInput={(event) => setName(event.currentTarget.value)} autofocus />
      </form>
    </Dialog>
  );
}

// --- Assignee, model and effort -------------------------------------------------------------------

function assigneeKey(task: Pick<Issue, "assigneeAgentId" | "assigneeUserId">) {
  if (task.assigneeAgentId) return `agent:${task.assigneeAgentId}`;
  if (task.assigneeUserId) return `user:${task.assigneeUserId}`;
  return "none";
}

/**
 * The assignee menu, and for agents whose runner takes them, the task's model and effort (decisions 7
 * and 13). While an agent's run is going, the menu says so, and handing the task to someone else
 * asks first: the server stops the run when the assignee changes (ui/src/lib/interrupt-handoff.ts).
 */
export function AssigneeControl(props: { task: Issue; people: TaskPeople; onChange: ChangeTask }) {
  const liveRuns = useLiveRunsQuery();
  const agent = () => props.people.agent(props.task.assigneeAgentId);
  const running = createMemo(() => (liveRuns.data ?? []).find((run) => run.issueId === props.task.id && run.status === "running"));
  const [pending, setPending] = createSignal<{ agentId: string | null; userId: string | null } | null>(null);
  const pick = (next: { agentId: string | null; userId: string | null }) => {
    if (next.agentId === props.task.assigneeAgentId && next.userId === props.task.assigneeUserId) return;
    if (running()) setPending(next);
    else props.onChange({ assigneeAgentId: next.agentId, assigneeUserId: next.userId });
  };
  const pendingName = () => {
    const next = pending();
    if (!next) return "";
    return assigneeName({ assigneeAgentId: next.agentId, assigneeUserId: next.userId }, props.people);
  };
  return (
    <span class="te-assignee">
      <Menu>
        <Menu.Trigger class="te-trigger" aria-label={`Assignee: ${assigneeName(props.task, props.people)}. Change assignee`}>
          <Assignee task={props.task} people={props.people} size={20} />
          {caret()}
        </Menu.Trigger>
        <Menu.Content label="Assignee" width={260}>
          <Show when={running()}>
            {(run) => <p class="te-running-note">{run().agentName ?? "An agent"} is running. Changing the assignee stops this run.</p>}
          </Show>
          <AssigneeItems people={props.people} current={assigneeKey(props.task)} onPick={(next) => pick({ agentId: next.agentId, userId: next.userId })} />
        </Menu.Content>
      </Menu>
      <Show when={agent()}>{(found) => <RunSettings task={props.task} agent={found()} onChange={props.onChange} />}</Show>
      <ConfirmDialog
        open={pending() !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Stop the current run?"
        body={
          <>
            {running()?.agentName ?? "The agent"} is working on this task. Assigning it to {pendingName()} stops that run.
          </>
        }
        confirmLabel="Stop and reassign"
        danger
        onConfirm={() => {
          const next = pending();
          if (next) props.onChange({ assigneeAgentId: next.agentId, assigneeUserId: next.userId });
        }}
      />
    </span>
  );
}

/** "· Opus 5.5, high effort" beside the assignee; it opens the model and effort choices. */
function RunSettings(props: { task: Issue; agent: Agent; onChange: ChangeTask }) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  const overridable = () => supportsOverrides(props.agent.adapterType);
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, props.agent.adapterType),
    queryFn: () => agentsApi.adapterModels(company().id, props.agent.adapterType),
    enabled: overridable(),
    staleTime: 5 * 60_000,
  }));
  const label = (id: string) => models.data?.find((model) => model.id === id)?.label ?? id;
  const current = () => runOverrides(props.task);
  const defaults = () => agentRunDefaults(props.agent.adapterType, props.agent.adapterConfig ?? {});
  const efforts = () => effortOptions(props.agent.adapterType, current().model ?? defaults().model);
  const summary = () => runSummary(props.task, label);
  const set = (change: { model?: string | null; effort?: string | null; chrome?: boolean }) => props.onChange(runOverridesEdit(props.task, props.agent, change));
  const overridden = () => props.task.assigneeAdapterOverrides != null;

  return (
    <Show when={overridable()} fallback={<Show when={summary()}>{(text) => <span class="te-muted">· {text()}</span>}</Show>}>
      <Popover open={open()} onOpenChange={setOpen}>
        <Popover.Trigger class="te-trigger te-trigger--muted" aria-label={`Model and effort: ${summary() ?? "agent default"}. Change`}>
          · {summary() ?? "Agent default model"}
          {caret()}
        </Popover.Trigger>
        <Popover.Content label="Model and effort for this task" width={440} hideClose>
          <div class="te-run">
            <div role="radiogroup" aria-label="Model" class="te-radios te-radios--models">
              <div class="mh">Model</div>
              <button type="button" class="te-radio" role="radio" aria-checked={current().model === null} onClick={() => set({ model: null })}>
                <span>Agent default</span>
                <small>{defaults().model ? label(defaults().model!) : "Its own setting"}</small>
              </button>
              <For each={models.data ?? []} fallback={<p class="te-note">{models.isLoading ? "Loading models…" : "No models listed."}</p>}>
                {(model) => (
                  <button type="button" class="te-radio" role="radio" aria-checked={current().model === model.id} onClick={() => set({ model: model.id })}>
                    <span>{model.label}</span>
                    <Show when={model.label !== model.id}>
                      <small class="mono">{model.id}</small>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div role="radiogroup" aria-label="Effort" class="te-radios">
              <div class="mh">Effort</div>
              <button type="button" class="te-radio" role="radio" aria-checked={current().effort === null} onClick={() => set({ effort: null })}>
                <span>Agent default</span>
                <small>{defaults().effort ?? "Its own setting"}</small>
              </button>
              <For each={efforts()}>
                {(option) => (
                  <button type="button" class="te-radio" role="radio" aria-checked={current().effort === option.value} onClick={() => set({ effort: option.value })}>
                    <span>{option.label}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={props.agent.adapterType === "claude_local"}>
            <div class="te-run-switch">
              <Switch
                checked={current().chrome}
                label="Browser access"
                description="Claude can use Chrome on this task (--chrome)."
                onChange={(on) => set({ chrome: on })}
              />
            </div>
          </Show>
          <div class="te-pop-foot">
            <span class="te-hint">For this task only. The agent keeps its own settings.</span>
            <Show when={overridden()}>
              <Button variant="quiet" size="compact" onClick={() => props.onChange({ assigneeAdapterOverrides: null })}>
                Use the agent's settings
              </Button>
            </Show>
            <Button variant="primary" size="compact" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Popover.Content>
      </Popover>
    </Show>
  );
}

// --- Review and approval ----------------------------------------------------------------------------

type Person = { key: string; name: string; disc: JSX.Element };

/** You, the task's requester, the company's other people, then agents: who can review or approve. */
function useParticipants(task: () => Issue, people: TaskPeople) {
  return createMemo<Person[]>(() => {
    const list: Person[] = [];
    const you = people.youId();
    if (you) list.push({ key: `user:${you}`, name: "You", disc: <InitialsDisc name="You" seed={you} size={20} you /> });
    const requester = task().createdByUserId;
    if (requester && requester !== you) {
      list.push({ key: `user:${requester}`, name: people.personName(requester), disc: <InitialsDisc name={people.personName(requester)} seed={requester} size={20} /> });
    }
    for (const person of people.otherPeople()) {
      if (person.id === requester) continue;
      list.push({ key: `user:${person.id}`, name: person.name, disc: <InitialsDisc name={person.name} seed={person.id} size={20} /> });
    }
    for (const agent of people.assignableAgents()) {
      list.push({ key: `agent:${agent.id}`, name: agent.name, disc: <AgentAvatar agent={agent} size={20} /> });
    }
    return list;
  });
}

/** Names a stage participant the way the sentence needs: "You", an agent, a person. */
export function participantName(people: TaskPeople) {
  return (key: string) => {
    const id = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("agent:")) return people.agent(id)?.name ?? `Agent ${id.slice(0, 6)}`;
    return id === people.youId() ? "You" : people.personName(id);
  };
}

/**
 * Board 2's Review row: who reviews and approves before the task is done, in a sentence, with where
 * the stages stand. It opens the stage editor: a tab each for reviewers and approvers, each a list of
 * people and agents to tick, as the old panel's Reviewers and Approvers pickers.
 */
export function ReviewControl(props: { task: Issue; people: TaskPeople; onChange: ChangeTask }) {
  const [tab, setTab] = createSignal<StageType>("review");
  const [query, setQuery] = createSignal("");
  const nameOf = participantName(props.people);
  const readable = () => readPolicy(props.task.executionPolicy).ok;
  const reviewers = () => stageKeys(props.task.executionPolicy, "review");
  const approvers = () => stageKeys(props.task.executionPolicy, "approval");
  const sentence = () => reviewSentence(props.task.executionPolicy, nameOf);
  const status = () => executionStatus(props.task.executionState, nameOf);
  const runnable = () => nextRunnableStage(props.task.executionPolicy, props.task.executionState);
  const participants = useParticipants(() => props.task, props.people);
  const first = () => [...reviewers(), ...approvers()][0];
  const firstDisc = () => participants().find((person) => person.key === first())?.disc;
  const matches = () => participants().filter((person) => person.name.toLowerCase().includes(query().trim().toLowerCase()));
  const keys = () => (tab() === "review" ? reviewers() : approvers());
  const save = (nextReviewers: string[], nextApprovers: string[]) => {
    try {
      props.onChange({ executionPolicy: buildPolicy(props.task.executionPolicy, nextReviewers, nextApprovers) });
    } catch {
      // readable() already keeps the editor closed for a policy that can't be read.
    }
  };
  const toggle = (key: string) =>
    tab() === "review" ? save(toggleKey(reviewers(), key), approvers()) : save(reviewers(), toggleKey(approvers(), key));
  const clear = () => (tab() === "review" ? save([], approvers()) : save(reviewers(), []));

  return (
    <span class="te-review">
      <Show when={readable()} fallback={<span class="te-muted">These review stages can't be read here. Refresh to try again.</span>}>
        <Popover onOpenChange={(open) => !open && setQuery("")}>
          <Popover.Trigger class="te-trigger te-trigger--wrap" aria-label={`Review: ${sentence() ?? "none"}. Change who reviews and approves`}>
            <Show when={firstDisc()}>{(disc) => disc()}</Show>
            <span>{sentence() ?? "No review before done"}</span>
            {caret()}
          </Popover.Trigger>
          <Popover.Content label="Review and approval" width={340} hideClose>
            <div class="te-stage-tabs" role="group" aria-label="Stage">
              <button type="button" aria-pressed={tab() === "review"} onClick={() => setTab("review")}>
                Reviewers{reviewers().length > 0 ? ` · ${reviewers().length}` : ""}
              </button>
              <button type="button" aria-pressed={tab() === "approval"} onClick={() => setTab("approval")}>
                Approvers{approvers().length > 0 ? ` · ${approvers().length}` : ""}
              </button>
            </div>
            <p class="te-note">
              {tab() === "review"
                ? "When the task is done, one of these reviews it first."
                : "After any review, one of these approves it before it closes."}
            </p>
            <div class="te-list">
              <TextInput type="search" aria-label="Find a person or agent" placeholder="Find a person or agent" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
              <button type="button" class="te-option" role="checkbox" aria-checked={keys().length === 0} onClick={clear}>
                <span class="pick-none" aria-hidden="true" />
                <span class="te-option-label">{tab() === "review" ? "No reviewers" : "No approvers"}</span>
              </button>
              <For each={matches()}>
                {(person) => (
                  <button type="button" class="te-option" role="checkbox" aria-checked={keys().includes(person.key)} onClick={() => toggle(person.key)}>
                    {person.disc}
                    <span class="te-option-label">{person.name}</span>
                    <Show when={keys().includes(person.key)}>
                      <Check size={14} aria-hidden="true" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Popover.Content>
        </Popover>
        <Show when={status()}>{(text) => <span class="te-muted">{text()}</span>}</Show>
        <Show when={runnable()}>
          {(stage) => (
            <button type="button" class="te-chip" onClick={() => props.onChange({ status: "in_review" })}>
              {stage() === "review" ? "Run review now" : "Run approval now"}
            </button>
          )}
        </Show>
      </Show>
    </span>
  );
}

// --- Project, parent, goal, billing code, workspace ----------------------------------------------

export function ProjectControl(props: { task: Issue; onChange: ChangeTask }) {
  const projects = useProjectsQuery();
  const project = () => props.task.project ?? projects.data?.find((candidate) => candidate.id === props.task.projectId) ?? null;
  return (
    <Menu>
      <Menu.Trigger class="te-trigger" aria-label={`Project: ${project()?.name ?? "none"}. Change project`}>
        <Show when={project()} fallback={<span class="te-muted">None</span>}>
          {(found) => (
            <>
              <InitialsDisc name={found().name.slice(0, 1)} seed={found().id} size={18} />
              {found().name}
            </>
          )}
        </Show>
        {caret()}
      </Menu.Trigger>
      <Menu.Content label="Project" width={260}>
        <For each={openProjects(projects.data)} fallback={<Menu.Item disabled>{projects.isLoading ? "Loading projects…" : "No projects yet"}</Menu.Item>}>
          {(candidate) => (
            <Menu.Item
              icon={<InitialsDisc name={candidate.name.slice(0, 1)} seed={candidate.id} size={18} />}
              hint={candidate.id === props.task.projectId ? <Check size={14} /> : undefined}
              onSelect={() => candidate.id !== props.task.projectId && props.onChange({ projectId: candidate.id })}
            >
              {candidate.name}
            </Menu.Item>
          )}
        </For>
        <Menu.Separator />
        <Menu.Item hint={props.task.projectId ? undefined : <Check size={14} />} onSelect={() => props.task.projectId && props.onChange({ projectId: null })}>
          No project
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

export function GoalControl(props: { task: Issue; onChange: ChangeTask }) {
  const [open, setOpen] = createSignal(false);
  const goals = useGoalsQuery(() => open());
  return (
    <Menu open={open()} onOpenChange={setOpen}>
      <Menu.Trigger class="te-trigger" aria-label={`Goal: ${props.task.goal?.title ?? "none"}. Change goal`}>
        <Show when={props.task.goal} fallback={<span class="te-muted">None</span>}>
          {(goal) => <span class="te-ellipsis">{goal().title}</span>}
        </Show>
        {caret()}
      </Menu.Trigger>
      <Menu.Content label="Goal" width={300}>
        <For each={goals.data ?? []} fallback={<Menu.Item disabled>{goals.isLoading ? "Loading goals…" : "No goals yet"}</Menu.Item>}>
          {(goal) => (
            <Menu.Item hint={goal.id === props.task.goalId ? <Check size={14} /> : undefined} onSelect={() => goal.id !== props.task.goalId && props.onChange({ goalId: goal.id })}>
              {goal.title}
            </Menu.Item>
          )}
        </For>
        <Menu.Separator />
        <Menu.Item hint={props.task.goalId ? undefined : <Check size={14} />} onSelect={() => props.task.goalId && props.onChange({ goalId: null })}>
          No goal
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

/** The parent task: a search to pick one, and Remove. */
export function ParentControl(props: { task: Issue; onOpenTask: (task: { id: string; identifier: string | null }) => void; onChange: ChangeTask }) {
  const [open, setOpen] = createSignal(false);
  const parent = () => (props.task.parentId ? props.task.ancestors?.find((ancestor) => ancestor.id === props.task.parentId) : undefined);
  return (
    <span class="te-inline">
      <Show when={parent()}>
        {(found) => (
          <button type="button" class="td-link" onClick={() => props.onOpenTask(found())}>
            <span class="mono td-id">{found().identifier}</span>
            <span class="te-ellipsis">{found().title}</span>
          </button>
        )}
      </Show>
      <Popover open={open()} onOpenChange={setOpen}>
        <Popover.Trigger class={parent() ? "te-trigger te-trigger--icon" : "te-trigger"} aria-label={parent() ? "Change the parent task" : "Pick a parent task"}>
          <Show when={parent()} fallback={<span class="te-muted">None</span>}>
            <Pencil size={13} aria-hidden="true" />
          </Show>
          <Show when={!parent()}>{caret()}</Show>
        </Popover.Trigger>
        <Popover.Content label="Parent task" width={420} hideClose>
          <TaskPicker
            label="Parent task"
            selected={props.task.parentId ? [props.task.parentId] : []}
            excludeId={props.task.id}
            onPick={(picked) => {
              setOpen(false);
              if (picked.id !== props.task.parentId) props.onChange({ parentId: picked.id });
            }}
          />
          <Show when={props.task.parentId}>
            <div class="te-pop-foot">
              <Button
                variant="quiet"
                size="compact"
                onClick={() => {
                  setOpen(false);
                  props.onChange({ parentId: null });
                }}
              >
                Remove the parent
              </Button>
            </div>
          </Show>
        </Popover.Content>
      </Popover>
    </span>
  );
}

export function BillingControl(props: { task: Issue; onChange: ChangeTask }) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const save = () => {
    props.onChange(billingCodeEdit(props.task.billingCode, draft()));
    setOpen(false);
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (next) setDraft(props.task.billingCode ?? "");
        setOpen(next);
      }}
    >
      <Popover.Trigger class="te-trigger" aria-label={`Billing code: ${props.task.billingCode ?? "none"}. Change`}>
        <Show when={props.task.billingCode} fallback={<span class="te-muted">None</span>}>
          {(code) => <span class="mono">{code()}</span>}
        </Show>
        {caret()}
      </Popover.Trigger>
      <Popover.Content label="Billing code" width={320} hideClose>
        <form
          class="te-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextInput aria-label="Billing code" placeholder="Such as OPS-12" value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} autofocus />
          <p class="te-note">Costs of this task's runs are reported under this code.</p>
          <div class="te-pop-foot">
            <Button variant="quiet" size="compact" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="compact" type="submit">
              Save
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover>
  );
}

const WORKSPACE_MODES: Record<string, string> = {
  shared_workspace: "shared workspace",
  isolated_workspace: "isolated worktree",
  operator_branch: "operator branch",
  adapter_managed: "managed by the adapter",
  cloud_sandbox: "cloud sandbox",
};

const CHOICE_LABEL: Record<WorkspaceChoice, string> = {
  default: "Project default",
  isolated: "New isolated workspace",
  reuse: "Reuse a workspace",
};

/** What the task runs in now: the workspace's branch or name and its kind. */
export function WorkspaceValue(props: { workspace: ExecutionWorkspace }) {
  return (
    <span class="te-inline">
      <span class="mono te-ellipsis">{props.workspace.branchName ?? props.workspace.name}</span>
      <span class="te-muted">{WORKSPACE_MODES[props.workspace.mode] ?? props.workspace.mode.replace(/_/g, " ")}</span>
    </span>
  );
}

/**
 * Where the task runs. When the instance and the project have execution workspaces on, a menu moves
 * it to the project's default, a new isolated workspace, or one it reuses; otherwise it just shows
 * the workspace.
 */
export function WorkspaceControl(props: { task: Issue; onChange: ChangeTask }) {
  const company = useCompany();
  const settings = useExperimentalSettingsQuery();
  const projects = useProjectsQuery();
  const [open, setOpen] = createSignal(false);
  const project = () => props.task.project ?? projects.data?.find((candidate) => candidate.id === props.task.projectId) ?? null;
  const available = () => workspacePickerAvailable(project(), settings.data?.enableIsolatedWorkspaces === true);
  const choice = () => workspaceChoice(props.task);
  const reusable = createQuery(() => ({
    queryKey: [...queryKeys.issues.section(props.task.id, "reusable-workspaces"), props.task.projectId ?? ""],
    queryFn: ({ signal }) =>
      taskActionsApi.reusableWorkspaces(company().id, { projectId: props.task.projectId!, projectWorkspaceId: props.task.projectWorkspaceId }, signal),
    enabled: open() && available() && !!props.task.projectId,
  }));
  const pick = (next: WorkspaceChoice, workspace?: ExecutionWorkspace) => props.onChange(workspaceEdit(next, workspace));
  const value = () => (
    <Show when={props.task.currentExecutionWorkspace} fallback={<span class="te-muted">{available() ? CHOICE_LABEL[choice()] : "None"}</span>}>
      {(workspace) => <WorkspaceValue workspace={workspace()} />}
    </Show>
  );

  return (
    <Show when={available()} fallback={value()}>
      <Menu open={open()} onOpenChange={setOpen}>
        <Menu.Trigger class="te-trigger" aria-label={`Workspace: ${CHOICE_LABEL[choice()]}. Change`}>
          {value()}
          {caret()}
        </Menu.Trigger>
        <Menu.Content label="Workspace" width={320}>
          <Menu.Item
            description="Whatever the project sets"
            hint={choice() === "default" ? <Check size={14} /> : undefined}
            onSelect={() => choice() !== "default" && pick("default")}
          >
            {CHOICE_LABEL.default}
          </Menu.Item>
          <Menu.Item
            description="A fresh worktree for this task"
            hint={choice() === "isolated" ? <Check size={14} /> : undefined}
            onSelect={() => choice() !== "isolated" && pick("isolated")}
          >
            {CHOICE_LABEL.isolated}
          </Menu.Item>
          <Menu.Group label="Reuse a workspace">
            <For
              each={reusable.data ?? []}
              fallback={<Menu.Item disabled>{reusable.isLoading ? "Loading workspaces…" : "None to reuse"}</Menu.Item>}
            >
              {(workspace) => (
                <Menu.Item
                  description={WORKSPACE_MODES[workspace.mode] ?? workspace.mode}
                  hint={choice() === "reuse" && props.task.executionWorkspaceId === workspace.id ? <Check size={14} /> : undefined}
                  onSelect={() => props.task.executionWorkspaceId !== workspace.id && pick("reuse", workspace)}
                >
                  {workspace.branchName ?? workspace.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Group>
        </Menu.Content>
      </Menu>
    </Show>
  );
}

/** Add a blocker: a task search; the picked task goes into the task's blockers. */
export function AddBlocker(props: { task: Issue; selected: readonly string[]; onPick: (id: string) => void }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <Popover.Trigger class="te-add te-add--row">
        <Plus size={14} aria-hidden="true" />
        Add a blocker
      </Popover.Trigger>
      <Popover.Content label="Blocked by" width={420} hideClose>
        <TaskPicker
          label="Blocked by"
          selected={props.selected}
          excludeId={props.task.id}
          onPick={(picked) => {
            setOpen(false);
            props.onPick(picked.id);
          }}
        />
      </Popover.Content>
    </Popover>
  );
}
