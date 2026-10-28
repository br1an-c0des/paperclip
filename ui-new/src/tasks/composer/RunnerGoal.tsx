import type { RunnerGoalAction, RunnerGoalProjection } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { LoaderCircle, Pause, Pencil, Play, Target, Trash2 } from "lucide-solid";
import { createEffect, createSignal, on, Show } from "solid-js";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { runnerGoalApi } from "@/api/runner-goal";
import { useLiveEvent } from "@/lib/live-events";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea } from "@/ui/Field";
import {
  goalActions,
  goalAvailable,
  liveGoalUpdate,
  MAX_OBJECTIVE,
  newRequestId,
  PENDING_LABELS,
  progressParts,
  STATUS_LABELS,
  unfinishedGoal,
  type GoalCommand,
} from "./runner-goal-model";
import "./RunnerGoal.css";

/*
 * The runner goal (`tasks/runner-goal`): the goal an agent's session keeps pursuing across turns,
 * after ui/src/components/task-chat/RunnerGoalWidget.tsx. The composer owns it: its Goal pill and
 * `/goal` commands set it, for the agent the message is for (so picking another agent in "To …"
 * hands the task over with the goal). The card above the composer shows the goal's progress, with
 * Edit, Pause, Resume and Clear as the runner allows.
 *
 * The goal is read per task and agent; the live events push changes (`agent.session.goal.changed`),
 * and an active goal is re-read every 30 seconds.
 */

export type GoalDialog = { action: "edit" | "replace"; objective: string; revision: number };

export function createRunnerGoal(options: { taskId: () => string; agentId: () => string | null; enabled: () => boolean }) {
  const client = useQueryClient();
  const key = () => queryKeys.issues.runnerGoal(options.taskId(), options.agentId());
  const query = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => runnerGoalApi.get(options.taskId(), options.agentId(), signal),
    enabled: options.enabled() && !!options.agentId(),
    retry: false,
    refetchInterval: (state) => (state.state.data?.goal?.status === "active" ? 30_000 : false),
  }));
  const [dialog, setDialog] = createSignal<GoalDialog | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  createEffect(
    on([options.taskId, options.agentId], () => {
      setDialog(null);
      setError(null);
      setExpanded(false);
    }),
  );

  useLiveEvent(["agent.session.goal.changed"], (event) => {
    const next = event.payload as unknown as RunnerGoalProjection;
    if (!next || typeof next !== "object") return;
    const decision = liveGoalUpdate(client.getQueryData<RunnerGoalProjection>(key()), next, { taskId: options.taskId(), agentId: options.agentId() });
    if (decision === "take") client.setQueryData(key(), next);
    else if (decision === "refetch") void query.refetch();
  });

  const current = async () => query.data ?? (await query.refetch()).data;

  /** Applies one action to the goal. Throws with a message the composer or the card shows. */
  const act = async (action: RunnerGoalAction, objective?: string, revision?: number) => {
    setError(null);
    const projection = await current();
    if (!projection?.agentId) throw new Error(projection?.capability.reason ?? "Pick an agent to set a goal.");
    if (!goalAvailable(projection.capability)) throw new Error(projection.capability.reason ?? "This agent's runner doesn't support goals.");
    setPending(true);
    try {
      const accepted = await runnerGoalApi.act(options.taskId(), {
        requestId: newRequestId(),
        agentId: projection.agentId,
        expectedRevision: revision ?? projection.revision,
        action,
        ...(objective ? { objective } : {}),
        ...(action === "replace" ? { confirmReplace: true } : {}),
      });
      client.setQueryData(key(), accepted.projection);
    } catch (failure) {
      const body = failure instanceof ApiError ? (failure.body as { current?: RunnerGoalProjection } | null) : null;
      if (failure instanceof ApiError && failure.status === 409 && body?.current) {
        client.setQueryData(key(), body.current);
        throw new Error("The goal changed while you were working on it. Check it and try again.");
      }
      throw failure instanceof Error ? failure : new Error("The goal action couldn't be applied.");
    } finally {
      setPending(false);
    }
  };

  /** For the card's buttons: shows a failure on the card instead of throwing. */
  const press = (action: RunnerGoalAction) => void act(action).catch((failure: Error) => setError(failure.message));

  const openEdit = async () => {
    const projection = await current();
    if (!projection?.goal) throw new Error("There's no goal to edit.");
    setError(null);
    setDialog({ action: "edit", objective: projection.goal.objective, revision: projection.revision });
  };

  /** Runs what the composer sent: a new objective, or `/goal pause` and the like. */
  const run = async (command: GoalCommand) => {
    if (command.action === "focus") {
      const projection = await current();
      if (!projection?.goal && !projection?.pendingAction) throw new Error("Add an objective after /goal to set a goal.");
      setExpanded(true);
      return;
    }
    if (command.action === "edit") return openEdit();
    if (command.action === "create") {
      const projection = await current();
      if (unfinishedGoal(projection)) {
        setError(null);
        setDialog({ action: "replace", objective: command.objective, revision: projection!.revision });
        return;
      }
      return act("create", command.objective);
    }
    return act(command.action);
  };

  const submitDialog = async () => {
    const open = dialog();
    if (!open || pending()) return;
    const objective = open.objective.trim();
    if (!objective || objective.length > MAX_OBJECTIVE) return;
    try {
      await act(open.action, objective, open.revision);
      setDialog(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return {
    query,
    projection: () => query.data,
    available: () => goalAvailable(query.data?.capability),
    dialog,
    setDialog,
    error,
    setError,
    pending,
    expanded,
    setExpanded,
    press,
    openEdit,
    run,
    submitDialog,
  };
}

export type RunnerGoalControl = ReturnType<typeof createRunnerGoal>;

/** The goal's card above the composer. Shows nothing while there's no goal. */
export function RunnerGoalCard(props: { control: RunnerGoalControl; agentName: string | null }) {
  const c = props.control;
  const projection = () => c.projection();
  const goal = () => projection()?.goal ?? null;
  const actions = () => goalActions(projection());
  const pendingLabel = () => {
    const action = projection()?.pendingAction;
    return action ? PENDING_LABELS[action] : null;
  };
  const visible = () => !!goal() || !!pendingLabel() || !!c.error();
  const status = () => (goal() ? STATUS_LABELS[goal()!.status] : null);

  return (
    <>
      <Show when={visible()}>
        <section class="rg" aria-label="Goal" data-testid="runner-goal">
          <span class="rg-icon" aria-hidden="true">
            <Target size={16} />
          </span>
          <div class="rg-main">
            <div class="rg-head">
              <span class="rg-title">Goal{props.agentName ? ` for ${props.agentName}` : ""}</span>
              <Show when={status()}>
                {(found) => (
                  <span class="rg-tag" data-tone={found().tone} role="status">
                    {found().label}
                  </span>
                )}
              </Show>
              <Show when={goal()?.workingNow}>
                <span class="rg-working" role="status">
                  <span class="rg-dot" aria-hidden="true" />
                  Working now
                </span>
              </Show>
              <Show when={pendingLabel()}>
                {(label) => (
                  <span class="rg-pending" role="status">
                    <LoaderCircle size={12} class="cmp-spin" aria-hidden="true" />
                    {label()}
                  </span>
                )}
              </Show>
            </div>
            <Show when={goal()} fallback={<Show when={!c.error()}><p class="rg-muted">Setting the goal…</p></Show>}>
              {(found) => (
                <>
                  <button
                    type="button"
                    class="rg-objective"
                    classList={{ "rg-objective--open": c.expanded() }}
                    aria-expanded={c.expanded()}
                    title={c.expanded() ? "Show less" : "Show the whole goal"}
                    onClick={() => c.setExpanded(!c.expanded())}
                  >
                    {found().objective}
                  </button>
                  <p class="rg-muted">
                    {progressParts(found(), projection()?.capability).join(" · ")}
                    <Show when={found().lastReason}>{(reason) => <> · {reason()}</>}</Show>
                  </p>
                </>
              )}
            </Show>
            <Show when={!c.dialog() && c.error()}>
              {(message) => (
                <p class="rg-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
          </div>
          <div class="rg-actions">
            <Show when={actions().edit}>
              <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Edit goal" title="Edit goal" disabled={c.pending()} onClick={() => void c.openEdit().catch((failure: Error) => c.setError(failure.message))}>
                <Pencil size={14} aria-hidden="true" />
              </button>
            </Show>
            <Show when={actions().pause}>
              <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Pause goal" title="Pause after this turn" disabled={c.pending()} onClick={() => c.press("pause")}>
                <Pause size={14} aria-hidden="true" />
              </button>
            </Show>
            <Show when={actions().resume}>
              <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Resume goal" title="Resume goal" disabled={c.pending()} onClick={() => c.press("resume")}>
                <Play size={14} aria-hidden="true" />
              </button>
            </Show>
            <Show when={actions().clear}>
              <button type="button" class="btn btn--icon btn--ghost btn--compact rg-clear" aria-label="Clear goal" title="Clear goal" disabled={c.pending()} onClick={() => c.press("clear")}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </Show>
          </div>
        </section>
      </Show>
      <GoalDialogView control={c} />
    </>
  );
}

function GoalDialogView(props: { control: RunnerGoalControl }) {
  const c = props.control;
  const replacing = () => c.dialog()?.action === "replace";
  const objective = () => c.dialog()?.objective ?? "";
  return (
    <Dialog
      open={!!c.dialog()}
      onOpenChange={(open) => {
        if (!open && !c.pending()) c.setDialog(null);
      }}
      title={replacing() ? "Replace the goal?" : "Edit the goal"}
      description={replacing() ? "This clears the unfinished goal and starts a new one with the objective below." : "Change the objective. The goal keeps its progress."}
      width={560}
      hideClose
      footer={
        <>
          <Button disabled={c.pending()} onClick={() => c.setDialog(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!objective().trim() || objective().length > MAX_OBJECTIVE || c.pending()} onClick={() => void c.submitDialog()}>
            {c.pending() ? "Saving…" : replacing() ? "Replace goal" : "Save goal"}
          </Button>
        </>
      }
    >
      <form
        class="rg-form"
        onSubmit={(event) => {
          event.preventDefault();
          void c.submitDialog();
        }}
      >
        <Field label="Objective" for="rg-objective" help={`What the agent keeps working toward, up to ${MAX_OBJECTIVE.toLocaleString()} characters.`}>
          <TextArea
            id="rg-objective"
            rows={5}
            maxLength={MAX_OBJECTIVE}
            value={objective()}
            disabled={c.pending()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              c.setDialog((open) => (open ? { ...open, objective: value } : null));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void c.submitDialog();
              }
            }}
          />
        </Field>
        <Show when={c.error()}>
          {(message) => (
            <p class="rg-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </form>
    </Dialog>
  );
}
