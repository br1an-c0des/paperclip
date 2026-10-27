import type { EnvBinding, RoutineDetail, RoutineTrigger, RoutineVariable } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  Braces,
  CalendarClock,
  Check,
  Ellipsis,
  Flag,
  Folder,
  FolderKanban,
  GitBranch,
  KeyRound,
  Plus,
  Target,
  User,
  Webhook,
  X,
} from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch as Branch, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi } from "@/api/routines";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useGoalsQuery, useProjectsQuery } from "@/lib/company-data";
import { copyText } from "@/tasks/TaskActions";
import { TaskPicker, taskName } from "@/tasks/TaskPicker";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { Capsule, PriorityBars } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { PRIORITY_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { ConnectWebhookDialog, type ConnectTarget } from "./ConnectWebhook";
import { refreshRecurring, useRoutineFoldersQuery } from "./queries";
import {
  BUILT_IN_INPUTS,
  builtInsUsed,
  CATCH_UP_LABEL,
  nextLabel,
  placeholderSegments,
  VARIABLE_TYPE_LABEL,
} from "./recurring-model";
import { InfoTip, ScheduleFields } from "./RepeatMenu";
import { cronProblem, defaultRepeat, describeCron, formatFire, OPEN_POLICIES, repeatFromCron, scheduleCron, timeZoneLabel, type RepeatDraft } from "./schedule";
import { triggerState, webhookSender } from "./webhook";

/*
 * The recurring task's Details (board R2), edited in place:
 *
 * - On or paused, and the next run; archived ones say so.
 * - Title and properties: assignee (agents only), project, priority, goal, parent task, folder.
 * - The description, with its `{{placeholders}}` as chips.
 * - Triggers: each schedule, webhook and API trigger with a switch and when it last fired; a
 *   schedule edits with the Repeat menu's fields, a webhook copies its URL and rotates its secret
 *   (the new one is shown once), and one still being set up finishes in the connect dialog (N7).
 *   Add trigger offers the three kinds.
 * - Inputs: the placeholders' type, default and whether they're required, plus the built-ins the
 *   text uses. The server keeps one input per placeholder, so inputs come from the text.
 * - Secrets: the company secrets bound into each run's environment.
 * - Run policy: if the last one is still open, missed runs, and "Only when something changed" (in
 *   this project or anywhere), which only applies to schedules.
 *
 * Each change is its own `PATCH /routines/:id` (or trigger request), as the old detail page's
 * switches are; the server keeps a revision for each (History, R4).
 */

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

type Save = (patch: Record<string, unknown>, failed: string) => Promise<boolean>;

export function RecurringDetails(props: { routine: RoutineDetail; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const on = () => props.routine.status === "active";
  const archived = () => props.routine.status === "archived";

  const save: Save = async (patch, failed) => {
    try {
      await routinesApi.update(props.routine.id, patch);
      return true;
    } catch (error) {
      pushToast({ tone: "error", title: failed, body: error instanceof Error ? error.message : undefined });
      return false;
    } finally {
      refreshRecurring(client, company().id);
    }
  };

  return (
    <div class="td-main rpn-details">
      <div class="rpn-state">
        <Show
          when={!archived()}
          fallback={
            <span class="rpn-archived">
              Archived: it doesn't run.
              <Button size="compact" onClick={() => void save({ status: "paused" }, "Couldn't restore it")}>
                Restore
              </Button>
            </span>
          }
        >
          <Switch
            label={on() ? "Active" : "Paused"}
            checked={on()}
            onChange={(next) => void save({ status: next ? "active" : "paused" }, next ? "Couldn't turn it on" : "Couldn't pause it")}
          />
          <span class="rpn-next">
            {on() ? nextLabel(props.routine, props.routine.triggers).replace(/^Next /, "Next run ") : "No runs until you turn it back on"}
          </span>
        </Show>
      </div>
      <TitleField routine={props.routine} save={save} />
      <Properties routine={props.routine} save={save} onOpenTask={props.onOpenTask} />
      <Description routine={props.routine} save={save} />
      <Triggers routine={props.routine} />
      <Inputs routine={props.routine} save={save} />
      <Secrets routine={props.routine} save={save} />
      <RunPolicy routine={props.routine} save={save} />
    </div>
  );
}

function TitleField(props: { routine: RoutineDetail; save: Save }) {
  let input: HTMLInputElement | undefined;
  const commit = () => {
    const next = input?.value.trim() ?? "";
    if (!next || next === props.routine.title) {
      if (input) input.value = props.routine.title;
      return;
    }
    void props.save({ title: next }, "Couldn't rename it");
  };
  return (
    <TextInput
      ref={input}
      variant="title"
      class="rpn-title"
      aria-label="Title"
      value={props.routine.title}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.currentTarget.value = props.routine.title;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Prop(props: { icon: JSX.Element; label: string; children: JSX.Element }) {
  return (
    <>
      <dt>
        <span aria-hidden="true">{props.icon}</span>
        {props.label}
      </dt>
      <dd>{props.children}</dd>
    </>
  );
}

function Properties(props: { routine: RoutineDetail; save: Save; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const [goalsWanted, setGoalsWanted] = createSignal(false);
  const goals = useGoalsQuery(() => goalsWanted() || props.routine.goalId !== null);
  const folders = useRoutineFoldersQuery();
  const [parentOpen, setParentOpen] = createSignal(false);
  const agentList = createMemo(() => activeAgents(agents.data));
  const agent = () => agents.data?.find((candidate) => candidate.id === props.routine.assigneeAgentId);
  const project = () => projects.data?.find((candidate) => candidate.id === props.routine.projectId);
  const goal = () => goals.data?.find((candidate) => candidate.id === props.routine.goalId);
  const folder = () => folders.data?.folders.find((candidate) => candidate.id === props.routine.folderId);
  const priority = () => (props.routine.priority in PRIORITY_META ? (props.routine.priority as (typeof PRIORITIES)[number]) : "medium");
  const move = async (folderId: string | null) => {
    try {
      await routinesApi.moveToFolder(company().id, props.routine.id, folderId);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't move it", body: error instanceof Error ? error.message : undefined });
    } finally {
      refreshRecurring(client, company().id);
    }
  };

  return (
    <dl class="td-props">
      <Prop icon={<User size={15} />} label="Assignee">
        <Menu>
          <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Assignee: ${agent()?.name ?? "no one"}. Change assignee`}>
            <Show when={agent()} fallback={<span class="rpn-muted">No agent: it stays paused</span>}>
              {(found) => (
                <>
                  <AgentAvatar agent={found()} size={20} ring={false} />
                  {found().name}
                </>
              )}
            </Show>
          </Menu.Trigger>
          <Menu.Content label="Assignee" width={260}>
            <For each={agentList()}>
              {(candidate) => (
                <Menu.Item
                  icon={<AgentAvatar agent={candidate} size={20} ring={false} />}
                  hint={candidate.id === props.routine.assigneeAgentId ? <Check size={14} /> : undefined}
                  onSelect={() => void props.save({ assigneeAgentId: candidate.id }, "Couldn't reassign it")}
                >
                  {candidate.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </Prop>
      <Prop icon={<FolderKanban size={15} />} label="Project">
        <Menu>
          <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Project: ${project()?.name ?? "none"}. Change project`}>
            <Show when={project()} fallback={<span class="rpn-muted">No project</span>}>
              {(found) => (
                <>
                  <InitialsDisc name={found().name.slice(0, 1)} seed={found().id} size={18} />
                  {found().name}
                </>
              )}
            </Show>
          </Menu.Trigger>
          <Menu.Content label="Project" width={260}>
            <Menu.Item hint={props.routine.projectId ? undefined : <Check size={14} />} onSelect={() => void props.save({ projectId: null }, "Couldn't change the project")}>
              No project
            </Menu.Item>
            <For each={openProjects(projects.data)}>
              {(candidate) => (
                <Menu.Item
                  icon={<InitialsDisc name={candidate.name.slice(0, 1)} seed={candidate.id} size={18} />}
                  hint={candidate.id === props.routine.projectId ? <Check size={14} /> : undefined}
                  onSelect={() => void props.save({ projectId: candidate.id }, "Couldn't change the project")}
                >
                  {candidate.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </Prop>
      <Prop icon={<Flag size={15} />} label="Priority">
        <Menu>
          <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Priority: ${PRIORITY_META[priority()].label}. Change priority`}>
            <PriorityBars priority={priority()} />
            {PRIORITY_META[priority()].label}
          </Menu.Trigger>
          <Menu.Content label="Priority" width={200}>
            <For each={PRIORITIES}>
              {(value) => (
                <Menu.Item
                  icon={<PriorityBars priority={value} />}
                  hint={value === priority() ? <Check size={14} /> : undefined}
                  onSelect={() => void props.save({ priority: value }, "Couldn't change the priority")}
                >
                  {PRIORITY_META[value].label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </Prop>
      <Prop icon={<Target size={15} />} label="Goal">
        <Menu onOpenChange={(open) => open && setGoalsWanted(true)}>
          <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Goal: ${goal()?.title ?? "none"}. Change goal`}>
            <span class="td-ellipsis" classList={{ "rpn-muted": !props.routine.goalId }}>
              {props.routine.goalId ? (goal()?.title ?? "A goal") : "No goal"}
            </span>
          </Menu.Trigger>
          <Menu.Content label="Goal" width={300}>
            <Menu.Item hint={props.routine.goalId ? undefined : <Check size={14} />} onSelect={() => void props.save({ goalId: null }, "Couldn't change the goal")}>
              No goal
            </Menu.Item>
            <For each={goals.data ?? []} fallback={<p class="nt-menu-note">{goals.isLoading ? "Loading goals…" : "No goals yet."}</p>}>
              {(candidate) => (
                <Menu.Item
                  hint={candidate.id === props.routine.goalId ? <Check size={14} /> : undefined}
                  onSelect={() => void props.save({ goalId: candidate.id }, "Couldn't change the goal")}
                >
                  {candidate.title}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </Prop>
      <Prop icon={<GitBranch size={15} />} label="Parent task">
        <span class="td-inline">
          <Popover open={parentOpen()} onOpenChange={setParentOpen}>
            <Popover.Trigger class="tl-cell rpn-cell" aria-label={`Parent task: ${props.routine.parentIssue?.title ?? "none"}. Change parent task`}>
              <Show when={props.routine.parentIssue} fallback={<span class="rpn-muted">None</span>}>
                {(parent) => (
                  <>
                    <span class="td-ellipsis">{parent().title}</span>
                    <span class="mono rpn-muted">{parent().identifier}</span>
                  </>
                )}
              </Show>
            </Popover.Trigger>
            <Popover.Content label="Parent task" width={420} hideClose>
              <TaskPicker
                label="Parent task"
                selected={props.routine.parentIssueId ? [props.routine.parentIssueId] : []}
                onPick={(issue) => {
                  setParentOpen(false);
                  void props.save({ parentIssueId: issue.id === props.routine.parentIssueId ? null : issue.id }, `Couldn't set ${taskName(issue)} as the parent`);
                }}
              />
            </Popover.Content>
          </Popover>
          <Show when={props.routine.parentIssue}>
            {(parent) => (
              <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Open the parent task" title="Open" onClick={() => props.onOpenTask(parent())}>
                <GitBranch size={14} aria-hidden="true" />
              </button>
            )}
          </Show>
        </span>
      </Prop>
      <Prop icon={<Folder size={15} />} label="Folder">
        <Menu>
          <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Folder: ${folder()?.name ?? "Unfiled"}. Move to another folder`}>
            {folder()?.name ?? <span class="rpn-muted">Unfiled</span>}
          </Menu.Trigger>
          <Menu.Content label="Folder" width={240}>
            <For each={folders.data?.folders ?? []} fallback={<p class="nt-menu-note">No folders yet. Make one from a folder's menu in the list.</p>}>
              {(candidate) => (
                <Menu.Item hint={candidate.id === props.routine.folderId ? <Check size={14} /> : undefined} onSelect={() => void move(candidate.id)}>
                  {candidate.name}
                </Menu.Item>
              )}
            </For>
            <Menu.Item hint={props.routine.folderId ? undefined : <Check size={14} />} onSelect={() => void move(null)}>
              Unfiled
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </Prop>
    </dl>
  );
}

function Description(props: { routine: RoutineDetail; save: Save }) {
  const [editing, setEditing] = createSignal(false);
  const [text, setText] = createSignal("");
  const start = () => {
    setText(props.routine.description ?? "");
    setEditing(true);
  };
  const commit = async () => {
    const next = text().trim();
    if (next === (props.routine.description ?? "").trim()) return setEditing(false);
    if (await props.save({ description: next || null }, "Couldn't save the description")) setEditing(false);
  };
  return (
    <section class="td-section td-description" aria-label="Description">
      <div class="td-section-head">
        <h2 class="td-section-title disp">Description</h2>
        <Show when={!editing()}>
          <Button ghost size="compact" class="rpn-head-end" onClick={start}>
            Edit
          </Button>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <Show when={props.routine.description} fallback={<p class="rpn-muted rpn-desc">No description. Each task it makes starts with only the title.</p>}>
            {(description) => (
              <p class="rpn-desc">
                <For each={placeholderSegments(description())}>
                  {(segment) => (segment.placeholder ? <code class="mono rpn-chip">{segment.text}</code> : segment.text)}
                </For>
              </p>
            )}
          </Show>
        }
      >
        <TextArea
          rows={8}
          value={text()}
          aria-label="Description"
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void commit();
            }
          }}
          autofocus
        />
        <div class="rpn-actions">
          <Button variant="quiet" size="compact" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="compact" onClick={() => void commit()}>
            Save
          </Button>
        </div>
      </Show>
    </section>
  );
}

function triggerTitle(trigger: RoutineTrigger) {
  if (trigger.kind === "schedule") return describeCron(trigger.cronExpression);
  if (trigger.kind === "webhook") return webhookSender(trigger) === "github" ? "GitHub webhook" : "Webhook";
  return "API";
}

function Triggers(props: { routine: RoutineDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const [adding, setAdding] = createSignal<RepeatDraft | null>(null);
  const [connect, setConnect] = createSignal<ConnectTarget | null>(null);
  const [busy, setBusy] = createSignal(false);
  const schedule = () => props.routine.triggers.find((trigger) => trigger.kind === "schedule" && trigger.enabled);
  // The server refuses a schedule while a required input has no default: no one's there to fill it.
  const missingDefaults = () =>
    props.routine.variables.filter((variable) => variable.required && (variable.defaultValue == null || variable.defaultValue === "")).map((variable) => variable.name);

  const run = async (action: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      pushToast({ tone: "error", title: failed, body: error instanceof Error ? error.message : undefined });
      return false;
    } finally {
      setBusy(false);
      refreshRecurring(client, company().id);
    }
  };
  const addWebhook = (sender: "app" | "github") =>
    void run(async () => {
      const response = await routinesApi.createTrigger(props.routine.id, {
        kind: "webhook",
        signingMode: sender === "github" ? "github_hmac" : "app_webhook",
        setupPending: true,
      });
      setConnect({
        routineId: props.routine.id,
        title: props.routine.title,
        triggerId: response.trigger.id,
        url: response.secretMaterial?.webhookUrl ?? response.trigger.webhookUrl ?? null,
        secret: response.secretMaterial?.webhookSecret ?? null,
        scheduleLabel: schedule() ? describeCron(schedule()!.cronExpression) : null,
      });
    }, "Couldn't add the webhook");
  const saveSchedule = async () => {
    const draft = adding();
    if (!draft) return;
    const ok = await run(
      () => routinesApi.createTrigger(props.routine.id, { kind: "schedule", cronExpression: scheduleCron(draft), timezone: draft.timezone }),
      "Couldn't add the schedule",
    );
    if (ok) setAdding(null);
  };

  return (
    <section class="td-section rpn-section" aria-labelledby="rpn-triggers">
      <div class="td-section-head">
        <h2 class="td-section-title disp" id="rpn-triggers">
          Triggers
        </h2>
        <Menu placement="bottom-end">
          <Menu.Trigger class="btn btn--secondary btn--compact rpn-head-end" disabled={busy()}>
            <Plus size={14} aria-hidden="true" />
            Add trigger
          </Menu.Trigger>
          <Menu.Content label="Add trigger" width={300}>
            <Menu.Item icon={<CalendarClock size={16} />} description="Run at set times" onSelect={() => setAdding(defaultRepeat())}>
              Schedule
            </Menu.Item>
            <Menu.Item icon={<Webhook size={16} />} description="Run when an app or script calls a URL" onSelect={() => addWebhook("app")}>
              Webhook
            </Menu.Item>
            <Menu.Item icon={<GitBranch size={16} />} description="Run on events from a GitHub repository" onSelect={() => addWebhook("github")}>
              GitHub webhook
            </Menu.Item>
            <Menu.Item
              icon={<Braces size={16} />}
              description="Run from a script with an API key"
              onSelect={() => void run(() => routinesApi.createTrigger(props.routine.id, { kind: "api" }), "Couldn't add the API trigger")}
            >
              API
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </div>
      <Show when={props.routine.triggers.length === 0 && !adding()}>
        <p class="rpn-muted">No triggers: it runs only when you press Run now.</p>
      </Show>
      <For each={props.routine.triggers}>
        {(trigger) => <TriggerCard routine={props.routine} trigger={trigger} onConnect={setConnect} />}
      </For>
      <Show when={adding()}>
        {(draft) => (
          <div class="rpn-trigger rpn-trigger--edit">
            <b>New schedule</b>
            <ScheduleFields value={draft()} onChange={(patch) => setAdding({ ...draft(), ...patch })} idPrefix="rpn-new" />
            <Show when={missingDefaults().length > 0}>
              <p class="rpn-error">A schedule needs a default for {missingDefaults().join(", ")}. Set it under Inputs, or make it optional.</p>
            </Show>
            <div class="rpn-actions">
              <Button variant="quiet" size="compact" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={busy() || Boolean(cronProblem(scheduleCron(draft()))) || missingDefaults().length > 0}
                onClick={() => void saveSchedule()}
              >
                Add schedule
              </Button>
            </div>
          </div>
        )}
      </Show>
      <ConnectWebhookDialog target={connect()} onClose={() => setConnect(null)} />
    </section>
  );
}

function TriggerCard(props: { routine: RoutineDetail; trigger: RoutineTrigger; onConnect: (target: ConnectTarget) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [editing, setEditing] = createSignal<RepeatDraft | null>(null);
  const [secret, setSecret] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const pending = () => props.trigger.setupPending === true;
  const icon = () =>
    props.trigger.kind === "schedule" ? <CalendarClock size={16} /> : props.trigger.kind === "webhook" ? <Webhook size={16} /> : <Braces size={16} />;
  const sub = () => {
    if (props.trigger.kind === "schedule") return `${props.trigger.cronExpression ?? ""} · ${timeZoneLabel(props.trigger.timezone ?? "UTC")}`;
    if (props.trigger.kind === "webhook") return props.trigger.webhookUrl ?? "URL appears once it's set up";
    return `POST /api/routines/${props.routine.id}/run`;
  };
  const meta = () => {
    const state = triggerState(props.trigger);
    const last = props.trigger.kind === "webhook" ? props.trigger.lastWebhookDelivery?.receivedAt : props.trigger.lastFiredAt;
    return last && props.trigger.enabled && !pending() ? `${state} · last ${props.trigger.kind === "webhook" ? "call" : "ran"} ${formatFire(last)}` : state;
  };
  const glyph = () => (pending() ? "ember" : props.trigger.enabled ? "lagoon" : "ash");

  const act = async (action: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      pushToast({ tone: "error", title: failed, body: error instanceof Error ? error.message : undefined });
      return false;
    } finally {
      setBusy(false);
      refreshRecurring(client, company().id);
    }
  };
  const rotate = () =>
    void act(async () => {
      const response = await routinesApi.rotateTriggerSecret(props.trigger.id);
      setSecret(response.secretMaterial.webhookSecret);
    }, "Couldn't rotate the secret");
  const copyUrl = async () => {
    try {
      await copyText(props.trigger.webhookUrl ?? "");
      pushToast({ tone: "success", title: "Copied the webhook URL" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't copy the URL", body: error instanceof Error ? error.message : undefined });
    }
  };
  const finishSetup = () =>
    props.onConnect({
      routineId: props.routine.id,
      title: props.routine.title,
      triggerId: props.trigger.id,
      url: props.trigger.webhookUrl ?? null,
      secret: null,
      scheduleLabel: null,
    });
  const saveSchedule = async () => {
    const draft = editing();
    if (!draft) return;
    const ok = await act(
      () => routinesApi.updateTrigger(props.trigger.id, { cronExpression: scheduleCron(draft), timezone: draft.timezone }),
      "Couldn't save the schedule",
    );
    if (ok) setEditing(null);
  };

  return (
    <div class="rpn-trigger" classList={{ "rpn-trigger--off": !props.trigger.enabled || pending() }}>
      <div class="rpn-trigger-top">
        <span class="rpn-trigger-icon" aria-hidden="true">
          {icon()}
        </span>
        <div class="rpn-trigger-text">
          <b>{triggerTitle(props.trigger)}</b>
          <span class="mono rpn-trigger-sub" title={sub()}>
            {sub()}
          </span>
        </div>
        <Show when={!pending()}>
          <Switch
            label={`${triggerTitle(props.trigger)} on`}
            labelHidden
            checked={props.trigger.enabled}
            disabled={busy()}
            onChange={(enabled) => void act(() => routinesApi.updateTrigger(props.trigger.id, { enabled }), "Couldn't switch the trigger")}
          />
        </Show>
        <Menu placement="bottom-end">
          <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`Edit ${triggerTitle(props.trigger)}`} disabled={busy()}>
            <Ellipsis size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label={`${triggerTitle(props.trigger)} actions`} width={220}>
            <Show when={props.trigger.kind === "schedule"}>
              <Menu.Item onSelect={() => setEditing(repeatFromCron(props.trigger.cronExpression ?? "", props.trigger.timezone ?? "UTC"))}>Edit schedule</Menu.Item>
            </Show>
            <Show when={props.trigger.kind === "webhook" && pending()}>
              <Menu.Item onSelect={finishSetup}>Finish setup</Menu.Item>
            </Show>
            <Show when={props.trigger.kind === "webhook"}>
              <Menu.Item description="The old secret stops working" onSelect={rotate}>
                Rotate secret
              </Menu.Item>
            </Show>
            <Menu.Item danger onSelect={() => void act(() => routinesApi.deleteTrigger(props.trigger.id), "Couldn't remove the trigger")}>
              Remove trigger
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </div>
      <Show when={props.trigger.kind === "webhook"}>
        <div class="rpn-trigger-buttons">
          <Show when={pending()}>
            <Button size="compact" variant="primary" onClick={finishSetup}>
              Finish setup
            </Button>
          </Show>
          <Button size="compact" ghost disabled={!props.trigger.webhookUrl} onClick={() => void copyUrl()}>
            Copy URL
          </Button>
          <Button size="compact" ghost disabled={busy()} onClick={rotate}>
            Rotate secret
          </Button>
        </div>
      </Show>
      <Show when={secret()}>
        {(value) => (
          <div class="rpn-secret" role="status">
            <b>New secret, shown only now</b>
            <div class="rpn-secret-row">
              <code class="mono">{value()}</code>
              <Button size="compact" onClick={() => void copyText(value()).then(() => pushToast({ tone: "success", title: "Copied the secret" }))}>
                Copy
              </Button>
              <Button ghost size="compact" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={editing()}>
        {(draft) => (
          <div class="rpn-trigger-edit">
            <ScheduleFields value={draft()} onChange={(patch) => setEditing({ ...draft(), ...patch })} idPrefix={`rpn-${props.trigger.id}`} />
            <div class="rpn-actions">
              <Button variant="quiet" size="compact" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="compact" disabled={busy() || Boolean(cronProblem(scheduleCron(draft())))} onClick={() => void saveSchedule()}>
                Save schedule
              </Button>
            </div>
          </div>
        )}
      </Show>
      <div class="rpn-trigger-meta">
        <Capsule gradient={glyph()} size="tiny" />
        {meta()}
      </div>
    </div>
  );
}

const EDITABLE_TYPES: RoutineVariable["type"][] = ["text", "textarea", "number", "boolean", "date"];

function Inputs(props: { routine: RoutineDetail; save: Save }) {
  const builtIns = () => builtInsUsed(props.routine.title, props.routine.description);
  const change = (name: string, patch: Partial<RoutineVariable>) => {
    const variables = props.routine.variables.map((variable) => (variable.name === name ? { ...variable, ...patch } : variable));
    void props.save({ variables }, `Couldn't save the input ${name}`);
  };
  const defaultText = (variable: RoutineVariable) => (variable.defaultValue == null ? "" : String(variable.defaultValue));
  const commitDefault = (variable: RoutineVariable, raw: string) => {
    const text = raw.trim();
    if (text === defaultText(variable)) return;
    let value: string | number | boolean | null = text === "" ? null : text;
    if (value !== null && variable.type === "number") {
      const number = Number(text);
      if (!Number.isFinite(number)) return pushToast({ tone: "warn", title: `${variable.name} takes a number` });
      value = number;
    }
    if (value !== null && variable.type === "boolean") value = /^(true|yes|1)$/i.test(text);
    change(variable.name, { defaultValue: value });
  };
  return (
    <section class="td-section rpn-section" aria-labelledby="rpn-inputs">
      <div class="td-section-head">
        <h2 class="td-section-title disp" id="rpn-inputs">
          Inputs
        </h2>
        <InfoTip
          label="About inputs"
          text="Inputs fill the placeholders in the title and description, like {{exchanges}}. A run uses these defaults unless Run now, a webhook or an API call sends its own. Add one by writing a new placeholder in the text."
        />
      </div>
      <Show when={props.routine.variables.length > 0 || builtIns().length > 0} fallback={<p class="rpn-muted">No inputs. Write a placeholder like {"{{date}}"} or {"{{region}}"} in the title or description to add one.</p>}>
        <ul class="rpn-inputs" aria-label="Inputs">
          <For each={builtIns()}>
            {(name) => (
              <li class="rpn-input">
                <span class="mono">{name}</span>
                <span class="rpn-muted">Built in</span>
                <span class="rpn-muted">{BUILT_IN_INPUTS[name]}</span>
                <span />
              </li>
            )}
          </For>
          <For each={props.routine.variables}>
            {(variable) => (
              <li class="rpn-input">
                <span class="mono">{variable.name}</span>
                <Menu>
                  <Menu.Trigger class="tl-cell rpn-cell" aria-label={`Type of ${variable.name}: ${VARIABLE_TYPE_LABEL[variable.type]}`} disabled={variable.type === "select"}>
                    {VARIABLE_TYPE_LABEL[variable.type]}
                  </Menu.Trigger>
                  <Menu.Content label={`Type of ${variable.name}`} width={200}>
                    <For each={EDITABLE_TYPES}>
                      {(type) => (
                        <Menu.Item hint={type === variable.type ? <Check size={14} /> : undefined} onSelect={() => change(variable.name, { type, defaultValue: null })}>
                          {VARIABLE_TYPE_LABEL[type]}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Content>
                </Menu>
                <TextInput
                  class="rpn-input-default"
                  aria-label={`Default for ${variable.name}`}
                  placeholder="No default"
                  type={variable.type === "number" ? "number" : variable.type === "date" ? "date" : "text"}
                  value={defaultText(variable)}
                  onBlur={(event) => commitDefault(variable, event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                />
                <button
                  type="button"
                  class="rpn-required-toggle"
                  aria-pressed={variable.required}
                  title={variable.required ? "Required: a run needs a value" : "Optional"}
                  onClick={() => change(variable.name, { required: !variable.required })}
                >
                  {variable.required ? "Required" : "Optional"}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function envName(name: string) {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Z_]/.test(cleaned) ? cleaned : `SECRET_${cleaned}`;
}

function Secrets(props: { routine: RoutineDetail; save: Save }) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const secrets = createQuery(() => ({
    queryKey: queryKeys.secrets(company().id),
    queryFn: ({ signal }) => routinesApi.secrets(company().id, signal),
    enabled: open() || Object.keys(props.routine.env ?? {}).length > 0,
  }));
  const env = () => (props.routine.env ?? {}) as Record<string, EnvBinding>;
  const describe = (binding: EnvBinding) => {
    if (typeof binding === "string" || binding.type === "plain") return "A plain value";
    if (binding.type === "secret_ref") return secrets.data?.find((secret) => secret.id === binding.secretId)?.name ?? "A company secret";
    return `Each person's ${binding.key}`;
  };
  const remove = (key: string) => {
    const next = { ...env() };
    delete next[key];
    void props.save({ env: Object.keys(next).length > 0 ? next : null }, `Couldn't remove ${key}`);
  };
  const add = (secretId: string, fallbackName: string) => {
    const key = envName(name().trim() || fallbackName);
    if (env()[key]) return pushToast({ tone: "warn", title: `${key} is already set` });
    setOpen(false);
    setName("");
    void props.save({ env: { ...env(), [key]: { type: "secret_ref", secretId } } }, `Couldn't add ${key}`);
  };
  return (
    <section class="td-section rpn-section" aria-labelledby="rpn-secrets">
      <div class="rpn-secrets">
        <h2 class="td-section-title disp" id="rpn-secrets">
          Secrets
        </h2>
        <For each={Object.entries(env())}>
          {([key, binding]) => (
            <span class="rpn-secret-chip" title={describe(binding)}>
              <KeyRound size={12} aria-hidden="true" />
              <span class="mono">{key}</span>
              <button type="button" class="nt-icon nt-icon--small" aria-label={`Remove ${key}`} onClick={() => remove(key)}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
        <Popover open={open()} onOpenChange={setOpen}>
          <Popover.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label="Add a secret">
            <Plus size={15} aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content title="Add a secret" width={340}>
            <p class="rpn-muted rpn-popover-note">Each run gets it as an environment variable, over the project's and the agent's.</p>
            <TextInput aria-label="Variable name" placeholder="Variable name, like DERIBIT_API_KEY" class="mono" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            <div class="rpn-secret-list" role="listbox" aria-label="Company secrets">
              <Branch>
                <Match when={!secrets.data}>
                  <p class="rpn-muted">{secrets.isError ? "The secrets couldn't be loaded." : "Loading secrets…"}</p>
                </Match>
                <Match when={secrets.data!.filter((secret) => secret.status === "active").length === 0}>
                  <p class="rpn-muted">This company has no secrets yet. Add them in company settings.</p>
                </Match>
                <Match when={true}>
                  <For each={secrets.data!.filter((secret) => secret.status === "active")}>
                    {(secret) => (
                      <button type="button" class="nt-option" role="option" onClick={() => add(secret.id, secret.name)}>
                        <KeyRound size={14} aria-hidden="true" />
                        <span class="nt-option-label">{secret.name}</span>
                      </button>
                    )}
                  </For>
                </Match>
              </Branch>
            </div>
          </Popover.Content>
        </Popover>
      </div>
    </section>
  );
}

function RunPolicy(props: { routine: RoutineDetail; save: Save }) {
  const hasSchedule = () => props.routine.triggers.some((trigger) => trigger.kind === "schedule");
  const gated = () => props.routine.activityGatePolicy === "require_external_activity";
  const policy = () => OPEN_POLICIES.find((option) => option.value === props.routine.concurrencyPolicy) ?? OPEN_POLICIES[0]!;
  return (
    <section class="td-section rpn-section" aria-labelledby="rpn-policy">
      <h2 class="td-section-title disp" id="rpn-policy">
        Run policy
      </h2>
      <dl class="td-props rpn-policy">
        <dt>If the last one is still open</dt>
        <dd>
          <Menu>
            <Menu.Trigger class="field rpn-select" aria-label={`If the last one is still open: ${policy().label}`}>
              <span class="field-value">{policy().label}</span>
            </Menu.Trigger>
            <Menu.Content label="If the last one is still open" width={300}>
              <For each={OPEN_POLICIES}>
                {(option) => (
                  <Menu.Item
                    description={option.description}
                    hint={option.value === props.routine.concurrencyPolicy ? <Check size={14} /> : undefined}
                    onSelect={() => void props.save({ concurrencyPolicy: option.value }, "Couldn't change the policy")}
                  >
                    {option.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </dd>
        <dt>Missed runs</dt>
        <dd>
          <Menu>
            <Menu.Trigger class="field rpn-select" aria-label={`Missed runs: ${CATCH_UP_LABEL[props.routine.catchUpPolicy] ?? props.routine.catchUpPolicy}`}>
              <span class="field-value">{CATCH_UP_LABEL[props.routine.catchUpPolicy] ?? props.routine.catchUpPolicy}</span>
            </Menu.Trigger>
            <Menu.Content label="Missed runs" width={300}>
              <For each={Object.entries(CATCH_UP_LABEL)}>
                {([value, label]) => (
                  <Menu.Item
                    description={value === "skip_missed" ? "Runs the server missed while it was down are dropped" : "Missed runs catch up, a few at most"}
                    hint={value === props.routine.catchUpPolicy ? <Check size={14} /> : undefined}
                    onSelect={() => void props.save({ catchUpPolicy: value }, "Couldn't change the policy")}
                  >
                    {label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </dd>
        <dt>
          Only when something changed
          <InfoTip
            label="About only when something changed"
            text="Skips a scheduled run when nothing has changed since the last one: no task, comment, document or run. Webhook, API and Run now runs always go ahead."
          />
        </dt>
        <dd class="rpn-gate">
          <Switch
            label="Only when something changed"
            labelHidden
            checked={gated()}
            disabled={!hasSchedule()}
            onChange={(next) =>
              void props.save(
                next
                  ? { activityGatePolicy: "require_external_activity", activityGateScope: props.routine.projectId ? props.routine.activityGateScope : "company" }
                  : { activityGatePolicy: "always" },
                "Couldn't change the policy",
              )
            }
          />
          <Show when={gated()}>
            <Segmented
              label="Changes where"
              options={[
                ...(props.routine.projectId ? [{ value: "project", label: "In this project" }] : []),
                { value: "company", label: "Anywhere" },
              ]}
              value={props.routine.activityGateScope}
              onChange={(scope) => void props.save({ activityGateScope: scope }, "Couldn't change the policy")}
            />
          </Show>
          <Show when={!hasSchedule()}>
            <span class="rpn-muted">Only schedules can wait for a change.</span>
          </Show>
        </dd>
      </dl>
    </section>
  );
}
