import type { AgentDetail, IssueStatus } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Activity, MessageCircleOff, RotateCcw, Search, SlidersHorizontal, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { instanceSettingsApi } from "@/api/instance-settings";
import { viewport } from "@/layout/breakpoints";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { useYouName } from "@/lib/session";
import { RequestCard } from "@/requests/RequestCard";
import { QueuedMessages } from "@/tasks/composer/QueuedMessages";
import { MessageBody } from "@/tasks/MessageBody";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Capsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { ChatActivity } from "./ChatActivity";
import { ChatComposer } from "./ChatComposer";
import { messageTime, quietRunText, shortDate, statusTag, type ChatEntry, type ChatTask } from "./chat-model";
import { LiveReply } from "./LiveReply";
import { useChat } from "./use-chat";
import "./Chat.css";

/*
 * Agent chat (boards 12 and 13): one endless conversation with the agent at its own address, never
 * the task page, though it's a hidden task underneath (decision 8). The thread is messages, hand-off
 * and report cards, requests, session lines and the live reply; under it the queue and the
 * composer, with a strip while the agent works on something else; beside it the Activity column
 * (a sheet on a phone). Runs open in the run modal over the chat (board 18).
 *
 * While the instance's `enableAgentChat` is off, the chat routes answer 404, so the view says so and
 * points to the agent's settings (decision 2, option 2).
 */

/** Shared between the header's buttons and the view. */
export type ChatControls = ReturnType<typeof createChatControls>;

export function createChatControls() {
  const [searching, setSearching] = createSignal(false);
  const [activityOpen, setActivityOpen] = createSignal(false);
  const [available, setAvailable] = createSignal(false);
  let newSession: () => void = () => undefined;
  return {
    searching,
    setSearching,
    activityOpen,
    setActivityOpen,
    /** Whether the chat is on and loaded, so the header shows its buttons. */
    available,
    setAvailable,
    newSession: () => newSession(),
    bindNewSession: (run: () => void) => {
      newSession = run;
    },
  };
}

/** The header's chat buttons (board 12): search the conversation, New session, and Activity on a phone. */
export function ChatHeaderActions(props: { controls: ChatControls }) {
  return (
    <Show when={props.controls.available()}>
      <Button
        variant="icon"
        ghost
        size="compact"
        aria-label={props.controls.searching() ? "Close search" : "Search this conversation"}
        aria-pressed={props.controls.searching()}
        onClick={() => props.controls.setSearching(!props.controls.searching())}
      >
        <Search size={15} aria-hidden="true" />
      </Button>
      <Show when={viewport() !== "desktop"}>
        <Button variant="icon" ghost size="compact" aria-label="Activity" aria-expanded={props.controls.activityOpen()} onClick={() => props.controls.setActivityOpen(!props.controls.activityOpen())}>
          <Activity size={15} aria-hidden="true" />
        </Button>
      </Show>
      <Button size="compact" title="Same as typing /new" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => props.controls.newSession()}>
        New session
      </Button>
    </Show>
  );
}

export function ChatView(props: { agent: AgentDetail; base: string; controls: ChatControls }) {
  const company = useCompany();
  const commands = useCommands();
  const youName = useYouName();
  const projects = useProjectsQuery();
  const state = useChat(() => props.agent);
  const general = createQuery(() => ({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.general(),
    staleTime: 5 * 60_000,
  }));
  let composer: { focus: () => void; send: (body: string) => Promise<boolean> } | undefined;

  createEffect(() => props.controls.setAvailable(!state.off() && !state.loading() && !state.error()));
  createEffect(on(() => props.controls.searching(), (open) => !open && state.setSearch("")));
  props.controls.bindNewSession(() => {
    if (!state.chat()) return composer?.focus();
    void composer?.send("/new");
  });

  const projectName = (id: string | null) => (id ? projects.data?.find((project) => project.id === id)?.name : undefined);
  const replyRunId = () => state.replyRuns()[0]?.id ?? null;
  const work = () => state.otherRuns().find((run) => run.status === "running") ?? state.otherRuns()[0];
  const workTask = createQuery(() => ({
    queryKey: queryKeys.issues.section(work()?.issueId ?? "", "core"),
    queryFn: ({ signal }) => issuesApi.getCore(work()!.issueId!, signal),
    enabled: !!work()?.issueId,
  }));
  const disabledReason = () =>
    props.agent.status === "terminated"
      ? `${props.agent.name} is retired, so it can't reply.`
      : props.agent.status === "paused"
        ? `${props.agent.name} is paused. Resume it to chat.`
        : null;

  // Keep the newest in view: on opening, and when something arrives at the foot while the reader
  // is near it. Older pages loading above don't move the reader.
  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  const toBottom = () => requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  createEffect(on(() => state.loading(), (loading) => !loading && toBottom()));
  let wasAtBottom = true;
  const footKey = createMemo(() => {
    const entries = state.entries();
    return `${entries[entries.length - 1]?.key ?? ""}:${state.replies().map((turn) => turn.runId).join(",")}:${state.queue.data?.entries.length ?? 0}`;
  });
  createEffect(on(footKey, () => wasAtBottom && toBottom(), { defer: true }));
  const onScroll = () => (wasAtBottom = atBottom());
  window.addEventListener("scroll", onScroll, { passive: true });
  onCleanup(() => window.removeEventListener("scroll", onScroll));

  const oldestLoaded = () => {
    const pages = state.comments.data?.pages;
    const last = pages?.[pages.length - 1];
    return last?.[last.length - 1]?.createdAt ?? null;
  };

  const activity = (sheet: boolean) => (
    <ChatActivity
      agent={props.agent}
      base={props.base}
      chatId={state.chatId()}
      replyRuns={state.replyRuns()}
      otherRuns={state.otherRuns()}
      people={state.people}
      sheet={sheet}
      onClose={() => props.controls.setActivityOpen(false)}
    />
  );

  return (
    <Switch>
      <Match when={state.off()}>
        <ChatOff agent={props.agent} base={props.base} />
      </Match>
      <Match when={state.loading()}>
        <section class="card ch-note" role="status">
          <p class="ch-muted">Loading the conversation…</p>
        </section>
      </Match>
      <Match when={state.error()}>
        {(error) => (
          <section class="card ch-note" role="alert">
            <p>The conversation couldn't be loaded: {error().message}</p>
          </section>
        )}
      </Match>
      <Match when={true}>
        <div class="ch">
          <div class="ch-main">
            <Show when={props.controls.searching()}>
              <div class="ch-search">
                <TextInput
                  type="search"
                  value={state.search()}
                  ref={(element) => queueMicrotask(() => element.focus())}
                  onInput={(event) => state.setSearch(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Escape" && props.controls.setSearching(false)}
                  placeholder={`Search your conversation with ${props.agent.name}`}
                  aria-label="Search this conversation"
                />
                <Button variant="icon" ghost size="compact" aria-label="Close search" onClick={() => props.controls.setSearching(false)}>
                  <X size={15} aria-hidden="true" />
                </Button>
              </div>
            </Show>

            <div class="ch-log" role="log" aria-label={`Conversation with ${props.agent.name}`}>
              <Show when={state.comments.hasNextPage}>
                <button type="button" class="ch-more" disabled={state.comments.isFetchingNextPage} onClick={() => void state.comments.fetchNextPage()}>
                  {state.comments.isFetchingNextPage ? "Loading earlier messages…" : `Load earlier messages${oldestLoaded() ? ` · before ${shortDate(oldestLoaded()!)}` : ""}`}
                </button>
              </Show>
              <Show when={state.entries().length === 0 && state.replies().length === 0}>
                <Show
                  when={state.search()}
                  fallback={
                    <div class="ch-empty">
                      <AgentAvatar agent={props.agent} size={48} />
                      <p class="disp">Your conversation with {props.agent.name}</p>
                      <p class="ch-muted">
                        Ask a question, think something through, or describe work. {props.agent.name} plans with you here and hands the work off as tasks,
                        which show up as cards and report back when they're done.
                      </p>
                    </div>
                  }
                >
                  <p class="ch-muted ch-center">No messages match “{state.search()}”.</p>
                </Show>
              </Show>
              <For each={state.entries()}>
                {(entry) => (
                  <Entry
                    entry={entry}
                    agent={props.agent}
                    chatId={state.chatId() ?? ""}
                    youName={youName()}
                    projectName={projectName}
                    people={state.people}
                  />
                )}
              </For>
              <Show when={!state.search()}>
                <For each={state.replies()}>{(turn) => <LiveReply turn={turn} agent={props.agent} censorUsername={general.data?.censorUsernameInLogs === true} />}</For>
              </Show>
              <Show when={state.queue.data && state.chatId()}>
                <QueuedMessages taskId={state.chatId()!} queue={state.queue.data!} />
              </Show>
            </div>

            <div class="ch-foot">
              <Show when={work()}>
                {(run) => (
                  <div class="ch-strip" role="status">
                    <Capsule gradient="ion" size="tiny" live />
                    <span>
                      <strong>Working on {workTask.data?.identifier ?? "a task"}</strong>
                      <Show when={workTask.data}>{(task) => <span class="ch-strip-title"> · {task().title}</span>}</Show>. Replies here run alongside it.
                    </span>
                    <button type="button" class="ch-link ch-push" onClick={() => commands.openRunModal(run().id)}>
                      Watch run
                    </button>
                  </div>
                )}
              </Show>
              <ChatComposer
                agent={props.agent}
                chat={state.chat()}
                ensure={state.ensure}
                replyRunId={replyRunId()}
                disabledReason={disabledReason()}
                ref={(api) => (composer = api)}
              />
            </div>
          </div>

          <Show when={viewport() === "desktop"} fallback={<Show when={props.controls.activityOpen()}>{<div class="ch-scrim" onClick={() => props.controls.setActivityOpen(false)} />}{activity(true)}</Show>}>
            {activity(false)}
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function Entry(props: {
  entry: ChatEntry;
  agent: AgentDetail;
  chatId: string;
  youName: string;
  projectName: (id: string | null) => string | undefined;
  people: ReturnType<typeof useChat>["people"];
}) {
  return (
    <Switch>
      <Match when={props.entry.kind === "day" && props.entry}>
        {(day) => (
          <div class="ch-sep" role="separator">
            {day().label}
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "session" && props.entry}>
        {(session) => (
          <div class="ch-sep ch-sep--session" role="separator">
            <RotateCcw size={13} aria-hidden="true" />
            New session started {shortDate(session().at)}. {props.agent.name} doesn't remember the messages above.
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "message" && props.entry}>{(message) => <Message entry={message()} agent={props.agent} youName={props.youName} projectName={props.projectName} people={props.people} />}</Match>
      <Match when={props.entry.kind === "handoff" && props.entry}>
        {(handoff) => (
          <div class="ch-msg ch-msg--card">
            <span class="ch-av" aria-hidden="true" />
            <TaskCard task={handoff().task} meta="Created from this chat" projectName={props.projectName} people={props.people} />
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "report" && props.entry}>
        {(report) => (
          <div class="ch-msg ch-msg--card">
            <span class="ch-av">
              <AgentAvatar agent={props.agent} size={32} />
            </span>
            <TaskCard
              task={report().task}
              kicker={report().task.status === "done" ? "Report" : "Report in progress"}
              meta={`From a recurring task · ${report().task.status === "done" ? "finished" : "started"} ${messageTime(report().at)}`}
              projectName={props.projectName}
              people={props.people}
            />
          </div>
        )}
      </Match>
      <Match when={props.entry.kind === "run" && props.entry}>
        {(entry) => {
          const commands = useCommands();
          const failed = () => entry().run.status === "failed" || entry().run.status === "timed_out";
          return (
            <div class="ch-msg ch-msg--card">
              <span class="ch-av" aria-hidden="true" />
              <p class="ch-quiet" classList={{ "ch-quiet--failed": failed() }}>
                <span>
                  {props.people.agent(entry().run.agentId)?.name ?? props.agent.name} {quietRunText(entry().run)}
                </span>
                <time class="ch-muted" datetime={entry().at.toISOString()}>
                  {messageTime(entry().at)}
                </time>
                <button type="button" class="ch-link" onClick={() => commands.openRunModal(entry().run.runId)}>
                  Transcript
                </button>
              </p>
            </div>
          );
        }}
      </Match>
      <Match when={props.entry.kind === "request" && props.entry}>
        {(request) => (
          <div class="ch-msg ch-msg--card">
            <span class="ch-av" aria-hidden="true" />
            <div class="ch-request">
              <RequestCard request={request().request} taskId={props.chatId} people={props.people} inThread />
            </div>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function Message(props: {
  entry: Extract<ChatEntry, { kind: "message" }>;
  agent: AgentDetail;
  youName: string;
  projectName: (id: string | null) => string | undefined;
  people: ReturnType<typeof useChat>["people"];
}) {
  const author = () => props.entry.author;
  const agent = () => (author().kind === "agent" ? (author().id === props.agent.id ? props.agent : props.people.agent(author().id)) : undefined);
  const name = () => {
    const kind = author().kind;
    if (kind === "agent") return agent()?.name ?? "An agent";
    if (kind === "you") return props.youName;
    if (kind === "person") return props.people.personName(author().id!);
    return "Paperclip";
  };
  const notice = () => props.entry.comment.presentation?.kind === "system_notice";
  return (
    <article class="ch-msg" classList={{ "ch-msg--cont": !props.entry.head, "ch-msg--you": author().kind === "you", "ch-msg--notice": notice() }} data-tone={props.entry.comment.presentation?.tone}>
      <span class="ch-av">
        <Show when={props.entry.head}>
          <Switch fallback={<InitialsDisc name={name()} seed={author().id ?? name()} size={32} you={author().kind === "you"} />}>
            <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={32} />}</Match>
          </Switch>
        </Show>
      </span>
      <div class="ch-msg-body">
        <Show when={props.entry.head}>
          <div class="ch-msg-head">
            <span class="ch-name">{name()}</span>
            <Show when={props.entry.comment.presentation?.title}>{(title) => <span class="ch-tag">{title()}</span>}</Show>
            <time class="ch-muted" datetime={new Date(props.entry.comment.createdAt).toISOString()}>
              {messageTime(props.entry.comment.createdAt)}
            </time>
          </div>
        </Show>
        <Show when={!props.entry.comment.deletedAt} fallback={<p class="ch-muted">This message was deleted.</p>}>
          <MessageBody source={props.entry.comment.body} />
        </Show>
        <For each={props.entry.tasks}>
          {(task) => <TaskCard task={task} meta="Created from this chat" projectName={props.projectName} people={props.people} />}
        </For>
      </div>
    </article>
  );
}

const STATUS_TONE: Partial<Record<IssueStatus, string>> = {
  in_progress: "run",
  in_review: "violet",
  todo: "amber",
  blocked: "red",
  done: "green",
};

/** A task handed off from the chat, or a report (board 12's linked card). Opens in the task modal. */
function TaskCard(props: {
  task: ChatTask;
  meta: string;
  kicker?: string;
  projectName: (id: string | null) => string | undefined;
  people: ReturnType<typeof useChat>["people"];
}) {
  const company = useCompany();
  const commands = useCommands();
  const assignee = () => props.people.agent(props.task.assigneeAgentId)?.name;
  const meta = () => [props.meta, props.projectName(props.task.projectId), assignee() ? `assigned to ${assignee()}` : null].filter(Boolean).join(" · ");
  const tone = () => STATUS_TONE[props.task.status];
  return (
    <a
      class="ch-task"
      href={issuePath(company().issuePrefix, props.task)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        commands.openTaskModal({ id: props.task.id, identifier: props.task.identifier, title: props.task.title, projectId: props.task.projectId });
      }}
    >
      <Capsule gradient={STATUS_META[props.task.status].gradient} size="row" live={props.task.status === "in_progress"} />
      <span class="ch-task-text">
        <Show when={props.kicker}>
          <span class="ch-task-kicker">{props.kicker}</span>
        </Show>
        <span class="ch-task-title">
          <span class="mono ch-muted">{props.task.identifier}</span>
          <span class="ch-ellipsis">{props.task.title}</span>
        </span>
        <span class="ch-task-meta">{meta()}</span>
      </span>
      <span class="ch-task-status" style={tone() ? { background: `var(--${tone()}-bg)`, color: `var(--${tone()}-fg)` } : undefined}>
        {statusTag(props.task.status)}
      </span>
    </a>
  );
}

/** Decision 2's fallback: chat is off on this instance, so say so and point to the settings. */
function ChatOff(props: { agent: AgentDetail; base: string }) {
  return (
    <section class="card ch-off" role="status">
      <span class="ch-off-icon" aria-hidden="true">
        <MessageCircleOff size={20} />
      </span>
      <div>
        <p class="ch-off-title disp">Agent chat is off on this instance</p>
        <p>
          Chatting with {props.agent.name} needs the instance's agent chat setting (<span class="mono">enableAgentChat</span>), which an instance
          admin turns on in the experimental settings. Until then, {props.agent.name}'s settings, sessions and spend are under Manage agent, and you
          can give it work as a task.
        </p>
        <div class="ch-off-links">
          <A class={buttonClass({ size: "compact", variant: "primary" })} href={`${props.base}/profile`}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            Manage agent
          </A>
          <A class={buttonClass({ size: "compact" })} href={`${props.base}/runtime`}>
            Sessions and runs
          </A>
        </div>
      </div>
    </section>
  );
}
