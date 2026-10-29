import type { RoutineDetail } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { ChevronDown } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi } from "@/api/routines";
import { useCompany } from "@/lib/company";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { activityLabel, activitySummary, mergeActivity, type RoutineActivity } from "./details-model";
import { formatFire } from "./schedule";

/*
 * The recurring task's activity (the old routine page's Activity tab, which no board draws): changes
 * to it and its triggers, webhooks that arrived or were refused, and runs that started, newest
 * first, each with who did it. The log is read per entity (the routine, each trigger and each of the
 * latest runs), as the old page reads it; a row with details unfolds to show them.
 */

/** How many of the latest runs' entries to gather; each is its own request. */
const RUN_LIMIT = 20;
const PAGE = 40;

export function RecurringActivity(props: { routine: RoutineDetail }) {
  const company = useCompany();
  const people = useTaskPeople();
  const [limit, setLimit] = createSignal(PAGE);
  const runs = createQuery(() => ({
    queryKey: [...queryKeys.routines.runs(props.routine.id), RUN_LIMIT],
    queryFn: ({ signal }) => routinesApi.runs(props.routine.id, RUN_LIMIT, signal),
  }));
  const related = () => ({
    triggerIds: props.routine.triggers.map((trigger) => trigger.id),
    runIds: (runs.data ?? []).map((run) => run.id),
  });
  const activity = createQuery(() => ({
    queryKey: [...queryKeys.routines.activity(props.routine.id), related().triggerIds.join(","), related().runIds.join(",")],
    queryFn: async ({ signal }) => mergeActivity(await routinesApi.activity(company().id, props.routine.id, related(), signal)),
    enabled: runs.isSuccess || runs.isError,
    placeholderData: (previous) => previous,
  }));
  const shown = createMemo(() => (activity.data ?? []).slice(0, limit()));
  const who = (event: RoutineActivity) => {
    const agent = people.agent(event.agentId ?? (event.actorType === "agent" ? event.actorId : null));
    if (agent) return { name: agent.name, agent };
    if (event.actorType === "user") return { name: event.actorId === people.youId() ? "You" : people.personName(event.actorId) };
    if (event.actorType === "plugin") return { name: "A plugin" };
    return { name: "Paperclip" };
  };

  return (
    <>
      <div class="tsec-head">
        <h2 class="disp">Activity</h2>
        <span class="rpn-head-title">{props.routine.title}</span>
      </div>
      <div class="tsec-scroll">
        <Show
          when={activity.data}
          fallback={<p class="tsec-muted">{activity.isError ? `The activity couldn't be loaded: ${(activity.error as Error).message}` : "Loading activity…"}</p>}
        >
          <Show when={shown().length > 0} fallback={<p class="tsec-muted">No activity yet.</p>}>
            <ol class="rpn-activity" aria-label="Activity">
              <For each={shown()}>
                {(event) => {
                  const [open, setOpen] = createSignal(false);
                  const actor = () => who(event);
                  const summary = () => activitySummary(event);
                  const hasDetails = () => event.details !== null && Object.keys(event.details ?? {}).length > 0;
                  return (
                    <li class="rpn-activity-row">
                      <span class="rpn-revision-who">
                        <Show when={actor().agent} fallback={<InitialsDisc name={actor().name} seed={event.actorId} size={24} you={actor().name === "You"} />}>
                          {(agent) => <AgentAvatar agent={agent()} size={24} ring={false} />}
                        </Show>
                      </span>
                      <div class="rpn-activity-main">
                        <div class="rpn-revision-top">
                          <b>{activityLabel(event.action)}</b>
                          <span>{formatFire(event.createdAt)}</span>
                          <span>· {actor().name}</span>
                        </div>
                        <Show when={summary()}>
                          <span class="rpn-activity-summary">{summary()}</span>
                        </Show>
                        <Show when={open()}>
                          <pre class="mono rpn-activity-details">{JSON.stringify(event.details, null, 2)}</pre>
                        </Show>
                      </div>
                      <Show when={hasDetails()}>
                        <button
                          type="button"
                          class="btn btn--icon btn--ghost btn--compact rpn-activity-toggle"
                          aria-expanded={open()}
                          aria-label={open() ? "Hide the details" : "Show the details"}
                          title={open() ? "Hide the details" : "Show the details"}
                          onClick={() => setOpen(!open())}
                        >
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ol>
            <Show when={(activity.data?.length ?? 0) > limit()}>
              <Button ghost size="compact" class="rpn-older" onClick={() => setLimit(limit() + PAGE)}>
                Show older activity
              </Button>
            </Show>
            <Show when={(runs.data?.length ?? 0) >= RUN_LIMIT}>
              <p class="tsec-muted rpn-activity-note">Shows the activity of the latest {RUN_LIMIT} runs. Runs has every run.</p>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  );
}
