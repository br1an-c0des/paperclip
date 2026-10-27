import type { Issue, IssueWatchdog } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { ChevronDown, Clock, RotateCcw } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import type { TaskPeople } from "./people";
import { boardMonitor, toDateTimeLocal, withMonitor } from "./review-stages";
import type { ChangeTask } from "./TaskEditors";

/*
 * The execution properties of the Details section (board 2's "watchdog, monitor, scheduled retry"),
 * after the Execution section of the old properties panel (ui/src/components/issue-properties/
 * IssueProperties.tsx):
 *
 * - Watchdog: an agent that watches the task and keeps it moving, with optional instructions
 *   (`PUT|DELETE /issues/:id/watchdog`). It opens its own watchdog task when it acts.
 * - Monitor: a re-check scheduled for a time, optionally on an external service, kept in the
 *   execution policy beside the review stages; Check now runs it at once.
 * - Scheduled retry: when the agent's last run is set to try again later, Retry now pulls it forward.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 27, 10:05". */
export function dateTime(value: Date | string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "in 3m", "in 2h", "now", "5m ago". */
export function relativeTime(value: Date | string, now = Date.now()) {
  const minutes = Math.round((new Date(value).getTime() - now) / 60_000);
  if (Math.abs(minutes) < 1) return "now";
  const span = Math.abs(minutes) < 60 ? `${Math.abs(minutes)}m` : Math.abs(minutes) < 48 * 60 ? `${Math.round(Math.abs(minutes) / 60)}h` : `${Math.round(Math.abs(minutes) / 1440)}d`;
  return minutes > 0 ? `in ${span}` : `${span} ago`;
}

const caret = () => <ChevronDown size={13} aria-hidden="true" class="te-caret" />;

export function WatchdogControl(props: {
  task: Issue;
  people: TaskPeople;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [agentId, setAgentId] = createSignal<string | null>(null);
  const [instructions, setInstructions] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const watchdog = () => props.task.watchdog ?? null;
  const agent = () => props.people.agent(watchdog()?.watchdogAgentId);

  const patch = (next: IssueWatchdog | null) => {
    client.setQueryData<Issue>(queryKeys.issues.detail(props.task.id), (current) => (current ? { ...current, watchdog: next } : current));
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
  };
  const save = async () => {
    const chosen = agentId();
    if (!chosen) return;
    setBusy(true);
    try {
      patch(await taskActionsApi.setWatchdog(props.task.id, { agentId: chosen, instructions: instructions().trim() || null }));
      setOpen(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't set the watchdog", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await taskActionsApi.removeWatchdog(props.task.id);
      patch(null);
      setOpen(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't remove the watchdog", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span class="te-inline te-wrap">
      <Popover
        open={open()}
        onOpenChange={(next) => {
          if (next) {
            setAgentId(watchdog()?.watchdogAgentId ?? null);
            setInstructions(watchdog()?.instructions ?? "");
          }
          setOpen(next);
        }}
      >
        <Popover.Trigger class="te-trigger" aria-label={`Watchdog: ${agent()?.name ?? "none"}. Change`}>
          <Show when={agent()} fallback={<span class="te-muted">{watchdog() ? "An agent" : "None"}</span>}>
            {(found) => (
              <>
                <AgentAvatar agent={found()} size={20} />
                {found().name}
              </>
            )}
          </Show>
          <Show when={watchdog()?.status === "disabled"}>
            <span class="te-muted">(off)</span>
          </Show>
          {caret()}
        </Popover.Trigger>
        <Popover.Content label="Watchdog" width={380} hideClose>
          <div class="te-form">
            <p class="te-note">An agent that watches this task and steps in to keep it moving.</p>
            <div class="te-list te-list--short" role="radiogroup" aria-label="Watchdog agent">
              <For each={props.people.assignableAgents()}>
                {(candidate) => (
                  <button type="button" class="te-option" role="radio" aria-checked={agentId() === candidate.id} onClick={() => setAgentId(candidate.id)}>
                    <AgentAvatar agent={candidate} size={20} />
                    <span class="te-option-label">{candidate.name}</span>
                  </button>
                )}
              </For>
            </div>
            <TextArea
              aria-label="Watchdog instructions (optional)"
              placeholder="What should it watch for, and how should it keep work moving? (optional)"
              rows={3}
              value={instructions()}
              onInput={(event) => setInstructions(event.currentTarget.value)}
            />
            <div class="te-pop-foot">
              <Show when={watchdog()}>
                <Button variant="quiet" size="compact" disabled={busy()} onClick={() => void remove()}>
                  Remove
                </Button>
              </Show>
              <Button variant="primary" size="compact" disabled={busy() || !agentId()} onClick={() => void save()}>
                {busy() ? "Saving…" : watchdog() ? "Update" : "Set watchdog"}
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover>
      <Show when={watchdog()?.watchdogIssueId}>
        {(id) => (
          <button type="button" class="te-chip" onClick={() => props.onOpenTask({ id: id(), identifier: null })}>
            Open its task
          </button>
        )}
      </Show>
    </span>
  );
}

export function MonitorControl(props: { task: Issue; onChange: ChangeTask }) {
  const client = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [at, setAt] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [service, setService] = createSignal("");
  const [checking, setChecking] = createSignal(false);
  const policyMonitor = () => props.task.executionPolicy?.monitor ?? null;
  const state = () => props.task.executionState?.monitor ?? null;
  const nextCheckAt = () => state()?.nextCheckAt ?? props.task.monitorNextCheckAt ?? policyMonitor()?.nextCheckAt ?? null;
  const serviceName = () => policyMonitor()?.serviceName ?? state()?.serviceName ?? null;
  const attempts = () => props.task.monitorAttemptCount ?? state()?.attemptCount ?? 0;
  const summary = () => {
    const next = nextCheckAt();
    if (!next) return state()?.status === "cleared" ? "Cleared" : null;
    return [`Next check ${relativeTime(next)}`, serviceName(), attempts() > 0 ? `attempt ${attempts()}` : null].filter(Boolean).join(" · ");
  };
  const set = (monitor: Parameters<typeof withMonitor>[1]) => {
    try {
      props.onChange({ executionPolicy: withMonitor(props.task.executionPolicy, monitor) });
      setOpen(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't change the monitor", body: (error as Error).message });
    }
  };
  const checkNow = async () => {
    setChecking(true);
    try {
      await taskActionsApi.checkMonitorNow(props.task.id);
      pushToast({ tone: "success", title: "Checking now" });
      setOpen(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't run the check", body: (error as Error).message });
    } finally {
      setChecking(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (next) {
          setAt(toDateTimeLocal(policyMonitor()?.nextCheckAt ?? nextCheckAt()));
          setNotes(policyMonitor()?.notes ?? "");
          setService(policyMonitor()?.serviceName ?? "");
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger class="te-trigger" aria-label={`Monitor: ${summary() ?? "none"}. Change`} title={nextCheckAt() ? dateTime(nextCheckAt()!) : undefined}>
        <Show when={summary()} fallback={<span class="te-muted">None</span>}>
          {(text) => (
            <>
              <Clock size={14} aria-hidden="true" class="te-caret" />
              {text()}
            </>
          )}
        </Show>
        {caret()}
      </Popover.Trigger>
      <Popover.Content label="Monitor" width={380} hideClose>
        <form
          class="te-form"
          onSubmit={(event) => {
            event.preventDefault();
            const monitor = boardMonitor({ at: at(), notes: notes(), service: service() });
            if (monitor) set(monitor);
          }}
        >
          <p class="te-note">Have the agent re-check this task at a set time, such as when an outside service should be done.</p>
          <TextInput type="datetime-local" aria-label="Check at" value={at()} onInput={(event) => setAt(event.currentTarget.value)} />
          <TextInput aria-label="What to re-check" placeholder="What should the agent re-check?" value={notes()} onInput={(event) => setNotes(event.currentTarget.value)} />
          <TextInput aria-label="External service (optional)" placeholder="External service (optional)" value={service()} onInput={(event) => setService(event.currentTarget.value)} />
          <div class="te-pop-foot">
            <Show when={policyMonitor()}>
              <Button variant="quiet" size="compact" onClick={() => set(null)}>
                Clear
              </Button>
              <Button size="compact" disabled={checking()} onClick={() => void checkNow()}>
                {checking() ? "Checking…" : "Check now"}
              </Button>
            </Show>
            <Button variant="primary" size="compact" type="submit" disabled={!at()}>
              Schedule
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover>
  );
}

/** Shown while the agent's last run is set to try again later. */
export function ScheduledRetryControl(props: { task: Issue }) {
  const client = useQueryClient();
  const [busy, setBusy] = createSignal(false);
  const retry = () => props.task.scheduledRetry ?? null;
  const continuation = () => retry()?.scheduledRetryReason === "max_turns_continuation";
  const label = () => {
    const at = retry()?.scheduledRetryAt;
    const what = continuation() ? "Continues" : "Retries";
    return at ? `${what} ${relativeTime(at)}` : "Waiting to be scheduled";
  };
  const now = async () => {
    setBusy(true);
    try {
      const answer = await taskActionsApi.retryScheduledNow(props.task.id);
      pushToast({ tone: answer.outcome === "promoted" || answer.outcome === "already_promoted" ? "success" : "info", title: answer.message || "Retrying now" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't retry now", body: (error as Error).message });
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
    }
  };
  return (
    <Show when={retry()?.status === "scheduled_retry"} fallback={<span class="te-muted">None</span>}>
      <span class="te-inline te-wrap">
        <RotateCcw size={14} aria-hidden="true" class="te-caret" />
        <span title={retry()?.scheduledRetryAt ? dateTime(retry()!.scheduledRetryAt!) : undefined}>{label()}</span>
        <Show when={(retry()?.scheduledRetryAttempt ?? 0) > 0}>
          <span class="te-muted">attempt {retry()!.scheduledRetryAttempt}</span>
        </Show>
        <button type="button" class="te-chip" disabled={busy()} onClick={() => void now()}>
          {busy() ? "Retrying…" : continuation() ? "Continue now" : "Retry now"}
        </button>
      </span>
    </Show>
  );
}
