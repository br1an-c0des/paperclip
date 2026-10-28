import { A, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { runsApi, type RunSummary } from "@/api/runs";
import { useChatIndex } from "@/chat/chat-index";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { useMinute } from "@/org/queries";
import { clockTime, dayLabel, formatDuration, runDurationMs, runStatusMeta, tokenCount, triggerLabel } from "@/runs/run-model";
import { useTaskList } from "@/tasks/TasksView";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar } from "@/ui/Avatar";
import { Capsule } from "@/ui/Status";
import { PickMenu } from "./PickMenu";

/*
 * Runs (`/:prefix/activity/runs`, the old hub's Runs section): the company's latest runs, newest
 * first, optionally one agent's (`?agentId=`, as the old agent links have it). Each row opens the
 * run modal. The list is the company run list (`GET /companies/:id/heartbeat-runs?summary=true`),
 * fetched again when a live run starts or finishes; tasks are named from the company task list,
 * and your chats are labelled as chats.
 */

const RUN_LIMIT = 200;

function num(value: string | number | null | undefined) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export function RunsList() {
  const company = useCompany();
  const client = useQueryClient();
  const commands = useCommands();
  const people = useTaskPeople();
  const chats = useChatIndex();
  const live = useLiveRunsQuery();
  const tasks = useTaskList(() => ({}));
  const minute = useMinute();
  const [search, setSearch] = useSearchParams<{ agentId?: string }>();
  const agentId = () => search.agentId || null;

  const runs = createQuery(() => ({
    queryKey: queryKeys.activity.runs(company().id, agentId()),
    queryFn: ({ signal }) => runsApi.list(company().id, { agentId: agentId() ?? undefined, limit: RUN_LIMIT, summary: true }, signal),
    staleTime: 15_000,
  }));
  const liveSignature = createMemo(() =>
    (live.data ?? [])
      .map((run) => `${run.id}:${run.status}`)
      .sort()
      .join(","),
  );
  createEffect(on(liveSignature, () => void client.invalidateQueries({ queryKey: ["activity-runs", company().id] }), { defer: true }));

  const taskById = createMemo(() => new Map((tasks.data ?? []).map((task) => [task.id, task] as const)));
  const days = createMemo(() => {
    const groups: { day: string; runs: RunSummary[] }[] = [];
    for (const run of runs.data ?? []) {
      const day = dayLabel(run.createdAt);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.runs.push(run);
      else groups.push({ day, runs: [run] });
    }
    return groups;
  });

  const taskLabel = (run: RunSummary) => {
    if (!run.issueId) return null;
    const chatWith = chats.agentIdFor(run.issueId);
    if (chatWith) return { text: "Chat", href: chats.href(chatWith) };
    const task = taskById().get(run.issueId);
    return { text: task ? `${task.identifier ?? ""} ${task.title}`.trim() : "A task", href: `/${company().issuePrefix}/issues/${task?.identifier ?? run.issueId}` };
  };

  return (
    <section class="act-section" aria-label="Runs">
      <div class="act-toolbar">
        <PickMenu
          label="Agent"
          allLabel="All agents"
          value={search.agentId}
          options={people.assignableAgents().map((agent) => ({ value: agent.id, label: agent.name, icon: <AgentAvatar agent={agent} size={20} /> }))}
          onPick={(value) => setSearch({ agentId: value }, { replace: true })}
        />
        <span class="org-muted">The latest {RUN_LIMIT} runs.</span>
      </div>
      <section class="card act-card">
        <Switch>
          <Match when={runs.isPending}>
            <p class="org-empty">Loading runs…</p>
          </Match>
          <Match when={runs.isError}>
            <p class="org-empty">Couldn't load the runs. {runs.error instanceof Error ? runs.error.message : ""}</p>
          </Match>
          <Match when={(runs.data ?? []).length === 0}>
            <p class="org-empty">No runs yet.</p>
          </Match>
        </Switch>
        <For each={days()}>
          {(group) => (
            <div class="act-day">
              <h3 class="act-day-head">{group.day}</h3>
              <ol class="act-list">
                <For each={group.runs}>
                  {(run) => {
                    const meta = () => runStatusMeta(run.status);
                    const agent = () => people.agent(run.agentId);
                    const task = () => taskLabel(run);
                    const took = () => runDurationMs(run, new Date(minute()));
                    const tokens = () => num(run.inputTokens) + num(run.cachedInputTokens) + num(run.outputTokens);
                    return (
                      <li class="act-run">
                        <span class="act-run-status">
                          <Capsule gradient={meta().gradient} size="row" live={meta().live} />
                          <span>{meta().label}</span>
                        </span>
                        <span class="act-run-agent">
                          <Show when={agent()} fallback={<span class="org-muted">An agent</span>}>
                            {(found) => (
                              <>
                                <AgentAvatar agent={found()} size={20} />
                                <span class="org-ellipsis">{found().name}</span>
                              </>
                            )}
                          </Show>
                        </span>
                        <span class="act-run-what">
                          <Show when={task()} fallback={<span class="org-muted">{triggerLabel({ invocationSource: run.invocationSource, contextSnapshot: run.contextSnapshot ?? null })}</span>}>
                            {(found) => (
                              <>
                                <A class="act-target org-ellipsis" href={found().href}>
                                  {found().text}
                                </A>
                                <span class="org-muted org-ellipsis">{triggerLabel({ invocationSource: run.invocationSource, contextSnapshot: run.contextSnapshot ?? null })}</span>
                              </>
                            )}
                          </Show>
                        </span>
                        <span class="org-muted act-run-num">{tokens() > 0 ? `${tokenCount(tokens())} tokens` : ""}</span>
                        <span class="org-muted act-run-num">{took() === null ? "" : formatDuration(took()!)}</span>
                        <time class="org-muted act-run-num" datetime={run.createdAt}>
                          {clockTime(run.createdAt).replace(/:\d\d (am|pm)$/, " $1")}
                        </time>
                        <button type="button" class="act-linkish act-run-open" onClick={() => commands.openRunModal(run.id)}>
                          Open
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ol>
            </div>
          )}
        </For>
      </section>
    </section>
  );
}
