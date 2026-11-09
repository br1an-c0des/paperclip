import type { AttentionItem, AttentionSubject, IssueDisplayStatus } from "@paperclipai/shared";
import { ArrowUpRight, BadgeCheck, ChevronDown, ChevronRight, CircleHelp, CircleMinus, Clock, NotebookPen, ShieldCheck, Sparkles, TriangleAlert } from "lucide-solid";
import { For, Match, Show, Switch, type JSX } from "solid-js";
import type { RequestKind } from "@/requests/request-model";
import { stampLabel } from "@/tasks/thread-model";
import type { TaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc, PersonAvatar } from "@/ui/Avatar";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import type { InboxGroup } from "./group-model";
import { shortAge, type RowModel, type RowSign, type RowWho } from "./row-model";
import "./InboxRow.css";

/*
 * Board 14b's pieces for Needs you: the collapsed request row and the group header.
 *
 * The row is one button that opens the card: the kind stripe, the type pill, the title (with the
 * New mark), a questions card's questions, the signs, the task ID, who's asking and the age. It
 * holds no actions; snooze and clear stay on s and y for the selected row. `hide` drops what a group
 * header already shows.
 *
 * The header folds its group (the chevron button) and links out (Open): a task (status, ID, title,
 * project), an agent (avatar, name, whether it's running), a project (letter disc, name), or a
 * catch-all, with a count and its one most-urgent sign.
 */

const KIND_ICON: Record<RequestKind, () => JSX.Element> = {
  question: () => <CircleHelp size={12} aria-hidden="true" />,
  proposal: () => <Sparkles size={12} aria-hidden="true" />,
  approval: () => <ShieldCheck size={12} aria-hidden="true" />,
  signoff: () => <BadgeCheck size={12} aria-hidden="true" />,
};

const SIGN_ICON = {
  clock: () => <Clock size={11} aria-hidden="true" />,
  warn: () => <TriangleAlert size={11} aria-hidden="true" />,
  block: () => <CircleMinus size={11} aria-hidden="true" />,
  plan: () => <NotebookPen size={11} aria-hidden="true" />,
};

export function Sign(props: { sign: RowSign }) {
  return (
    <span class="ibx-chip" classList={{ [`ibx-chip--${props.sign.tone}`]: props.sign.tone !== "plain" }}>
      {props.sign.icon ? SIGN_ICON[props.sign.icon]() : null}
      {props.sign.text}
    </span>
  );
}

/** The little disc for who's asking: an agent's avatar, a person's, an outside agent's dashed one, or Paperclip's. */
export function WhoMark(props: { who: RowWho; people: TaskPeople; size?: 20 | 24 }) {
  const size = () => props.size ?? 20;
  const name = () => {
    const who = props.who;
    if (who.kind === "agent") return props.people.agent(who.agentId)?.name ?? who.name;
    if (who.kind === "person") return who.userId === props.people.youId() ? "You" : who.name || props.people.personName(who.userId);
    if (who.kind === "outside") return who.name;
    return "Paperclip";
  };
  return (
    <span class="ibx-who" title={name()}>
      <Switch>
        <Match when={props.who.kind === "agent" && props.who}>
          {(who) => (
            <Show when={props.people.agent(who().agentId)} fallback={<InitialsDisc name={who().name} seed={who().agentId} size={size()} label={name()} />}>
              {(agent) => <AgentAvatar agent={agent()} size={size()} label={name()} />}
            </Show>
          )}
        </Match>
        <Match when={props.who.kind === "person" && props.who}>
          {(who) => (
            <PersonAvatar name={name()} seed={who().userId} image={props.people.personImage(who().userId)} size={size()} you={who().userId === props.people.youId()} label={name()} />
          )}
        </Match>
        <Match when={props.who.kind === "outside"}>
          <span class="ibx-disc ibx-disc--outside" role="img" aria-label={`${name()}, outside agent`} style={{ width: `${size()}px`, height: `${size()}px` }}>
            {initialsOf(name())}
          </span>
        </Match>
        <Match when={props.who.kind === "paperclip"}>
          <span class="ibx-disc ibx-disc--paperclip" role="img" aria-label="Paperclip" style={{ width: `${size()}px`, height: `${size()}px` }}>
            P
          </span>
        </Match>
      </Switch>
    </span>
  );
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function CollapsedRow(props: {
  item: AttentionItem;
  row: RowModel;
  task: Pick<AttentionSubject, "identifier" | "title"> | null;
  hide: "task" | "who" | null;
  fresh: boolean;
  people: TaskPeople;
  now: Date;
  /** The card's element id, for `aria-controls`. */
  controls: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      class="ibx-cr"
      data-kind={props.row.kind}
      data-waiting={props.row.waiting ? "" : undefined}
      data-settled={props.row.settled ? "" : undefined}
      aria-expanded="false"
      aria-controls={props.controls}
      onClick={() => props.onOpen()}
    >
      <span class="ibx-cr-type">
        {KIND_ICON[props.row.kind]()}
        <span class="ibx-cr-type-text">{props.row.type}</span>
      </span>
      <span class="ibx-cr-main">
        <span class="ibx-cr-title">
          <Show when={props.fresh}>
            <span class="ibx-cr-new" title="New since you last looked" />
            <span class="sr-only">New: </span>
          </Show>
          <span class="ibx-cr-title-text">{props.row.title}</span>
        </span>
        <Show when={props.row.questions.length > 0}>
          <span class="ibx-cr-qs">
            <For each={props.row.questions}>
              {(question, index) => (
                <span class="ibx-cr-q">
                  <span class="ibx-cr-qn">{index() + 1}</span>
                  <span class="ibx-cr-qt">{question}</span>
                </span>
              )}
            </For>
            <Show when={props.row.moreQuestions > 0}>
              <span class="ibx-cr-q ibx-cr-q--more">
                <span class="ibx-cr-qn" />
                <span class="ibx-cr-qt">+ {props.row.moreQuestions} more</span>
              </span>
            </Show>
          </span>
        </Show>
      </span>
      <span class="ibx-cr-meta">
        <For each={props.row.signs}>{(sign) => <Sign sign={sign} />}</For>
        <Show when={props.hide !== "task" && props.task?.identifier}>
          <span class="ibx-cr-task mono" title={props.task?.title ?? undefined}>
            {props.task!.identifier}
          </span>
        </Show>
        <Show when={props.hide !== "who" && props.row.who}>{(who) => <WhoMark who={who()} people={props.people} />}</Show>
      </span>
      <span class="ibx-cr-age" title={stampLabel(props.row.at, props.now)}>
        {shortAge(props.row.at, props.now)}
      </span>
      <ChevronDown size={14} aria-hidden="true" class="ibx-cr-chev" />
    </button>
  );
}

export type HeaderEntry = { item: AttentionItem; task: AttentionSubject | null; row: RowModel; fresh: boolean };

export function GroupHeader(props: {
  group: InboxGroup<HeaderEntry>;
  folded: boolean;
  selected: boolean;
  sign: RowSign | null;
  people: TaskPeople;
  /** The task's display status (Monitoring), when its Updates row knows it. */
  displayStatus?: IssueDisplayStatus | null;
  /** Whether the agent is running now. */
  running?: boolean;
  /** Where Open goes; none for a catch-all. */
  href?: string | null;
  onOpen?: (event: MouseEvent) => void;
  onFold: () => void;
  onSelect: () => void;
}) {
  const first = () => props.group.items[0];
  const task = () => (props.group.kind === "task" ? (first()?.task ?? null) : null);
  const project = () => first()?.item.project ?? null;
  const taskStatus = (): IssueDisplayStatus | null => {
    const status = props.displayStatus ?? task()?.status ?? null;
    return status && Object.hasOwn(STATUS_META, status) ? (status as IssueDisplayStatus) : null;
  };
  const agent = () => (props.group.kind === "agent" && props.group.id ? props.people.agent(props.group.id) : undefined);
  const agentState = () => {
    if (props.running) return "running";
    const status = agent()?.status;
    return status === "paused" ? "paused" : status === "error" ? "error" : status ? "idle" : null;
  };
  const openLabel = () => `Open ${props.group.kind === "task" ? (task()?.identifier ?? "the task") : props.group.label}`;
  return (
    <div
      class="ibx-gh"
      classList={{ "ibx-gh--selected": props.selected }}
      data-inbox-item={props.group.key}
      tabindex="-1"
      onFocusIn={() => props.onSelect()}
      onPointerDown={() => props.onSelect()}
    >
      <button type="button" class="ibx-gh-fold" aria-expanded={!props.folded} aria-controls={`ibx-gh-rows-${props.group.key.replace(/[^\w-]/g, "-")}`} onClick={() => props.onFold()}>
        <ChevronRight size={14} aria-hidden="true" class="ibx-gh-chev" />
        <Switch fallback={<span class="ibx-gh-none" aria-hidden="true" />}>
          <Match when={props.group.kind === "task"}>
            <Show when={taskStatus()} fallback={<span class="ibx-gh-none" aria-hidden="true" />}>
              {(status) => <StatusCapsule status={status()} size="row" title={STATUS_META[status()].label} />}
            </Show>
          </Match>
          <Match when={props.group.kind === "agent" && props.group.id}>
            {(id) => <WhoMark who={{ kind: "agent", agentId: id(), name: props.group.label }} people={props.people} size={24} />}
          </Match>
          <Match when={props.group.kind === "project" && props.group.id}>
            {(id) => <InitialsDisc name={props.group.label.slice(0, 1)} seed={id()} size={20} />}
          </Match>
          <Match when={props.group.kind === "paperclip"}>
            <WhoMark who={{ kind: "paperclip" }} people={props.people} size={20} />
          </Match>
        </Switch>
        <span class="ibx-gh-name">
          <Show when={props.group.kind === "task" && task()?.identifier}>
            <span class="mono">{task()!.identifier}</span>
          </Show>
          <span class="ibx-gh-t">{props.group.kind === "agent" ? (agent()?.name ?? props.group.label) : props.group.label}</span>
          <Show when={props.group.kind === "task" && project()}>{(found) => <span class="ibx-gh-proj">{found().name}</span>}</Show>
          <Show when={props.group.kind === "agent" && agentState()}>
            {(state) => (
              <span class="ibx-gh-proj" classList={{ "ibx-gh-running": state() === "running" }}>
                {state()}
              </span>
            )}
          </Show>
        </span>
        <span class="ibx-gh-count" aria-label={`${props.group.items.length} ${props.group.items.length === 1 ? "request" : "requests"}`}>
          {props.group.items.length}
        </span>
        <Show when={props.sign}>{(sign) => <Sign sign={sign()} />}</Show>
      </button>
      <Show when={props.href}>
        {(href) => (
          <a
            class="ibx-gh-open"
            href={href()}
            aria-label={openLabel()}
            onClick={(event) => {
              if (!props.onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              props.onOpen(event);
            }}
          >
            <span class="ibx-gh-open-label">Open</span>
            <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
      </Show>
    </div>
  );
}
