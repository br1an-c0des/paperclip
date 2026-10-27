import type { AttentionItem, AttentionSubject, Issue, IssueStatus } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  AlarmClock,
  BadgeCheck,
  CircleAlert,
  Clock,
  CornerDownRight,
  Ellipsis,
  RotateCcw,
  Sparkles,
  Users,
  X,
} from "lucide-solid";
import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { RequestCard } from "@/requests/RequestCard";
import { expiryLabel, type Request } from "@/requests/request-model";
import type { TaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { DEFAULT_SNOOZE, SNOOZE_PRESETS, signoffOf, snoozedUntil, snoozeLabel, type Pending } from "./inbox-model";
import { itemTask, type Inbox } from "./use-inbox";

/*
 * One Inbox item (board 14): the request card, and beside it the context column — the task it's
 * about (opens the task modal), why it's here, and the triage menu (snooze, clear). Requests with a
 * card source draw the shared RequestCard; review turns draw a sign-off card; everything else draws
 * a plain card that links to its task.
 *
 * Snoozed and Cleared draw items as one-line rows with Restore.
 */

const SOURCE_LABEL: Partial<Record<AttentionItem["sourceKind"], string>> = {
  decision: "Proposal",
  join_request: "Join request",
  recovery_action: "Stuck work",
  failed_run: "Failed run",
  budget_alert: "Budget",
  agent_error_alert: "Agent error",
  blocker_attention: "Blocked",
  review: "Sign-off",
  approval: "Approval",
  issue_thread_interaction: "Question",
};

export function sourceLabel(item: AttentionItem) {
  return SOURCE_LABEL[item.sourceKind] ?? "Request";
}

/** Title for an item: the subject's, or its task's. */
export function itemTitle(item: AttentionItem) {
  return item.subject.title ?? itemTask(item)?.title ?? sourceLabel(item);
}

function isStatus(value: string | null): value is IssueStatus {
  return value !== null && value in STATUS_META;
}

export function TaskLink(props: { task: AttentionSubject; people: TaskPeople; onOpen: () => void }) {
  const meta = () => props.task.metadata ?? {};
  const assignee = () => {
    const agentId = typeof meta().assigneeAgentId === "string" ? (meta().assigneeAgentId as string) : null;
    const userId = typeof meta().assigneeUserId === "string" ? (meta().assigneeUserId as string) : null;
    if (agentId) return props.people.agent(agentId)?.name ?? "An agent";
    if (userId) return userId === props.people.youId() ? "You" : props.people.personName(userId);
    return null;
  };
  return (
    <button type="button" class="ibx-rel" onClick={() => props.onOpen()}>
      <Show when={isStatus(props.task.status) && (props.task.status as IssueStatus)} fallback={<span class="ibx-rel-glyph" aria-hidden="true" />}>
        {(status) => <StatusCapsule status={status()} size="row" />}
      </Show>
      <span class="ibx-rel-main">
        <span class="ibx-rel-top">
          <Show when={props.task.identifier}>
            <span class="mono">{props.task.identifier}</span>
          </Show>
          <span class="ibx-rel-title">{props.task.title}</span>
        </span>
        <span class="ibx-rel-meta">
          <Show when={isStatus(props.task.status) && (props.task.status as IssueStatus)}>{(status) => <span>{STATUS_META[status()].label}</span>}</Show>
          <Show when={assignee()}>{(name) => <span>{name()}</span>}</Show>
        </span>
      </span>
    </button>
  );
}

function TriageMenu(props: { item: AttentionItem; inbox: Inbox }) {
  return (
    <Menu>
      <Menu.Trigger class="ibx-menu" aria-label="Snooze or clear">
        <Ellipsis size={15} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Snooze or clear" width={240}>
        <Menu.Group label="Snooze until">
          <For each={SNOOZE_PRESETS}>
            {(preset) => (
              <Menu.Item hint={preset === DEFAULT_SNOOZE ? "S" : undefined} onSelect={() => props.inbox.snooze(props.item, preset.until(new Date()))}>
                {preset.label}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item icon={<X size={15} />} hint="Y" description="Out of your inbox; Cleared keeps it" onSelect={() => props.inbox.clear(props.item)}>
          Clear
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

/** `showWhy` is off where the card already says why (plain cards and sign-offs). */
function Context(props: { item: AttentionItem; inbox: Inbox; people: TaskPeople; showWhy: boolean; onOpen: () => void }) {
  const task = () => props.inbox.taskOf(props.item);
  return (
    <aside class="ibx-ctx" aria-label="Context">
      <div class="ibx-ctx-head">
        <h4>{task()?.identifier ? `About ${task()!.identifier}` : "Why it's here"}</h4>
        <TriageMenu item={props.item} inbox={props.inbox} />
      </div>
      <Show when={task()}>{(found) => <TaskLink task={found()} people={props.people} onOpen={props.onOpen} />}</Show>
      <Show when={props.showWhy || !task()}>
        <p class="ibx-why">{props.item.whyNow}</p>
      </Show>
    </aside>
  );
}

export function NeedsItem(props: {
  item: AttentionItem;
  request: Request | undefined;
  failed: boolean;
  inbox: Inbox;
  people: TaskPeople;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const task = () => props.inbox.taskOf(props.item);
  return (
    <div
      class="ibx-item"
      classList={{ "ibx-item--selected": props.selected }}
      data-inbox-item={props.item.id}
      tabindex="-1"
      onFocusIn={() => props.onSelect()}
      onPointerDown={() => props.onSelect()}
    >
      <div class="ibx-main">
        <Switch fallback={<PlainCard item={props.item} hasTask={!!task()} onOpen={props.onOpen} />}>
          <Match when={props.request}>
            {(request) => <RequestCard request={request()} taskId={task()?.id ?? ""} people={props.people} />}
          </Match>
          <Match when={props.item.sourceKind === "review" && task()}>
            {(found) => <SignoffCard item={props.item} taskId={found().id} people={props.people} onOpen={props.onOpen} onDone={props.inbox.refreshFeed} />}
          </Match>
          <Match when={(props.item.sourceKind === "issue_thread_interaction" || props.item.sourceKind === "approval") && !props.failed}>
            <div class="rq ibx-loading" aria-busy="true">
              <span class="rq-note">Loading the request…</span>
            </div>
          </Match>
        </Switch>
      </div>
      <Context item={props.item} inbox={props.inbox} people={props.people} showWhy={!!props.request} onOpen={props.onOpen} />
    </div>
  );
}

/** Items without a card here (proposals, join requests, stuck work, alerts): what and why, and the task. */
function PlainCard(props: { item: AttentionItem; hasTask: boolean; onOpen: () => void }) {
  const alert = () => ["failed_run", "budget_alert", "agent_error_alert", "blocker_attention"].includes(props.item.sourceKind);
  const excerpt = () => {
    const detail = props.item.detail as { summaryExcerpt?: string | null; failureReasonExcerpt?: string | null; promptExcerpt?: string | null } | null;
    return detail?.failureReasonExcerpt ?? detail?.promptExcerpt ?? (detail?.summaryExcerpt !== itemTitle(props.item) ? detail?.summaryExcerpt : null) ?? null;
  };
  const lifetime = () => (props.item.expiresAt ? expiryLabel(new Date(props.item.expiresAt), new Date()) : null);
  return (
    <article class="rq" data-kind={alert() ? "alert" : "proposal"} aria-label={`${sourceLabel(props.item)}: ${itemTitle(props.item)}`}>
      <div class="rq-top">
        <span class="rq-kind">
          <Show when={alert()} fallback={<Sparkles size={12} aria-hidden="true" />}>
            <CircleAlert size={12} aria-hidden="true" />
          </Show>
          {sourceLabel(props.item)}
        </span>
        <Show when={lifetime()}>
          {(life) => (
            <span class="rq-life" classList={{ "rq-life--soon": life().soon }}>
              <Clock size={12} aria-hidden="true" />
              {life().text}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.item.originAgentName}>
        {(name) => (
          <div class="rq-ask">
            <b>{name()}</b>
            <span>{props.item.sourceKind === "decision" ? "proposes changes" : "raised this"}</span>
          </div>
        )}
      </Show>
      <h3 class="disp">{itemTitle(props.item)}</h3>
      <Show when={excerpt()}>
        <p class="ibx-excerpt">{excerpt()}</p>
      </Show>
      <div class="rq-next">
        <CornerDownRight size={14} aria-hidden="true" />
        <span>{props.item.whyNow}</span>
      </div>
      <div class="rq-acts">
        <Show when={props.hasTask} fallback={<p class="rq-note">Handled outside this board for now.</p>}>
          <Button size="compact" variant={alert() ? "secondary" : "primary"} onClick={() => props.onOpen()}>
            Open the task
          </Button>
        </Show>
      </div>
    </article>
  );
}

/**
 * A review stage's turn as a request (proposal items 8 and 9): where the stages stand and where the
 * task returns if it's sent back. On your turn, approve or send it back here, with the comment the
 * server asks for: approving is moving the task to done, sending back is moving it to in progress.
 */
function SignoffCard(props: { item: AttentionItem; taskId: string; people: TaskPeople; onOpen: () => void; onDone: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const nameOf = (key: string) => {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (kind === "agent") return props.people.agent(id)?.name ?? "An agent";
    return id === props.people.youId() ? "You" : props.people.personName(id);
  };
  const signoff = () => (task.data ? signoffOf(task.data as Issue, props.people.youId(), nameOf) : null);
  const stalled = () => props.item.subject.metadata?.reviewAttentionState === "stalled";
  const identifier = () => props.item.subject.identifier ?? "the task";
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const decide = createMutation(() => ({
    mutationFn: (verdict: "approve" | "send_back") =>
      issuesApi.update(props.taskId, { status: verdict === "approve" ? "done" : "in_progress", comment: note().trim() }),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      props.onDone();
    },
    onError: (failure: Error) => setError(failure.message),
  }));
  const nextStep = () => {
    const steps = signoff()?.steps ?? [];
    const index = steps.findIndex((step) => step.now);
    const after = index >= 0 ? steps[index + 1] : undefined;
    return after ? `Approving moves ${identifier()} to its next stage: ${after.label.toLowerCase()}.` : `Approving finishes ${identifier()}.`;
  };
  const canSign = () => !stalled() && signoff()?.yours === true;
  return (
    <article class="rq" data-kind="signoff" aria-label={`Sign-off for ${identifier()}`}>
      <div class="rq-top">
        <span class="rq-kind">
          <BadgeCheck size={12} aria-hidden="true" />
          Sign-off
        </span>
        <span class="rq-subj">{identifier()}</span>
        <span class="rq-life">
          <Clock size={12} aria-hidden="true" />
          Open until answered
        </span>
      </div>
      <h3 class="disp">
        <Switch fallback={`Review ${props.item.subject.title ?? identifier()}`}>
          <Match when={stalled()}>{`${identifier()} is in review with nobody to review it`}</Match>
          <Match when={canSign()}>Your sign-off is needed: approve, or send back</Match>
          <Match when={signoff()?.waitingOn}>{(who) => `Review pending with ${who()}`}</Match>
        </Switch>
      </h3>
      <Show when={signoff() && (signoff()!.steps.length > 0 || signoff()!.returns)}>
        <div class="ibx-stage">
          <For each={signoff()!.steps}>
            {(step) => (
              <span class="ibx-step" classList={{ "ibx-step--now": step.now }}>
                <Show when={step.now}>
                  <BadgeCheck size={12} aria-hidden="true" />
                </Show>
                {step.label}
              </span>
            )}
          </For>
          <Show when={signoff()!.returns}>{(returns) => <span>{returns()}</span>}</Show>
        </div>
      </Show>
      <Show when={canSign()}>
        <TextArea aria-label="Sign-off note" rows={2} placeholder="What you checked, or what to change (required)" value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
      </Show>
      <div class="rq-next">
        <CornerDownRight size={14} aria-hidden="true" />
        <span>{stalled() ? props.item.whyNow : canSign() ? nextStep() : `Open ${identifier()} to see the review.`}</span>
      </div>
      <Show when={error()}>
        <p class="rq-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="rq-acts">
        <Show
          when={canSign()}
          fallback={
            <Button size="compact" variant="primary" onClick={() => props.onOpen()}>
              {stalled() ? "Choose a review path" : "Open the task"}
            </Button>
          }
        >
          <Button size="compact" variant="primary" disabled={decide.isPending || !note().trim()} onClick={() => decide.mutate("approve")}>
            Approve
          </Button>
          <Button size="compact" disabled={decide.isPending || !note().trim()} onClick={() => decide.mutate("send_back")}>
            Send back with notes
          </Button>
          <Button size="compact" variant="quiet" onClick={() => props.onOpen()}>
            Open the task
          </Button>
        </Show>
        <span class="rq-who">
          <Users size={13} aria-hidden="true" />
          {canSign() ? "You" : "People only"}
        </span>
      </div>
    </article>
  );
}

/** A snoozed or cleared item: one line, with when it comes back, its task and Restore. */
export function ShelfRow(props: {
  item: AttentionItem;
  pending: Pending | undefined;
  inbox: Inbox;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const snoozed = () => snoozedUntil(props.item, props.pending);
  const task = () => props.inbox.taskOf(props.item);
  const note = (): JSX.Element =>
    props.pending?.action === "clear" || (!snoozed() && props.item.dismissal) ? "Cleared" : snoozeLabel(snoozed());
  return (
    <li
      class="ibx-row"
      classList={{ "ibx-row--selected": props.selected }}
      data-inbox-item={props.item.id}
      tabindex="-1"
      onFocusIn={() => props.onSelect()}
      onPointerDown={() => props.onSelect()}
    >
      <span class="ibx-row-kind">{sourceLabel(props.item)}</span>
      <span class="ibx-row-title">{itemTitle(props.item)}</span>
      <Show when={task()}>
        {(found) => (
          <button type="button" class="ibx-row-task mono" onClick={() => props.onOpen()}>
            {found().identifier ?? "Task"}
          </button>
        )}
      </Show>
      <span class="ibx-row-when">
        <Show when={snoozed()}>
          <AlarmClock size={12} aria-hidden="true" />
        </Show>
        {note()}
      </span>
      <Button size="compact" variant="quiet" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => props.inbox.restore(props.item)}>
        Restore
      </Button>
    </li>
  );
}
