import type { AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { BadgeCheck, MessageCircle, Play, Repeat, Square, UserPlus, X, type LucideProps } from "lucide-solid";
import { createMemo, For, Show, type JSX } from "solid-js";
import { agentsApi } from "@/api/agents";
import { chatApi } from "@/api/chat";
import { heartbeatsApi, type LiveRun } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { activityLine, type ActivityLine } from "@/org/org-model";
import { agoLabel, dayLabel, formatDuration } from "@/runs/run-model";
import type { TaskPeople } from "@/tasks/people";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { messageTime } from "./chat-model";

/*
 * The column beside the chat (board 12's Activity): what the agent is doing right now, what's up
 * next, and what it did lately, by day.
 *
 * - Right now: replying in this chat, working on a task (with Watch run and Stop), or idle (with
 *   Wake now). Runs come from the company's live runs.
 * - Up next: its assigned tasks waiting to start (`status=todo`).
 * - The timeline: its activity (`/activity?agentId=`), worded as the Org dashboard words it, with
 *   this chat's own entries called "this chat".
 *
 * On a phone it's a sheet behind the header's Activity button (mobile.md, M9).
 */

const TIMELINE_LIMIT = 40;

/** Bookkeeping the column leaves out: workspace leases and cost reports. */
const SKIPPED = /^(environment|cost|budget)\./;

const ICONS: Record<ActivityLine["tone"], (props: LucideProps) => JSX.Element> = {
  run: Play,
  green: BadgeCheck,
  amber: UserPlus,
  gray: Repeat,
};

export function ChatActivity(props: {
  agent: AgentDetail;
  base: string;
  chatId: string | null;
  replyRuns: readonly LiveRun[];
  otherRuns: readonly LiveRun[];
  people: TaskPeople;
  /** On a phone: shown as a sheet, with a close button. */
  sheet?: boolean;
  onClose?: () => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const now = useNow(() => props.replyRuns.length > 0 || props.otherRuns.length > 0);

  const work = () => props.otherRuns.find((run) => run.status === "running") ?? props.otherRuns[0];
  const workTask = createQuery(() => ({
    queryKey: queryKeys.issues.section(work()?.issueId ?? "", "core"),
    queryFn: ({ signal }) => issuesApi.getCore(work()!.issueId!, signal),
    enabled: !!work()?.issueId,
  }));
  const upNext = createQuery(() => ({
    queryKey: queryKeys.chat.upNext(company().id, props.agent.id),
    queryFn: ({ signal }) => chatApi.upNext(company().id, props.agent.id, signal),
  }));
  const activity = createQuery(() => ({
    queryKey: queryKeys.chat.activity(company().id, props.agent.id),
    queryFn: ({ signal }) => chatApi.activity(company().id, props.agent.id, TIMELINE_LIMIT, signal),
  }));

  const days = createMemo(() => {
    const byId = new Map((agents.data ?? []).map((agent) => [agent.id, agent] as const));
    const names = { agent: (id: string) => byId.get(id), person: props.people.personName, youId: props.people.youId() };
    const groups: { day: string; lines: (ActivityLine & { chat: boolean })[] }[] = [];
    for (const event of activity.data ?? []) {
      if (SKIPPED.test(event.action)) continue;
      const line = activityLine(event, names);
      if (!line) continue;
      const chat = event.entityType === "issue" && event.entityId === props.chatId;
      const entry = chat ? { ...line, target: "this chat", href: undefined, chat } : { ...line, chat };
      const day = dayLabel(line.at);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.lines.push(entry);
      else groups.push({ day, lines: [entry] });
    }
    return groups;
  });

  const stop = async (runId: string) => {
    try {
      await heartbeatsApi.cancel(runId);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't stop the run", body: error instanceof Error ? error.message : String(error) });
    }
  };
  const wake = async () => {
    try {
      await agentsApi.invoke(props.agent.id, company().id);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      pushToast({ tone: "success", title: `Woke ${props.agent.name}` });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't wake the agent", body: error instanceof Error ? error.message : String(error) });
    }
  };
  const since = (run: LiveRun) => (run.startedAt ? formatDuration(now() - new Date(run.startedAt).getTime()) : null);
  const openTask = (task: { id: string; identifier: string | null; title: string; projectId: string | null }) => commands.openTaskModal(task);

  return (
    <aside class="ch-side card" classList={{ "ch-side--sheet": props.sheet }} aria-labelledby={`ch-activity-${props.agent.id}`} role={props.sheet ? "dialog" : undefined}>
      <div class="ch-side-head">
        <h2 class="disp" id={`ch-activity-${props.agent.id}`}>
          Activity
        </h2>
        <Show when={props.sheet}>
          <button type="button" class="btn btn--icon btn--ghost btn--compact ch-push" aria-label="Close activity" onClick={() => props.onClose?.()}>
            <X size={16} aria-hidden="true" />
          </button>
        </Show>
      </div>

      <Show
        when={props.replyRuns[0]}
        fallback={
          <Show
            when={work()}
            fallback={
              <section class="ch-now" aria-label="Right now">
                <span class="ch-now-kicker">
                  <Capsule gradient={props.agent.status === "paused" ? "ember" : "ash"} size="tiny" />
                  {props.agent.status === "paused" ? "Paused" : "Idle"}
                </span>
                <span class="ch-now-title">Nothing running</span>
                <span class="ch-muted">
                  {props.agent.status === "paused" ? "Resume it under Manage agent to chat." : "Wakes on new messages and assignments."}
                </span>
                <Show when={props.agent.status !== "paused" && props.agent.status !== "terminated"}>
                  <div class="ch-now-actions">
                    <button type="button" class="ch-pill-btn" onClick={() => void wake()}>
                      Wake now
                    </button>
                  </div>
                </Show>
              </section>
            }
          >
            {(run) => (
              <section class="ch-now ch-now--live" aria-label="Right now">
                <span class="ch-now-kicker">
                  <Capsule gradient="ion" size="tiny" live />
                  Working now
                </span>
                <Show when={workTask.data} fallback={<span class="ch-now-title">On a task</span>}>
                  {(task) => (
                    <button type="button" class="ch-now-title ch-link" onClick={() => openTask(task())}>
                      <span class="mono">{task().identifier}</span> · {task().title}
                    </button>
                  )}
                </Show>
                <span class="ch-muted">
                  {run().status === "queued" ? "Queued" : `Started ${since(run()) ?? "just now"} ago`}
                </span>
                <div class="ch-now-actions">
                  <button type="button" class="ch-pill-btn" onClick={() => commands.openRunModal(run().id)}>
                    Watch run
                  </button>
                  <button type="button" class="ch-pill-btn ch-pill-btn--stop" onClick={() => void stop(run().id)}>
                    <Square size={11} aria-hidden="true" />
                    Stop
                  </button>
                </div>
              </section>
            )}
          </Show>
        }
      >
        {(run) => (
          <section class="ch-now ch-now--live" aria-label="Right now">
            <span class="ch-now-kicker">
              <Capsule gradient="ion" size="tiny" live />
              Working now
            </span>
            <span class="ch-now-title">Replying to you in this chat</span>
            <span class="ch-muted">{run().status === "queued" ? "About to start, from your message" : `Started ${since(run()) ?? "just now"} ago by your message`}</span>
            <div class="ch-now-actions">
              <button type="button" class="ch-pill-btn ch-pill-btn--stop" onClick={() => void stop(run().id)}>
                <Square size={11} aria-hidden="true" />
                Stop
              </button>
            </div>
          </section>
        )}
      </Show>

      <section class="ch-side-sec" aria-labelledby={`ch-next-${props.agent.id}`}>
        <h3 class="disp" id={`ch-next-${props.agent.id}`}>
          Up next
        </h3>
        <ul class="ch-next">
          <For each={upNext.data ?? []} fallback={<li class="ch-muted">{upNext.isPending ? "Loading…" : "Nothing waiting."}</li>}>
            {(task) => (
              <li>
                <button type="button" class="ch-next-row" onClick={() => openTask(task)}>
                  <span class="mono ch-muted">{task.identifier}</span>
                  <span class="ch-ellipsis">{task.title}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>

      <div class="ch-side-sec ch-tl">
        <For each={days()} fallback={<p class="ch-muted">{activity.isPending ? "Loading activity…" : "No activity yet."}</p>}>
          {(group) => (
            <section aria-label={group.day}>
              <h3 class="disp">{group.day}</h3>
              <ol>
                <For each={group.lines}>
                  {(line) => {
                    const Icon = line.chat ? MessageCircle : ICONS[line.tone];
                    return (
                      <li>
                        <span class={`ch-tl-icon ch-tl-icon--${line.chat ? "run" : line.tone}`} aria-hidden="true">
                          <Icon size={13} />
                        </span>
                        <div class="ch-tl-text">
                          <span>{line.who === props.agent.name ? "" : `${line.who} `}</span>
                          {line.who === props.agent.name ? line.verb.charAt(0).toUpperCase() + line.verb.slice(1) : line.verb}{" "}
                          <Show when={line.href} fallback={<span class="ch-tl-target">{line.target}</span>}>
                            {(href) => (
                              <A class="ch-tl-target" href={`/${company().issuePrefix}${href()}`}>
                                {line.target}
                              </A>
                            )}
                          </Show>
                        </div>
                        <time class="ch-muted" datetime={line.at}>
                          {group.day === "Today" ? agoLabel(line.at, new Date(now())).replace(" ago", "") : messageTime(line.at)}
                        </time>
                      </li>
                    );
                  }}
                </For>
              </ol>
            </section>
          )}
        </For>
      </div>

      <div class="ch-side-foot">
        <A class="ch-link" href={`/${company().issuePrefix}/workload`}>
          Workload
        </A>
        <A class="ch-link" href={`${props.base}/runtime`}>
          Sessions and runs
        </A>
        <A class="ch-link" href={`${props.base}/profile`}>
          Manage agent
        </A>
      </div>
    </aside>
  );
}
