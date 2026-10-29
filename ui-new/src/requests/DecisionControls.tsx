import type { DecisionEffect, DecisionOption } from "@paperclipai/shared";
import { createMutation, createQueries, useQueryClient } from "@tanstack/solid-query";
import { Ban, Check, CircleAlert, CornerDownRight, LoaderCircle, Minus, TriangleAlert, X } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { decisionsApi, type DecisionOutcome, type DecisionTargetSnapshot } from "@/api/decisions";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import type { TaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Footer } from "./card-parts";
import {
  cancelTreeEffect,
  changedTargets,
  effectComment,
  effectPreview,
  effectResult,
  heldBack,
  isDestructive,
  referencedIssueIds,
  statusWord,
  type IssueRef,
} from "./decision-model";
import type { Request } from "./request-model";

/*
 * A proposal's controls (board 15): pick an option, see what it changes (now and after, from the
 * proposal's snapshot of each task), fill in its text inputs, then apply it or decline. Changed
 * targets are flagged above the options, and options with strict changes to them are held back.
 * Cancelling a task tree asks for the task's identifier first. Decided proposals list what each
 * change did (`DecisionResults`, in the settled card).
 *
 * Task labels come from each task's detail query, so a task the proposal names is read once and
 * shared with the rest of the board.
 */

type Source = Extract<Request["source"], { type: "decision" }>;

/** The tasks a proposal names, as identifier and title, read through each task's detail query. */
export function useIssueRefs(ids: () => readonly string[], origin?: () => IssueRef | null) {
  const queries = createQueries(() => ({
    queries: ids().map((id) => ({
      queryKey: queryKeys.issues.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => issuesApi.get(id, signal),
      staleTime: 30_000,
    })),
  }));
  const byId = createMemo(() => {
    const map = new Map<string, IssueRef>();
    const first = origin?.();
    if (first) map.set(first.id, first);
    ids().forEach((id, index) => {
      const issue = queries[index]?.data;
      if (issue) map.set(id, { id, identifier: issue.identifier ?? null, title: issue.title ?? null, status: issue.status ?? null });
    });
    return map;
  });
  return (id: string) => byId().get(id) ?? null;
}

function originRef(request: Request): IssueRef | null {
  const subject = request.subject;
  if (!subject?.issueId) return null;
  return { id: subject.issueId, identifier: subject.title ? subject.label : null, title: subject.title ?? subject.label, status: null };
}

type Row = { what: string; now: string | null; after: string; struck?: boolean };

/** One effect as a "now → after" row, for the diff under the options. */
function effectRow(
  effect: DecisionEffect,
  resolve: (id: string) => IssueRef | null,
  snapshots: Record<string, DecisionTargetSnapshot>,
  nameOf: (agentId: string | null | undefined, userId: string | null | undefined) => string,
): Row {
  const ref = resolve(effect.targetIssueId);
  const target = ref?.identifier ?? ref?.title ?? "The task";
  const snapshot = snapshots[effect.targetIssueId];
  const excerpt = (body: string) => `"${body.trim().length > 60 ? `${body.trim().slice(0, 60)}…` : body.trim()}"`;
  switch (effect.type) {
    case "update_issue_status":
      return { what: `${target} status`, now: statusWord(snapshot?.status ?? ref?.status), after: statusWord(effect.status) };
    case "assign_issue":
      return {
        what: `${target} assignee`,
        now: snapshot ? (snapshot.assigneeAgentId || snapshot.assigneeUserId ? nameOf(snapshot.assigneeAgentId, snapshot.assigneeUserId) : "Nobody") : null,
        after: effect.assigneeAgentId || effect.assigneeUserId ? nameOf(effect.assigneeAgentId, effect.assigneeUserId) : "Nobody",
      };
    case "resolve_blocker":
      return {
        what: `${target} blocked by`,
        now: effect.removeBlockedByIssueIds.map((id) => resolve(id)?.identifier ?? "a task").join(", "),
        after: "Removed",
        struck: true,
      };
    case "comment_on_issue":
      return { what: `Comment on ${target}`, now: "None", after: excerpt(effect.bodyMarkdown) };
    case "create_issue":
      return { what: "New task", now: "None", after: `"${effect.draft.title}"` };
    case "cancel_issue_tree":
      return { what: `${target} and everything under it`, now: statusWord(snapshot?.status ?? ref?.status), after: "Cancelled" };
  }
}

export function DecisionControls(props: { request: Request; source: Source; people: TaskPeople; onDone: () => void }) {
  const client = useQueryClient();
  const company = useCompany();
  const decision = () => props.source.decision;
  const resolve = useIssueRefs(
    () => referencedIssueIds(decision()),
    () => originRef(props.request),
  );
  const nameOf = (agentId: string | null | undefined, userId: string | null | undefined) =>
    agentId ? (props.people.agent(agentId)?.name ?? "an agent") : userId ? (userId === props.people.youId() ? "you" : props.people.personName(userId)) : "nobody";
  const snapshots = () => decision().targetSnapshots ?? {};
  const changed = createMemo(() => changedTargets(props.source.targetChanged));

  const [picked, setPicked] = createSignal<string | null>(null);
  const [inputs, setInputs] = createSignal<Record<string, string>>({});
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const option = createMemo(() => decision().options.find((entry) => entry.id === picked()) ?? null);
  const optionNumber = () => decision().options.findIndex((entry) => entry.id === picked()) + 1;
  const missing = () => (decision().inputs ?? []).some((field) => field.required && !inputs()[field.id]?.trim());
  const tree = () => (option() ? cancelTreeEffect(option()!) : null);
  const treeToken = () => {
    const effect = tree();
    if (!effect) return "";
    const ref = resolve(effect.targetIssueId);
    return ref?.identifier ?? effect.targetIssueId;
  };

  const settle = (outcome: DecisionOutcome) => {
    setError(null);
    client.setQueryData(queryKeys.decisions.detail(outcome.id), outcome);
    void client.invalidateQueries({ queryKey: queryKeys.decisions.open(company().id) });
    for (const id of Object.keys(outcome.targetSnapshots ?? {})) void client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) });
    props.onDone();
  };
  const decide = createMutation(() => ({
    mutationFn: (choice: DecisionOption) => {
      const values = Object.fromEntries(Object.entries(inputs()).filter(([, value]) => value.trim()));
      return decisionsApi.decide(decision().id, { optionId: choice.id, inputValues: values, idempotencyKey: crypto.randomUUID() });
    },
    onSuccess: settle,
    onError: (failure: Error) => setError(failure.message),
  }));
  const dismiss = createMutation(() => ({
    mutationFn: () => decisionsApi.dismiss(decision().id),
    onSuccess: settle,
    onError: (failure: Error) => setError(failure.message),
  }));
  const busy = () => decide.isPending || dismiss.isPending;
  const blocked = (entry: DecisionOption) => heldBack(entry, changed());
  const applyLabel = () => {
    const current = option();
    if (!current) return "Pick an option";
    if (tree()) return "Cancel the tree";
    return decision().options.length > 1 ? `Apply option ${optionNumber()}` : `Apply: ${current.label}`;
  };
  const rows = createMemo(() => (option()?.effects ?? []).map((effect) => ({ effect, row: effectRow(effect, resolve, snapshots(), nameOf) })));

  return (
    <>
      <Show when={changed().size > 0}>
        <div class="rq-alert" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            {[...changed()].map((id) => resolve(id)?.identifier ?? "A task").join(", ")} changed after this was proposed. Options with strict changes to{" "}
            {changed().size === 1 ? "it" : "them"} are held back.
          </span>
        </div>
      </Show>
      <div class="rq-opts" role="radiogroup" aria-label="Options">
        <For each={decision().options}>
          {(entry) => (
            <button
              type="button"
              class="rq-opt"
              classList={{ "rq-opt--danger": isDestructive(entry) }}
              role="radio"
              aria-checked={picked() === entry.id}
              disabled={busy() || blocked(entry)}
              onClick={() => {
                setPicked(entry.id);
                setConfirm("");
              }}
            >
              <span class="rq-radio" aria-hidden="true" />
              <span class="rq-opt-main">
                {entry.label}
                <Show when={blocked(entry)}>
                  <span class="rq-tag rq-tag--warn">Held back: its task changed</span>
                </Show>
                <Show when={entry.description}>
                  <small>{entry.description}</small>
                </Show>
                <Show when={entry.effects.length === 0}>
                  <small>No changes.</small>
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={rows().length > 0}>
        <div class="rq-diff" role="table" aria-label={`What option ${optionNumber()} changes`}>
          <div class="rq-drow" role="row">
            <span role="columnheader">{decision().options.length > 1 ? `Change if you apply option ${optionNumber()}` : "Change if you apply it"}</span>
            <span role="columnheader">Now</span>
            <span role="columnheader">After</span>
          </div>
          <For each={rows()}>
            {({ effect, row }) => (
              <div class="rq-drow" role="row" classList={{ "rq-drow--danger": effect.type === "cancel_issue_tree" }}>
                <span role="cell" title={effectPreview(effect, resolve, snapshots(), nameOf)}>
                  {row.what}
                </span>
                <span role="cell" classList={{ "rq-was": row.struck }}>
                  {row.now ?? "—"}
                </span>
                <span role="cell">{row.after}</span>
              </div>
            )}
          </For>
        </div>
        <For each={(option()?.effects ?? []).flatMap((effect) => (effect.type !== "comment_on_issue" && effectComment(effect) ? [effectComment(effect)!] : []))}>
          {(comment) => (
            <div class="rq-body rq-body--quote">
              <Markdown source={comment} />
            </div>
          )}
        </For>
      </Show>
      <For each={decision().inputs ?? []}>
        {(field) => (
          <TextArea
            aria-label={field.label}
            rows={2}
            placeholder={`${field.label}${field.required ? " (required)" : " (optional)"}${field.placeholder ? `: ${field.placeholder}` : ""}`}
            maxLength={field.maxLength}
            value={inputs()[field.id] ?? ""}
            disabled={busy()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setInputs((current) => ({ ...current, [field.id]: value }));
            }}
          />
        )}
      </For>
      <Show when={tree()}>
        <div class="rq-alert rq-alert--danger" role="alert">
          <Ban size={14} aria-hidden="true" />
          <span>
            This cancels {treeToken()} and every task under it. Type <b class="mono">{treeToken()}</b> to confirm.
          </span>
        </div>
        <TextInput aria-label="Type the task's identifier to confirm" placeholder={treeToken()} value={confirm()} onInput={(event) => setConfirm(event.currentTarget.value)} />
      </Show>
      <Footer request={props.request} error={error()}>
        <Button
          size="compact"
          variant={tree() ? "danger" : "primary"}
          disabled={busy() || !option() || missing() || (!!tree() && confirm().trim() !== treeToken())}
          onClick={() => option() && decide.mutate(option()!)}
        >
          {applyLabel()}
        </Button>
        <Show when={!decision().options.some((entry) => entry.effects.length === 0)}>
          <Button size="compact" disabled={busy()} onClick={() => dismiss.mutate()}>
            Decline
          </Button>
        </Show>
      </Footer>
    </>
  );
}

/** What each change did, for a decided proposal. */
export function DecisionResults(props: { request: Request; source: Source }) {
  const resolve = useIssueRefs(
    () => referencedIssueIds(props.source.decision),
    () => originRef(props.request),
  );
  const company = useCompany();
  const rows = createMemo(() => (props.source.decision.executions ?? []).map((execution) => effectResult(execution, resolve)));
  return (
    <Show when={rows().length > 0}>
      <ul class="rq-results" aria-label="What each change did">
        <For each={rows()}>
          {(row) => (
            <li class="rq-res" data-tone={row.tone === "ok" ? "ok" : row.tone}>
              <Switch fallback={<CornerDownRight size={14} aria-hidden="true" />}>
                <Match when={row.tone === "ok"}>
                  <Check size={14} aria-hidden="true" />
                </Match>
                <Match when={row.tone === "bad"}>
                  <X size={14} aria-hidden="true" />
                </Match>
                <Match when={row.tone === "mid"}>
                  <Minus size={14} aria-hidden="true" />
                </Match>
                <Match when={row.text.startsWith("Running")}>
                  <LoaderCircle size={14} aria-hidden="true" />
                </Match>
              </Switch>
              <span>{row.text}</span>
              <Show when={row.issueId && resolve(row.issueId!)?.identifier}>
                {(identifier) => (
                  <a class="rq-res-link mono" href={`/${company().issuePrefix}/issues/${encodeURIComponent(identifier())}`}>
                    {identifier()}
                  </a>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.source.decision.executionStatus === "partial" || props.source.decision.executionStatus === "failed"}>
        <p class="rq-note">
          <CircleAlert size={13} aria-hidden="true" /> Some changes may already have been applied. Check the results before asking for a new proposal.
        </p>
      </Show>
    </Show>
  );
}
