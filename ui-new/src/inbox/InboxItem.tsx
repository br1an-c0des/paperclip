import type { AttentionItem, AttentionSubject, IssueStatus } from "@paperclipai/shared";
import { AlarmClock, Archive, CircleAlert, Clock, CornerDownRight, Ellipsis, RotateCcw, Sparkles, X } from "lucide-solid";
import { For, Match, Show, Switch, type JSX } from "solid-js";
import { useCompany } from "@/lib/company";
import { budgetIncidentHref, RequestCard } from "@/requests/RequestCard";
import { expiryLabel, type Request } from "@/requests/request-model";
import type { TaskPeople } from "@/tasks/people";
import { Button, buttonClass } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { DEFAULT_SNOOZE, SNOOZE_PRESETS, snoozedUntil, snoozeLabel, type Pending } from "./inbox-model";
import { itemTask, type Inbox } from "./use-inbox";

/*
 * One Inbox item (board 14): a request card whose top row holds the triage menu (snooze, clear) and
 * whose context column holds the task it's about (opens the task modal) and why it's here. Requests
 * with a card source — questions, proposals (connection requests and Decisions among them),
 * approvals, join requests and sign-offs — draw the shared RequestCard; everything else (stuck work,
 * alerts) draws a plain card in the same frame that links to its task, or for a budget alert to the
 * budget controls. Cards that arrived since you last looked carry "New".
 *
 * Snoozed and Cleared draw items as one-line rows with Restore; the aging shelf draws them as rows
 * with Keep.
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

/** Snooze presets and Clear, for the "…" menu in a card's top row. */
function TriageItems(props: { item: AttentionItem; inbox: Inbox }) {
  return (
    <>
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
    </>
  );
}

/** The triage menu on its own, for cards that aren't RequestCards. */
function TriageMenu(props: { item: AttentionItem; inbox: Inbox }) {
  return (
    <Menu>
      <Menu.Trigger class="rq-menu" aria-label="Snooze or clear">
        <Ellipsis size={15} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Snooze or clear" width={240}>
        <TriageItems item={props.item} inbox={props.inbox} />
      </Menu.Content>
    </Menu>
  );
}

/** The context column: the task it's about, and why it's here. `showWhy` is off where the card already says why. */
function Context(props: { item: AttentionItem; inbox: Inbox; people: TaskPeople; showWhy: boolean; onOpen: () => void }) {
  const task = () => props.inbox.taskOf(props.item);
  return (
    <>
      <h4 class="ibx-ctx-h">{task()?.identifier ? `About ${task()!.identifier}` : "Why it's here"}</h4>
      <Show when={task()}>{(found) => <TaskLink task={found()} people={props.people} onOpen={props.onOpen} />}</Show>
      <Show when={props.showWhy || !task()}>
        <p class="ibx-why">{props.item.whyNow}</p>
      </Show>
    </>
  );
}

/** Kinds whose card loads its own source; the rest draw a plain card at once. */
const CARD_SOURCES = new Set<AttentionItem["sourceKind"]>(["issue_thread_interaction", "approval", "review"]);
const TASKLESS_SOURCES = new Set<AttentionItem["sourceKind"]>(["decision", "join_request"]);

export function NeedsItem(props: {
  item: AttentionItem;
  request: Request | undefined;
  failed: boolean;
  inbox: Inbox;
  people: TaskPeople;
  selected: boolean;
  fresh?: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const task = () => props.inbox.taskOf(props.item);
  const waitsOnCard = () => !props.failed && ((CARD_SOURCES.has(props.item.sourceKind) && !!task()) || TASKLESS_SOURCES.has(props.item.sourceKind));
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
        <Switch
          fallback={
            <PlainCard
              item={props.item}
              hasTask={!!task()}
              fresh={props.fresh}
              onOpen={props.onOpen}
              menu={<TriageMenu item={props.item} inbox={props.inbox} />}
              aside={<Context item={props.item} inbox={props.inbox} people={props.people} showWhy={false} onOpen={props.onOpen} />}
            />
          }
        >
          <Match when={props.request}>
            {(request) => (
              <RequestCard
                request={request()}
                taskId={task()?.id ?? ""}
                people={props.people}
                triage={() => <TriageItems item={props.item} inbox={props.inbox} />}
                triageLabel="Snooze or clear"
                fresh={props.fresh}
                aside={<Context item={props.item} inbox={props.inbox} people={props.people} showWhy={request().kind !== "signoff"} onOpen={props.onOpen} />}
                onOpenSubject={props.onOpen}
                onSettled={props.inbox.refreshFeed}
              />
            )}
          </Match>
          <Match when={waitsOnCard()}>
            <div class="rq ibx-loading" aria-busy="true">
              <span class="rq-note">Loading the request…</span>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/** Why a plain card has no action here, when it has no task to open. */
function noActionNote(item: AttentionItem) {
  if (item.sourceKind === "join_request") return "You can't approve join requests in this company, or it was already answered.";
  if (item.sourceKind === "decision") return "This proposal is no longer available. It may have been decided elsewhere.";
  return "Handled outside this board for now.";
}

/** Items without a request card (stuck work, alerts, and any card whose source didn't load): what and why, and the task. */
function PlainCard(props: { item: AttentionItem; hasTask: boolean; fresh?: boolean; onOpen: () => void; menu: JSX.Element; aside: JSX.Element }) {
  const company = useCompany();
  const budget = () => props.item.sourceKind === "budget_alert" || props.item.subject.kind === "budget_incident";
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
        <Show when={props.fresh}>
          <span class="rq-new">New</span>
        </Show>
        <Show when={lifetime()}>
          {(life) => (
            <span class="rq-life" classList={{ "rq-life--soon": life().soon }}>
              <Clock size={12} aria-hidden="true" />
              {life().text}
            </span>
          )}
        </Show>
        {props.menu}
      </div>
      <div class="rq-split">
        <div class="rq-main">
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
            <Show when={budget()}>
              <a class={buttonClass({ variant: "primary", size: "compact" })} href={budgetIncidentHref(company().issuePrefix)}>
                Open the budget controls
              </a>
            </Show>
            <Show when={props.hasTask} fallback={<Show when={!budget()}><p class="rq-note">{noActionNote(props.item)}</p></Show>}>
              <Button size="compact" variant={alert() ? "secondary" : "primary"} onClick={() => props.onOpen()}>
                Open the task
              </Button>
            </Show>
          </div>
        </div>
        <aside class="rq-ctx" aria-label="Context">
          {props.aside}
        </aside>
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

/** "Idle 34 days": how long since the item last saw activity. */
export function idleLabel(activityAt: string, now: Date = new Date()) {
  const days = Math.floor((now.getTime() - Date.parse(activityAt)) / (24 * 60 * 60 * 1000));
  return Number.isFinite(days) ? `Idle ${Math.max(days, 0)} day${days === 1 ? "" : "s"}` : "Idle";
}

/** A request on the aging shelf: one line, with how long it's been idle, its task and Keep. */
export function AgingRow(props: { item: AttentionItem; inbox: Inbox; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const task = () => props.inbox.taskOf(props.item);
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
        <Archive size={12} aria-hidden="true" />
        {idleLabel(props.item.activityAt)}
      </span>
      <Button size="compact" variant="quiet" title="Back to Needs you, and kept from being archived" onClick={() => props.inbox.keep(props.item)}>
        Keep
      </Button>
    </li>
  );
}
