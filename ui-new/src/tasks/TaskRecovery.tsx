import type { Issue, IssueRecoveryAction } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronDown, LifeBuoy } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ApiError } from "@/api/client";
import { confirmOwnerGone, confirmRunStopped, issuesApi, recordControllerContainment } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import {
  askRefusal,
  boundAction,
  fileRecoveryView,
  sandboxDiskFullRest,
  isRetainedExport,
  readSavedRequest,
  requestStorageKey,
  saveRequest,
  sourceVerified,
  unverifiedSourceText,
} from "./recover-files";
import {
  canConfirmServerStop,
  canDismissRecovery,
  CONTAINMENT_OUTCOMES,
  containmentBody,
  containmentFormKey,
  controllerContainment,
  previousServerStop,
  recoveryCard,
  resolveBody,
  STOP_EVIDENCE_MIN,
  stopConfirmationBody,
  stopFormKey,
  type ContainmentOutcome,
  type ControllerContainment,
  type PreviousServerStop,
  type RecoveryOutcome,
} from "./recovery-actions";
import { newRequestId } from "./request-id";
import { useBoardAccess } from "./TaskActions";

/*
 * The recovery card for a task's active recovery action (recovery-actions.ts), with the notices at
 * the top of every section: what went wrong, the server's next step, and, when a person is needed,
 * the ways out (Try again, Mark done, Send for review, or for the board, dismiss it as raised in
 * error). The old UI drew it in the thread (IssueRecoveryActionCard.tsx).
 *
 * A native export hold also gets Recover saved files (recover-files.ts, since the 2026-11-05 sync).
 * Since the 2026-11-07 sync, an action waiting for word that the previous server stopped gets
 * Confirm the previous server stopped, for owners and admins (`previousServerStop`), and the card
 * tells the task's notices whether it offers its own way on (`onOwnsRetry`), so the task's Retry
 * gives way only then (#19840). Since the 2026-11-09 sync the same confirmation covers a record
 * saved before Paperclip stored which server held it (`ownership_owner_unprovable`), keyed by the
 * record's version so a refreshed record starts a fresh form.
 *
 * Since the 2026-11-10 sync: original-host containment (#19813) gets its own form
 * (`ContainmentForm`), keyed by the server's authority snapshot, in place of the next-step menu;
 * and ConfirmServerStopped also confirms a run that never recorded its process (#20310), from the
 * task's notices, with no recovery action.
 */

const STATE_TONE = { needed: "amber", in_progress: "neutral", observing: "neutral" } as const;
const STATE_TITLE = { needed: "Recovery needed", in_progress: "Recovery in progress", observing: "Watching the run" } as const;

export function TaskRecovery(props: { task: Issue; onOwnsRetry?: (owns: boolean) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const access = useBoardAccess();
  const [busy, setBusy] = createSignal(false);
  const board = () => {
    const current = access();
    return canDismissRecovery(props.task.companyId, current.access, current.localTrusted);
  };
  const card = createMemo(() => recoveryCard(props.task.activeRecoveryAction, { board: board() }));
  const owner = () => {
    const action = props.task.activeRecoveryAction;
    if (!action) return null;
    if (action.ownerType === "board") return "the board";
    if (action.ownerAgentId) return people.agent(action.ownerAgentId)?.name ?? "an agent";
    if (action.ownerUserId) return action.ownerUserId === people.youId() ? "you" : people.personName(action.ownerUserId);
    return null;
  };
  const stop = createMemo(() => previousServerStop(props.task.activeRecoveryAction, props.task.id, props.task.companyId));
  // Original-host containment (#19813): its own form, and no other way out.
  const containment = createMemo(() => controllerContainment(props.task.activeRecoveryAction, props.task.id, props.task.companyId));
  const retained = () => {
    const action = props.task.activeRecoveryAction;
    return !stop() && isRetainedExport(action, props.task.id, props.task.companyId) ? action : null;
  };
  const [filesOwnRetry, setFilesOwnRetry] = createSignal(true);
  // The confirmation is the one way on while it's asked for; Recover saved files only on a verified source.
  createEffect(() => props.onOwnsRetry?.(!!stop() || (!!retained() && filesOwnRetry())));
  onCleanup(() => props.onOwnsRetry?.(false));

  const resolve = async (outcome: RecoveryOutcome) => {
    const action = props.task.activeRecoveryAction;
    if (!action) return;
    setBusy(true);
    try {
      await issuesApi.resolveRecoveryAction(props.task.id, resolveBody(action.id, outcome));
      pushToast({ tone: "success", title: "Recovery closed" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't close the recovery", body: (error as Error).message });
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    }
  };

  return (
    <Show when={card()}>
      {(found) => (
        <section class="tn-row tn-recovery" data-tone={STATE_TONE[found().state]} role="status" aria-label="Recovery">
          <span class="tn-icon" aria-hidden="true">
            <LifeBuoy size={16} />
          </span>
          <div class="tn-text">
            <b>
              {STATE_TITLE[found().state]} · {found().kindLabel}
            </b>
            <span>{found().headline}</span>
            <Show when={found().detail}>{(detail) => <span class="tn-recovery-detail mono">{detail()}</span>}</Show>
            <Show when={found().nextAction}>{(next) => <span class="tn-recovery-next">Next: {next()}</span>}</Show>
            <span class="tn-recovery-meta">
              <Show when={owner()}>{(who) => <>With {who()}</>}</Show>
              <Show when={found().attempts}>{(attempts) => <> · {attempts()}</>}</Show>
            </span>
            <Show when={stop()}>
              {(found) => (
                <Show keyed when={stopFormKey(props.task.activeRecoveryAction!.id, found())}>
                  <ConfirmServerStopped stop={found()} actionId={props.task.activeRecoveryAction!.id} task={props.task} />
                </Show>
              )}
            </Show>
            <Show when={containment()}>
              {(found) => (
                <Show keyed when={containmentFormKey(props.task.activeRecoveryAction!.id, found())}>
                  <ContainmentForm containment={found()} action={props.task.activeRecoveryAction!} task={props.task} />
                </Show>
              )}
            </Show>
            <Show when={retained()}>
              {(action) => (
                <Show keyed when={`${action().id}:${String(action().evidence.runId)}`}>
                  <RecoverSavedFiles action={action()} task={props.task} canAsk={board()} onOwnsRetry={setFilesOwnRetry} />
                </Show>
              )}
            </Show>
          </div>
          <Show when={found().outcomes.length > 0}>
            <div class="tn-action">
              <Menu placement="bottom-end">
                <Menu.Trigger as={Button} size="compact" disabled={busy()}>
                  {busy() ? "Working…" : "Choose next step"}
                  <ChevronDown size={12} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Content label="Next step" width={280}>
                  <For each={found().outcomes}>
                    {(option) => (
                      <Menu.Item danger={option.boardOnly} description={option.description} onSelect={() => void resolve(option.outcome)}>
                        {option.label}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Recover saved files for a native export hold. Board members who aren't viewers may ask; the ask
 * is read against a fresh inspection first, and its key is saved before it's sent.
 */
export function RecoverSavedFiles(props: { action: IssueRecoveryAction; task: Issue; canAsk: boolean; onOwnsRetry: (owns: boolean) => void }) {
  const client = useQueryClient();
  const people = useTaskPeople();
  const runId = props.action.evidence.runId as string;
  const issueId = props.task.id;
  const companyId = props.task.companyId;
  const [asking, setAsking] = createSignal(false);
  const [acknowledged, setAcknowledged] = createSignal(false);
  const [checkedUnconfirmed, setCheckedUnconfirmed] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  // Bumped after each save, so the view reads the saved key again.
  const [saves, setSaves] = createSignal(0);

  const source = createQuery(() => ({
    queryKey: queryKeys.issues.section(issueId, "recovery-actions", props.action.id, runId),
    queryFn: ({ signal }) => issuesApi.recoveryActions(issueId, { runId, actionId: props.action.id }, signal),
    enabled: props.canAsk,
    retry: false,
  }));
  const ownerId = () => people.youId() ?? "local";
  const key = () => requestStorageKey(companyId, issueId, props.action.id, runId, ownerId());
  const saved = () => (saves(), readSavedRequest(storage(), key(), props.action.id, runId));
  const current = () => boundAction(source.data, props.action, runId, issueId, companyId);
  const view = createMemo(() =>
    fileRecoveryView({
      current: current(),
      inspected: source.isSuccess || source.isError,
      inspectionFailed: source.isError,
      verified: sourceVerified(source.data),
      unverifiedText: unverifiedSourceText(source.data?.sourceInspection),
      pendingKey: saved()?.idempotencyKey ?? null,
      acknowledged: acknowledged(),
      checkedUnconfirmed: checkedUnconfirmed(),
      // A save that rested on a full sandbox disk hands over to Retry (U129, #20819).
      diskFull: sandboxDiskFullRest(current() ?? props.action),
    }),
  );
  // Someone who can't ask, or a source that didn't verify, leaves the task's Retry as the way on.
  createEffect(() => props.onOwnsRetry(props.canAsk && view().ownsRetry));
  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    void client.invalidateQueries({ queryKey: queryKeys.issues.section(issueId, "runs") });
  };

  const ask = async (restart: boolean) => {
    if (asking()) return;
    setAsking(true);
    setNotice(null);
    setCheckedUnconfirmed(false);
    setAcknowledged(false);
    try {
      const observed = await source.refetch();
      if (observed.error) throw new Error("File recovery couldn't be checked. Check its status again.");
      const previous = saved();
      const refusal = askRefusal(boundAction(observed.data, props.action, runId, issueId, companyId), restart, previous?.idempotencyKey ?? null);
      if (refusal) throw new Error(refusal);
      if (!sourceVerified(observed.data)) {
        throw new Error(unverifiedSourceText(observed.data?.sourceInspection) || "The saved files' source couldn't be verified.");
      }
      // An answer that never came keeps its key; only a confirmed failed attempt gets a new one.
      const request = (!restart && previous) || { idempotencyKey: newRequestId(), actionId: props.action.id, runId, createdAt: Date.now() };
      if (!saveRequest(storage(), key(), request)) throw new Error("This browser wouldn't save the request, so nothing was sent.");
      setSaves((count) => count + 1);
      try {
        const result = await issuesApi.recoverWorkspace(issueId, { actionId: request.actionId, runId, idempotencyKey: request.idempotencyKey });
        if (result.actionId !== props.action.id || !["queued", "recovering", "blocked", "recovered"].includes(result.status)) {
          throw new Error("The recovery answer couldn't be confirmed.");
        }
        setAcknowledged(true);
        refresh();
        await source.refetch();
      } catch (error) {
        const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
        setNotice(
          refused
            ? `The recovery wasn't accepted: ${error.message}`
            : "The recovery request couldn't be confirmed. Check its status before trying again; the saved request will be sent again.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setAsking(false);
    }
  };

  const check = async () => {
    setAsking(true);
    try {
      const observed = await source.refetch();
      if (observed.error) throw new Error("File recovery couldn't be checked. Check its status again.");
      const fresh = boundAction(observed.data, props.action, runId, issueId, companyId);
      if (!fresh) throw new Error("File recovery changed. Open the task again to see where it is.");
      const ids = (fresh.evidence.workspaceRecovery as { requestIds?: unknown } | undefined)?.requestIds;
      const pending = saved();
      const unconfirmed = !!pending && !(Array.isArray(ids) && ids.includes(pending.idempotencyKey));
      setCheckedUnconfirmed(unconfirmed);
      setNotice(unconfirmed ? "No recovery request is confirmed yet. Trying again sends the saved one." : null);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div class="tn-files" data-testid="recover-saved-files">
      <Show
        when={props.canAsk}
        fallback={<span class="tn-recovery-meta">A board member with access to the task can recover the saved files.</span>}
      >
        <span>{view().message}</span>
        <Show when={source.isPending}>
          <span class="tn-recovery-meta">Checking the recorded files…</span>
        </Show>
        <Show when={view().offer || view().check}>
          <span class="tn-files-actions">
            <Show when={view().offer}>
              {(offer) => (
                <Button size="compact" variant="primary" disabled={asking()} onClick={() => void ask(offer() === "again")}>
                  {asking() ? "Asking…" : offer() === "again" ? "Try file recovery again" : "Recover saved files"}
                </Button>
              )}
            </Show>
            <Show when={view().check}>
              <Button size="compact" variant="quiet" disabled={asking()} onClick={() => void check()}>
                Check file recovery status
              </Button>
            </Show>
          </span>
        </Show>
        <Show when={view().unverified}>{(text) => <span class="tn-recovery-meta" role="status">{text()}</span>}</Show>
        <Show when={notice() ?? view().alert}>{(text) => <span class="tn-files-alert" role="alert">{text()}</span>}</Show>
      </Show>
    </div>
  );
}

const STOP_COPY = {
  owner: {
    question: "How did you confirm that the previous server and its file copy stopped?",
    placeholder: "For example: the old server process exited and was not restarted.",
    resuming: "Restoring saved work…",
    confirm: "Confirm the previous server stopped",
    nobody: "A company owner or admin can confirm that the previous server stopped.",
  },
  controller: {
    question: "How did you confirm that the previous server stopped?",
    placeholder: "For example: the old server container was replaced and is no longer running.",
    // Since the 2026-11-10 sync (#19813), in the old UI's words: recovery checks again after it.
    resuming: "Controller stop recorded. Checking recovery…",
    confirm: "Confirm the previous server stopped",
    nobody: "A company owner or admin can confirm that the previous server stopped.",
  },
  // A run that never recorded its process (#20310), in the old UI's words.
  run: {
    question: "How did you confirm that no agent is still working on this task?",
    placeholder: "For example: no codex or claude process for this task is running on the server host.",
    resuming: "Starting your Retry…",
    confirm: "Confirm it stopped",
    nobody: "A company owner or admin can confirm that the previous run stopped.",
  },
} as const;

/** The form's words: an unprovable record's "resuming" line names what's released (#20067). */
function stopCopy(stop: PreviousServerStop) {
  if (stop.kind !== "owner-gone") return STOP_COPY[stop.kind];
  return { ...STOP_COPY.controller, resuming: stop.resource.releasing };
}

/**
 * Confirm the previous server stopped (#19717, #19742): a server that can no longer report can't
 * confirm its own stop, so an owner or admin does, once, saying how they checked. The saved result
 * then finishes without another agent turn. Nothing is sent until they submit.
 *
 * Since the 2026-11-10 sync the same form confirms a run that never recorded its process (#20310,
 * `stop.kind: "run"`), from the task's notice: it has no recovery action (`actionId` is null), and
 * the task's parked Retry starts once it's confirmed.
 */
export function ConfirmServerStopped(props: { stop: PreviousServerStop; actionId: string | null; task: Issue }) {
  const client = useQueryClient();
  const company = useCompany();
  const access = useBoardAccess();
  const [open, setOpen] = createSignal(false);
  const [evidence, setEvidence] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [done, setDone] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const copy = () => stopCopy(props.stop);
  const formId = () => props.actionId ?? `${props.task.id}-${props.stop.kind === "owner-gone" ? props.stop.recordId : props.stop.runId}`;
  const allowed = () => {
    const current = access();
    return canConfirmServerStop(props.task.companyId, current.access, current.localTrusted);
  };
  const body = () => stopConfirmationBody(props.stop, props.actionId ?? "", evidence());

  const confirm = async () => {
    const data = body();
    if (!data || sending()) return;
    setSending(true);
    setFailure(null);
    try {
      let line: string = copy().resuming;
      if (data.kind === "owner") await issuesApi.resumeWorkspaceFinalization(props.task.id, data.body);
      else if (data.kind === "controller") await issuesApi.confirmControllerStopped(props.task.id, data.body);
      else if (data.kind === "run") {
        const receipt = await confirmRunStopped(props.task.id, data.body);
        // The answer carries the task's interruption after the confirmation; show it at once.
        client.setQueryData<Issue>(queryKeys.issues.detail(props.task.id), (old) => (old ? { ...old, interruption: receipt.presentation } : old));
      } else {
        const receipt = await confirmOwnerGone(props.task.id, data.body);
        // Let go by another path meanwhile: the server closes the request with nothing to confirm.
        if (receipt.status === "released") line = "It was already released, so no confirmation was needed.";
      }
      setDone(line);
      setOpen(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The confirmation wasn't accepted. Open the task again and try again.");
    } finally {
      setSending(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.task.id, "runs") });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    }
  };

  return (
    <div class="tn-files" data-testid="previous-server-stop">
      <Show when={!done()} fallback={<span role="status">{done()}</span>}>
        <Show when={allowed()} fallback={<span class="tn-recovery-meta">{copy().nobody}</span>}>
          <Show
            when={open()}
            fallback={
              <Button size="compact" variant="primary" onClick={() => setOpen(true)}>
                {copy().confirm}
              </Button>
            }
          >
            <form
              class="tn-stop"
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <label class="tn-recovery-meta" for={`previous-server-stop-${formId()}`}>
                {copy().question}
              </label>
              <TextArea
                id={`previous-server-stop-${formId()}`}
                rows={3}
                maxLength={12000}
                placeholder={copy().placeholder}
                value={evidence()}
                ref={(element) => queueMicrotask(() => element.focus())}
                onInput={(event) => setEvidence(event.currentTarget.value)}
              />
              <span class="tn-files-actions">
                <Button size="compact" variant="quiet" disabled={sending()} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="compact" variant="primary" disabled={!body() || sending()} title={body() ? undefined : `Say how you checked, in at least ${STOP_EVIDENCE_MIN} characters`}>
                  {sending() ? "Confirming…" : "Confirm and resume"}
                </Button>
              </span>
            </form>
          </Show>
        </Show>
      </Show>
      <Show when={failure()}>{(text) => <span class="tn-files-alert" role="alert">{text()}</span>}</Show>
    </div>
  );
}

/**
 * Verify the original execution stopped (#19813; the old UI's NativeControllerContainmentRecovery):
 * Paperclip can't compare process ids across hosts or kernel sessions, so an owner or admin
 * confirms, separately, that the controller and the provider with its tools stopped on their
 * original host, chooses the reviewed outcome of the run's external actions, and says what they
 * found. The authority digest comes from the server's snapshot and is never shown or typed. It
 * settles the hold without retrying; Retry stays a separate step.
 */
export function ContainmentForm(props: { containment: ControllerContainment; action: IssueRecoveryAction; task: Issue }) {
  const client = useQueryClient();
  const company = useCompany();
  const access = useBoardAccess();
  const [controllerStopped, setControllerStopped] = createSignal(false);
  const [providerStopped, setProviderStopped] = createSignal(false);
  const [actionOutcome, setActionOutcome] = createSignal<ContainmentOutcome | "">("");
  const [evidence, setEvidence] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const allowed = () => {
    const current = access();
    return canConfirmServerStop(props.task.companyId, current.access, current.localTrusted);
  };
  const body = () =>
    containmentBody(props.containment, props.action.id, props.task.status, {
      controllerStopped: controllerStopped(),
      providerStopped: providerStopped(),
      actionOutcome: actionOutcome(),
      evidence: evidence(),
    });
  const id = (part: string) => `containment-${props.action.id}-${part}`;

  const record = async () => {
    const data = body();
    if (!data || sending()) return;
    setSending(true);
    setFailure(null);
    try {
      await recordControllerContainment(props.task.id, data);
      setDone(true);
      pushToast({ tone: "success", title: "Containment recorded", body: "Use Retry when you want another attempt." });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The containment wasn't recorded. Open the task again and try again.");
    } finally {
      setSending(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.task.id, "runs") });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    }
  };

  return (
    <div class="tn-files" data-testid="controller-containment">
      <span>
        Stop both the controller and the provider on the original host before recording evidence. The saved lease must also expire and the
        environment and workspace cleanup must finish. Recording containment doesn't retry the task.
      </span>
      <Show when={!done()} fallback={<span role="status">Containment recorded. Use Retry when you want another attempt.</span>}>
        <Show
          when={allowed()}
          fallback={<span class="tn-recovery-meta">A company owner, company admin or instance admin must review this original-host execution.</span>}
        >
          <form
            class="tn-stop"
            onSubmit={(event) => {
              event.preventDefault();
              void record();
            }}
          >
            <label class="tn-check">
              <input type="checkbox" checked={controllerStopped()} onChange={(event) => setControllerStopped(event.currentTarget.checked)} />
              <span>I verified the original controller stopped on its original host.</span>
            </label>
            <label class="tn-check">
              <input type="checkbox" checked={providerStopped()} onChange={(event) => setProviderStopped(event.currentTarget.checked)} />
              <span>I verified the original provider and its tools stopped on their original host.</span>
            </label>
            <label class="tn-recovery-meta" for={id("outcome")}>
              Reviewed external action outcomes
            </label>
            <select
              id={id("outcome")}
              class="input"
              value={actionOutcome()}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setActionOutcome(CONTAINMENT_OUTCOMES.some((option) => option.value === value) ? (value as ContainmentOutcome) : "");
              }}
            >
              <option value="">Select only after reviewing the effects</option>
              <For each={CONTAINMENT_OUTCOMES}>{(option) => <option value={option.value}>{option.label}</option>}</For>
            </select>
            <label class="tn-recovery-meta" for={id("evidence")}>
              Original-host containment evidence, and actions that must not be repeated
            </label>
            <TextArea id={id("evidence")} rows={3} maxLength={12000} value={evidence()} onInput={(event) => setEvidence(event.currentTarget.value)} />
            <span class="tn-recovery-meta">
              If any action's outcome is still unknown, keep this hold. After the evidence and cleanup settle, use the task's Retry separately.
            </span>
            <span class="tn-files-actions">
              <Button
                type="submit"
                size="compact"
                variant="primary"
                disabled={!body() || sending()}
                title={body() ? undefined : `Confirm both stops, choose the outcome, and describe the evidence in at least ${STOP_EVIDENCE_MIN} characters`}
              >
                {sending() ? "Recording…" : "Record containment"}
              </Button>
            </span>
          </form>
        </Show>
      </Show>
      <Show when={failure()}>{(text) => <span class="tn-files-alert" role="alert">{text()}</span>}</Show>
    </div>
  );
}
