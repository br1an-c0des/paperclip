import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsInteraction,
  IssueThreadInteraction,
  RequestCheckboxConfirmationInteraction,
  RequestConfirmationInteraction,
  RequestItemVerdictsInteraction,
  RequestItemVerdictValue,
  SuggestTasksInteraction,
} from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  CircleHelp,
  Clock,
  CornerDownRight,
  Ellipsis,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { interactionsApi, type AcceptInteraction, type ItemVerdict } from "@/api/interactions";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { stampLabel } from "@/tasks/thread-model";
import type { TaskPeople } from "@/tasks/people";
import { KIND_LABEL, type Request, type RequestKind } from "./request-model";
import "./RequestCard.css";

/*
 * Board 15's request card, in a task's Activity thread, the Inbox and the project dashboard. One card
 * for every kind: the kind, subject, lifetime and a menu on top; who's asking and why; the ask; the
 * response controls its shape needs; the "what happens next" line; the actions and who can answer.
 *
 * - Open requests take an answer. Set-aside ones (dismissed) shrink to one line in the history and
 *   open again to answer. Settled ones collapse to the ask, the decision and its result, apart.
 * - Agent requests answer through `/issues/:id/interactions/:id/*`; approvals through
 *   `/approvals/:id/*`, with their own discussion under the card; sign-offs through the task's
 *   status with a comment (`PATCH /issues/:id`).
 * - `inThread` hides the subject, which would repeat the page.
 * - Slots for the pages that list cards (board 14): `triage` adds items to the "…" menu in the top
 *   row (the Inbox's snooze and clear); `aside` draws the context column beside the card's body,
 *   stacked under it on a narrow card; `onOpenSubject` opens the subject link in place;
 *   `onSettled` runs once an answer, a decision or setting it aside lands.
 */

const KIND_ICON: Record<RequestKind, () => JSX.Element> = {
  question: () => <CircleHelp size={12} aria-hidden="true" />,
  proposal: () => <Sparkles size={12} aria-hidden="true" />,
  approval: () => <ShieldCheck size={12} aria-hidden="true" />,
  signoff: () => <BadgeCheck size={12} aria-hidden="true" />,
};

export type RequestCardProps = {
  request: Request;
  taskId: string;
  people: TaskPeople;
  inThread?: boolean;
  /** Menu items for the "…" menu in the top row, after the card's own. A function, so they're made inside the menu. */
  triage?: () => JSX.Element;
  /** The "…" button's name when it holds only `triage`. */
  triageLabel?: string;
  /** The context column (board 14): the task it's about, why it's here. */
  aside?: JSX.Element;
  /** Opens the subject in place, such as in the task modal, instead of following its link. */
  onOpenSubject?: () => void;
  /** After an answer, a decision or setting it aside succeeds. */
  onSettled?: () => void;
};

export function RequestCard(props: RequestCardProps) {
  const [opened, setOpened] = createSignal(false);
  return (
    <Switch>
      <Match when={props.request.state === "settled"}>
        <SettledCard {...props} />
      </Match>
      <Match when={props.request.state === "set_aside" && !opened()}>
        <div class="rq-aside" role="group" aria-label={`Set-aside ${KIND_LABEL[props.request.kind].toLowerCase()}`}>
          {KIND_ICON[props.request.kind]()}
          <span>Set aside:</span>
          <b>{props.request.title}</b>
          <Button size="compact" onClick={() => setOpened(true)}>
            Open
          </Button>
          <CardMenu label={props.triageLabel ?? "Request actions"} triage={props.triage} />
        </div>
      </Match>
      <Match when={true}>
        <OpenCard {...props} />
      </Match>
    </Switch>
  );
}

/**
 * Refreshes what an answer changes: the task and its sections, the lists, approvals, and the
 * attention feed with the nav's counts, so an answered request leaves the Inbox and its badge.
 */
function useRefresh(taskId: () => string, onSettled?: () => void) {
  const client = useQueryClient();
  const company = useCompany();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(taskId()) });
    void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    void client.invalidateQueries({ queryKey: ["approvals", company().id] });
    void client.invalidateQueries({ queryKey: queryKeys.inbox.attention(company().id) });
    void client.invalidateQueries({ queryKey: queryKeys.sidebarBadges(company().id) });
    onSettled?.();
  };
}

/** The "…" menu in the top row: the card's own items, then the page's `triage`. Hidden when empty. */
function CardMenu(props: { label: string; own?: () => JSX.Element; triage?: () => JSX.Element }) {
  return (
    <Show when={props.own || props.triage}>
      <Menu>
        <Menu.Trigger class="rq-menu" aria-label={props.label}>
          <Ellipsis size={15} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label={props.label} width={260}>
          {props.own?.()}
          <Show when={props.own && props.triage}>
            <Menu.Separator />
          </Show>
          {props.triage?.()}
        </Menu.Content>
      </Menu>
    </Show>
  );
}

/** The subject: a link to the task, opened in place when the page asks; plain text otherwise. */
function Subject(props: { subject: NonNullable<Request["subject"]>; onOpen?: () => void }) {
  const company = useCompany();
  const label = () => (
    <Show when={props.subject.title} fallback={props.subject.label}>
      <span class="mono">{props.subject.label}</span>{" "}
      <span class="rq-subj-title">{props.subject.title}</span>
    </Show>
  );
  return (
    <Show when={props.subject.kind === "task" && props.subject.issueId} fallback={<span class="rq-subj">{label()}</span>}>
      {(issueId) => (
        <a
          class="rq-subj rq-subj--link"
          href={`/${company().issuePrefix}/issues/${encodeURIComponent(props.subject.title ? props.subject.label : issueId())}`}
          onClick={(event) => {
            if (!props.onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            props.onOpen();
          }}
        >
          {label()}
        </a>
      )}
    </Show>
  );
}

/** The card's body, with the context column beside it when there is one. */
function Split(props: { aside?: JSX.Element; children: JSX.Element }) {
  return (
    <Show when={props.aside} fallback={props.children}>
      {(aside) => (
        <div class="rq-split">
          <div class="rq-main">{props.children}</div>
          <aside class="rq-ctx" aria-label="Context">
            {aside()}
          </aside>
        </div>
      )}
    </Show>
  );
}

function Asker(props: { request: Request; people: TaskPeople }) {
  const agent = () => props.people.agent(props.request.asker.agentId);
  return (
    <Switch fallback={<InitialsDisc name={props.request.asker.name} seed={props.request.asker.userId ?? props.request.asker.name} size={20} you={props.request.asker.name === "You"} />}>
      <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={24} />}</Match>
    </Switch>
  );
}

function Top(props: { request: Request; inThread?: boolean; menu?: JSX.Element; label?: JSX.Element; onOpenSubject?: () => void }) {
  return (
    <div class="rq-top">
      <span class="rq-kind">
        {KIND_ICON[props.request.kind]()}
        {props.label ?? KIND_LABEL[props.request.kind]}
      </span>
      <Show when={props.request.formal}>
        <span class="rq-tag">Formal</span>
      </Show>
      <Show when={props.request.acts}>
        <span class="rq-tag">
          <Zap size={11} aria-hidden="true" />
          Acts
        </span>
      </Show>
      <Show when={props.request.subject && (!props.inThread || props.request.subject.kind !== "task") && props.request.subject}>
        {(subject) => <Subject subject={subject()} onOpen={props.onOpenSubject} />}
      </Show>
      <Show when={props.request.state !== "settled"}>
        <span class="rq-life" classList={{ "rq-life--soon": props.request.lifetimeSoon }}>
          <Clock size={12} aria-hidden="true" />
          {props.request.lifetime}
        </span>
      </Show>
      {props.menu}
    </div>
  );
}

function SettledCard(props: RequestCardProps) {
  const issue = () => (props.request.result?.tone === "bad" ? "bad" : props.request.result?.tone === "mid" ? "mid" : undefined);
  return (
    <article class="rq rq--settled" data-kind={props.request.kind} data-issue={issue()} aria-label={`${KIND_LABEL[props.request.kind]}: ${props.request.title}`}>
      <Top
        request={props.request}
        inThread={props.inThread}
        onOpenSubject={props.onOpenSubject}
        menu={<CardMenu label={props.triageLabel ?? "Request actions"} triage={props.triage} />}
      />
      <Split aside={props.aside}>
        <SettledBody request={props.request} people={props.people} />
      </Split>
    </article>
  );
}

function SettledBody(props: { request: Request; people: TaskPeople }) {
  return (
    <>
      <div class="rq-settled-title">{props.request.title}</div>
      <Show when={props.request.verdict}>
        {(verdict) => (
          <div class="rq-res" data-tone={verdict().tone === "ok" ? "ok" : "plain"}>
            <Switch fallback={<CircleAlert size={14} aria-hidden="true" />}>
              <Match when={verdict().tone === "ok"}>
                <Check size={14} aria-hidden="true" />
              </Match>
              <Match when={verdict().tone === "bad"}>
                <X size={14} aria-hidden="true" />
              </Match>
            </Switch>
            <span>{verdict().text}</span>
            <Show when={verdict().at}>{(at) => <small>· {stampLabel(at())}</small>}</Show>
          </div>
        )}
      </Show>
      <Show when={props.request.result}>
        {(result) => (
          <div class="rq-res" data-tone={result().tone}>
            <CornerDownRight size={14} aria-hidden="true" />
            <span>{result().text}</span>
          </div>
        )}
      </Show>
      <Show when={props.request.source.type === "approval"}>
        <ApprovalDiscussion approvalId={(props.request.source as { type: "approval"; approval: { id: string } }).approval.id} people={props.people} />
      </Show>
    </>
  );
}

function OpenCard(props: RequestCardProps) {
  const refresh = useRefresh(
    () => props.taskId,
    () => props.onSettled?.(),
  );
  const interaction = () => (props.request.source.type === "interaction" ? props.request.source.interaction : null);
  const review = () => (props.request.source.type === "review" ? props.request.source : null);

  const aside = createMutation(() => ({
    mutationFn: (action: "dismiss" | "skip") =>
      action === "dismiss" ? interactionsApi.dismiss(props.taskId, interaction()!.id) : interactionsApi.skip(props.taskId, interaction()!.id),
    onSuccess: refresh,
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't update the request", body: error.message }),
  }));

  const ownItems = () => (
    <>
      <Show when={props.request.state === "open"}>
        <Menu.Item description="Keep it in the history to answer later" onSelect={() => aside.mutate("dismiss")}>
          Set aside
        </Menu.Item>
      </Show>
      <Menu.Item description="End it without an answer" onSelect={() => aside.mutate("skip")}>
        Skip
      </Menu.Item>
    </>
  );
  const hasOwn = () => !!interaction() && props.request.respond.allowed;
  const menuLabel = () => (hasOwn() ? (props.triage ? "Request actions" : "Set aside or skip") : (props.triageLabel ?? "Request actions"));

  return (
    <article class="rq" classList={{ "rq--compact": props.inThread }} data-kind={props.request.kind} aria-label={`${KIND_LABEL[props.request.kind]} from ${props.request.asker.name}`}>
      <Top
        request={props.request}
        inThread={props.inThread}
        onOpenSubject={props.onOpenSubject}
        menu={<CardMenu label={menuLabel()} own={hasOwn() ? ownItems : undefined} triage={props.triage} />}
      />
      <Split aside={props.aside}>
        <Show when={props.request.asker.name}>
          <div class="rq-ask">
            <Asker request={props.request} people={props.people} />
            <b>{props.request.asker.name}</b>
            <span>{props.request.askVerb}</span>
            <span>· {stampLabel(props.request.createdAt)}</span>
          </div>
        </Show>
        <h3 class="disp">{props.request.title}</h3>
        <Show when={props.request.body && props.request.shape !== "tool_call"}>
          <div class="rq-body">
            <Markdown source={props.request.body!} />
          </div>
        </Show>
        <Switch>
          <Match when={props.request.source.type === "approval"}>
            <ApprovalControls request={props.request} people={props.people} onDone={refresh} />
          </Match>
          <Match when={interaction()}>
            {(found) => <InteractionControls request={props.request} interaction={found()} taskId={props.taskId} people={props.people} onDone={refresh} />}
          </Match>
          <Match when={review()}>
            {(source) => <ReviewControls request={props.request} source={source()} onDone={refresh} onOpenTask={props.onOpenSubject} />}
          </Match>
        </Switch>
      </Split>
    </article>
  );
}

/** The "what happens next" line, the action row and who can answer. `extra` shows either way. */
function Footer(props: { request: Request; children?: JSX.Element; extra?: JSX.Element; error?: string | null }) {
  return (
    <>
      <div class="rq-next">
        <CornerDownRight size={14} aria-hidden="true" />
        <span>{props.request.next}</span>
      </div>
      <Show when={props.error}>
        <p class="rq-error" role="alert">
          {props.error}
        </p>
      </Show>
      <div class="rq-acts">
        <Show when={props.request.respond.allowed} fallback={<Show when={props.request.respond.reason}>{(reason) => <p class="rq-note">{reason()}</p>}</Show>}>
          {props.children}
        </Show>
        {props.extra}
        <span class="rq-who">
          <Users size={13} aria-hidden="true" />
          {props.request.audience.label}
        </span>
      </div>
    </>
  );
}

function InteractionControls(props: { request: Request; interaction: IssueThreadInteraction; taskId: string; people: TaskPeople; onDone: () => void }) {
  const [error, setError] = createSignal<string | null>(null);
  const act = createMutation(() => ({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      setError(null);
      props.onDone();
    },
    onError: (failure: Error) => setError(failure.message),
  }));
  const run = (call: () => Promise<unknown>) => act.mutate(call);
  const busy = () => act.isPending || !props.request.respond.allowed;
  const accept = (data?: AcceptInteraction) => run(() => interactionsApi.accept(props.taskId, props.interaction.id, data));
  const reject = (reason?: string) => run(() => interactionsApi.reject(props.taskId, props.interaction.id, reason));

  return (
    <Switch>
      <Match when={props.interaction.kind === "ask_user_questions"}>
        <QuestionForm
          request={props.request}
          interaction={props.interaction as AskUserQuestionsInteraction}
          busy={busy()}
          error={error()}
          onSubmit={(answers) => run(() => interactionsApi.respond(props.taskId, props.interaction.id, { answers }))}
        />
      </Match>
      <Match when={props.interaction.kind === "request_confirmation"}>
        <Confirmation request={props.request} interaction={props.interaction as RequestConfirmationInteraction} busy={busy()} error={error()} onAccept={accept} onReject={reject} />
      </Match>
      <Match when={props.interaction.kind === "request_checkbox_confirmation"}>
        <CheckboxConfirmation
          request={props.request}
          interaction={props.interaction as RequestCheckboxConfirmationInteraction}
          busy={busy()}
          error={error()}
          onAccept={(ids) => accept({ selectedOptionIds: ids })}
          onReject={reject}
        />
      </Match>
      <Match when={props.interaction.kind === "request_item_verdicts"}>
        <Verdicts
          request={props.request}
          interaction={props.interaction as RequestItemVerdictsInteraction}
          busy={busy()}
          error={error()}
          onSubmit={(verdicts) => run(() => interactionsApi.verdicts(props.taskId, props.interaction.id, verdicts))}
        />
      </Match>
      <Match when={props.interaction.kind === "suggest_tasks"}>
        <SuggestedTasks
          request={props.request}
          interaction={props.interaction as SuggestTasksInteraction}
          people={props.people}
          busy={busy()}
          error={error()}
          onAccept={(keys) => accept({ selectedClientKeys: keys })}
          onReject={() => reject()}
        />
      </Match>
      <Match when={true}>
        <Footer request={props.request} error={error()} />
      </Match>
    </Switch>
  );
}

/** A decline that may need a reason: the first press asks for one, the second sends it. */
function DeclineButton(props: { label: string; needsReason: boolean; allowReason: boolean; placeholder?: string | null; busy: boolean; onReject: (reason?: string) => void }) {
  const [asking, setAsking] = createSignal(false);
  const [reason, setReason] = createSignal("");
  return (
    <Show
      when={asking()}
      fallback={
        <Button size="compact" disabled={props.busy} onClick={() => (props.needsReason || props.allowReason ? setAsking(true) : props.onReject())}>
          {props.label}
        </Button>
      }
    >
      <TextInput
        aria-label="Reason"
        placeholder={props.placeholder ?? (props.needsReason ? "Why? (required)" : "Why? (optional)")}
        value={reason()}
        onInput={(event) => setReason(event.currentTarget.value)}
        ref={(element) => queueMicrotask(() => element.focus())}
      />
      <Button size="compact" variant="danger" disabled={props.busy || (props.needsReason && !reason().trim())} onClick={() => props.onReject(reason().trim() || undefined)}>
        {props.label}
      </Button>
      <Button size="compact" variant="quiet" onClick={() => setAsking(false)}>
        Back
      </Button>
    </Show>
  );
}

function QuestionForm(props: {
  request: Request;
  interaction: AskUserQuestionsInteraction;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: AskUserQuestionsAnswer[]) => void;
}) {
  const [picked, setPicked] = createSignal<Record<string, string[]>>({});
  const [other, setOther] = createSignal<Record<string, string>>({});
  const questions = () => props.interaction.payload.questions;
  const toggle = (questionId: string, optionId: string, multi: boolean) =>
    setPicked((current) => {
      const now = current[questionId] ?? [];
      const next = multi ? (now.includes(optionId) ? now.filter((id) => id !== optionId) : [...now, optionId]) : [optionId];
      return { ...current, [questionId]: next };
    });
  const answers = (): AskUserQuestionsAnswer[] =>
    questions().map((question) => ({ questionId: question.id, optionIds: picked()[question.id] ?? [], otherText: other()[question.id]?.trim() || null }));
  const missing = () => questions().some((question) => question.required && !(picked()[question.id]?.length || other()[question.id]?.trim()));

  return (
    <>
      <For each={questions()}>
        {(question) => {
          const multi = question.selectionMode === "multi";
          const freeText = () => question.options.find((option) => option.freeText && picked()[question.id]?.includes(option.id));
          const showOther = () => question.allowOther !== false || !!freeText();
          return (
            <>
              <Show when={questions().length > 1 || props.interaction.payload.title}>
                <div class="rq-q">
                  {question.prompt}
                  <small>{multi ? "Pick any" : "Pick one"}</small>
                </div>
              </Show>
              <Show when={question.helpText}>
                <p class="rq-help">{question.helpText}</p>
              </Show>
              <Show
                when={multi}
                fallback={
                  <div class="rq-opts" role="radiogroup" aria-label={question.prompt}>
                    <For each={question.options}>
                      {(option) => (
                        <button
                          type="button"
                          class="rq-opt"
                          role="radio"
                          aria-checked={picked()[question.id]?.includes(option.id) ?? false}
                          disabled={props.busy}
                          onClick={() => toggle(question.id, option.id, false)}
                        >
                          <span class="rq-radio" aria-hidden="true" />
                          <span class="rq-opt-main">
                            {option.label}
                            <Show when={option.description}>
                              <small>{option.description}</small>
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                }
              >
                <div class="rq-chips" role="group" aria-label={question.prompt}>
                  <For each={question.options}>
                    {(option) => (
                      <button
                        type="button"
                        class="rq-chip"
                        aria-pressed={picked()[question.id]?.includes(option.id) ?? false}
                        title={option.description ?? undefined}
                        disabled={props.busy}
                        onClick={() => toggle(question.id, option.id, true)}
                      >
                        <Show when={picked()[question.id]?.includes(option.id)}>
                          <Check size={13} aria-hidden="true" />
                        </Show>
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={showOther()}>
                <TextInput
                  aria-label={`Other answer: ${question.prompt}`}
                  placeholder={freeText() ? `${freeText()!.label}…` : "Anything else? (optional)"}
                  value={other()[question.id] ?? ""}
                  disabled={props.busy}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setOther((current) => ({ ...current, [question.id]: value }));
                  }}
                />
              </Show>
            </>
          );
        }}
      </For>
      <Footer request={props.request} error={props.error}>
        <Button size="compact" variant="primary" disabled={props.busy || missing()} onClick={() => props.onSubmit(answers())}>
          {props.interaction.payload.submitLabel?.trim() || (questions().length > 1 ? "Send answers" : "Send answer")}
        </Button>
      </Footer>
    </>
  );
}

function Confirmation(props: {
  request: Request;
  interaction: RequestConfirmationInteraction;
  busy: boolean;
  error: string | null;
  onAccept: (data?: AcceptInteraction) => void;
  onReject: (reason?: string) => void;
}) {
  const payload = () => props.interaction.payload;
  const tool = () => payload().toolAction;
  const args = createMemo(() => {
    const raw = tool()?.argumentsSummaryJson;
    if (!raw) return "";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  });
  return (
    <>
      <Show when={tool()}>
        {(action) => (
          <>
            <pre class="rq-code">
              <span>tool </span> {action().toolDisplayName || action().toolName}
              {"\n"}
              <Show when={action().appDisplayName}>
                <span>app </span> {action().appDisplayName}
                {"\n"}
              </Show>
              <span>risk </span> {action().risk}
              <Show when={args()}>
                {"\n"}
                {args()}
              </Show>
            </pre>
            <Show when={action().previewMarkdown}>
              <div class="rq-body">
                <Markdown source={action().previewMarkdown} />
              </div>
            </Show>
          </>
        )}
      </Show>
      <Footer request={props.request} error={props.error}>
        <Button size="compact" variant="primary" disabled={props.busy} onClick={() => props.onAccept()}>
          {tool() ? "Approve and run" : payload().acceptLabel?.trim() || "Accept"}
        </Button>
        <Show when={tool()?.rememberActionScope}>
          <Button size="compact" disabled={props.busy} onClick={() => props.onAccept({ rememberAction: true })}>
            Always allow
          </Button>
        </Show>
        <DeclineButton
          label={tool() ? "Decline" : payload().rejectLabel?.trim() || "Reject"}
          needsReason={payload().rejectRequiresReason === true}
          allowReason={payload().allowDeclineReason === true}
          placeholder={payload().declineReasonPlaceholder ?? payload().rejectReasonLabel}
          busy={props.busy}
          onReject={props.onReject}
        />
      </Footer>
    </>
  );
}

function CheckboxConfirmation(props: {
  request: Request;
  interaction: RequestCheckboxConfirmationInteraction;
  busy: boolean;
  error: string | null;
  onAccept: (ids: string[]) => void;
  onReject: (reason?: string) => void;
}) {
  const payload = () => props.interaction.payload;
  const [picked, setPicked] = createSignal<string[]>(payload().defaultSelectedOptionIds ?? []);
  const min = () => payload().minSelected ?? 0;
  const max = () => payload().maxSelected ?? Infinity;
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length < max() ? [...current, id] : current));
  return (
    <>
      <div class="rq-opts" role="group" aria-label={payload().prompt}>
        <For each={payload().options}>
          {(option) => (
            <button type="button" class="rq-opt" role="checkbox" aria-checked={picked().includes(option.id)} disabled={props.busy} onClick={() => toggle(option.id)}>
              <span class="rq-check" aria-hidden="true">
                <Show when={picked().includes(option.id)}>
                  <Check size={10} />
                </Show>
              </span>
              <span class="rq-opt-main">
                {option.label}
                <Show when={option.description}>
                  <small>{option.description}</small>
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <Footer request={props.request} error={props.error}>
        <Button size="compact" variant="primary" disabled={props.busy || picked().length < min()} onClick={() => props.onAccept(picked())}>
          {payload().acceptLabel?.trim() || "Confirm"}
        </Button>
        <DeclineButton
          label={payload().rejectLabel?.trim() || "Reject"}
          needsReason={payload().rejectRequiresReason === true}
          allowReason={payload().allowDeclineReason === true}
          placeholder={payload().declineReasonPlaceholder ?? payload().rejectReasonLabel}
          busy={props.busy}
          onReject={props.onReject}
        />
      </Footer>
    </>
  );
}

const VERDICT_LABEL: Record<RequestItemVerdictValue, string> = { approve: "Approve", reject: "Reject", defer: "Defer" };

function Verdicts(props: { request: Request; interaction: RequestItemVerdictsInteraction; busy: boolean; error: string | null; onSubmit: (verdicts: ItemVerdict[]) => void }) {
  const payload = () => props.interaction.payload;
  const done = () => new Map((props.interaction.result?.items ?? []).map((item) => [item.id, item.verdict] as const));
  const choices = () => payload().verdicts ?? (["approve", "reject", "defer"] as RequestItemVerdictValue[]);
  const [picked, setPicked] = createSignal<Record<string, RequestItemVerdictValue>>({});
  const [reasons, setReasons] = createSignal<Record<string, string>>({});
  const needsReason = (verdict: RequestItemVerdictValue | undefined) => !!verdict && (payload().requireReasonOn ?? []).includes(verdict);
  const chosen = () => Object.entries(picked());
  const missing = () => chosen().some(([id, verdict]) => needsReason(verdict) && !reasons()[id]?.trim());
  const open = () => payload().items.filter((item) => !done().has(item.id));
  return (
    <>
      <ul class="rq-items">
        <For each={payload().items}>
          {(item) => (
            <li class="rq-item">
              <div class="rq-item-head">
                <span>
                  {item.label}
                  <Show when={item.description}>
                    <small>{item.description}</small>
                  </Show>
                </span>
                <Show
                  when={!done().has(item.id)}
                  fallback={
                    <span class="rq-tag">
                      <Check size={11} aria-hidden="true" />
                      {VERDICT_LABEL[done().get(item.id)!]}
                    </span>
                  }
                >
                  <div class="rq-chips" role="radiogroup" aria-label={`Verdict on ${item.label}`}>
                    <For each={choices()}>
                      {(verdict) => (
                        <button
                          type="button"
                          class="rq-chip"
                          role="radio"
                          aria-checked={picked()[item.id] === verdict}
                          aria-pressed={picked()[item.id] === verdict}
                          disabled={props.busy}
                          onClick={() => setPicked((current) => ({ ...current, [item.id]: verdict }))}
                        >
                          {VERDICT_LABEL[verdict]}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={item.previewMarkdown}>
                <div class="rq-body">
                  <Markdown source={item.previewMarkdown!} />
                </div>
              </Show>
              <Show when={needsReason(picked()[item.id])}>
                <TextInput
                  aria-label={`Reason for ${item.label}`}
                  placeholder={payload().reasonLabel ?? "Why?"}
                  value={reasons()[item.id] ?? ""}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setReasons((current) => ({ ...current, [item.id]: value }));
                  }}
                />
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Footer request={props.request} error={props.error}>
        <Button
          size="compact"
          variant="primary"
          disabled={props.busy || chosen().length === 0 || missing()}
          onClick={() => props.onSubmit(chosen().map(([id, verdict]) => ({ id, verdict, reason: reasons()[id]?.trim() || null })))}
        >
          Send {chosen().length || ""} verdict{chosen().length === 1 ? "" : "s"}
        </Button>
        <Show when={payload().allowBulkApprove && open().length > 1}>
          <Button size="compact" disabled={props.busy} onClick={() => setPicked(Object.fromEntries(open().map((item) => [item.id, "approve" as const])))}>
            Approve all
          </Button>
        </Show>
      </Footer>
    </>
  );
}

function SuggestedTasks(props: {
  request: Request;
  interaction: SuggestTasksInteraction;
  people: TaskPeople;
  busy: boolean;
  error: string | null;
  onAccept: (keys: string[]) => void;
  onReject: () => void;
}) {
  const tasks = () => props.interaction.payload.tasks.filter((task) => !task.hiddenInPreview);
  const [picked, setPicked] = createSignal<string[]>(tasks().map((task) => task.clientKey));
  const toggle = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  const owner = (task: { assigneeAgentId?: string | null; assigneeUserId?: string | null }) =>
    task.assigneeAgentId
      ? (props.people.agent(task.assigneeAgentId)?.name ?? "An agent")
      : task.assigneeUserId
        ? task.assigneeUserId === props.people.youId()
          ? "You"
          : props.people.personName(task.assigneeUserId)
        : "Unassigned";
  return (
    <>
      <div class="rq-opts" role="group" aria-label="Suggested tasks">
        <For each={tasks()}>
          {(task) => (
            <button
              type="button"
              class="rq-opt"
              role="checkbox"
              aria-checked={picked().includes(task.clientKey)}
              disabled={props.busy}
              style={{ "margin-left": task.parentClientKey ? "22px" : undefined, width: task.parentClientKey ? "calc(100% - 22px)" : undefined }}
              onClick={() => toggle(task.clientKey)}
            >
              <span class="rq-check" aria-hidden="true">
                <Show when={picked().includes(task.clientKey)}>
                  <Check size={10} />
                </Show>
              </span>
              <span class="rq-opt-main">
                {task.title}
                <small>
                  {owner(task)}
                  <Show when={task.priority}> · {task.priority} priority</Show>
                </small>
              </span>
            </button>
          )}
        </For>
      </div>
      <Footer request={props.request} error={props.error}>
        <Button size="compact" variant="primary" disabled={props.busy || picked().length === 0} onClick={() => props.onAccept(picked())}>
          Create {picked().length} task{picked().length === 1 ? "" : "s"}
        </Button>
        <Button size="compact" disabled={props.busy} onClick={() => props.onReject()}>
          Decline
        </Button>
      </Footer>
    </>
  );
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cents(value: unknown) {
  return typeof value === "number" ? `$${(value / 100).toFixed(2)}` : null;
}

/** An approval's payload, after the old UI's ApprovalPayload renderers. */
function ApprovalPayload(props: { request: Request }) {
  const approval = () => (props.request.source as Extract<Request["source"], { type: "approval" }>).approval;
  const payload = () => approval().payload ?? {};
  const rows = createMemo((): [string, string][] => {
    const p = payload();
    const pairs: [string, string | null][] =
      approval().type === "hire_agent"
        ? [
            ["Role", text(p.role)],
            ["Title", text(p.title)],
            ["Runs on", text(p.adapterType)],
            ["Does", text(p.capabilities)],
            ["Skills", Array.isArray(p.desiredSkills) ? p.desiredSkills.filter((skill) => typeof skill === "string").join(", ") || null : null],
          ]
        : approval().type === "budget_override_required"
          ? [
              ["Scope", text(p.scopeName) ?? text(p.scopeType)],
              ["Window", text(p.windowKind)],
              ["Limit", cents(p.budgetAmount)],
              ["Spent", cents(p.observedAmount)],
            ]
          : [
              ["Recommended", text(p.recommendedAction)],
              ["After approval", text(p.nextActionOnApproval)],
            ];
    return pairs.filter((pair): pair is [string, string] => pair[1] !== null);
  });
  const risks = () => (Array.isArray(payload().risks) ? (payload().risks as unknown[]).filter((risk): risk is string => typeof risk === "string" && !!risk.trim()) : []);
  return (
    <>
      <Show when={rows().length > 0}>
        <dl class="rq-kv">
          <For each={rows()}>
            {([label, value]) => (
              <>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </>
            )}
          </For>
        </dl>
      </Show>
      <Show when={risks().length > 0}>
        <ul class="rq-risks" aria-label="Risks">
          <For each={risks()}>{(risk) => <li>{risk.replace(/^(?:[-*•]|\d+[.)])\s+/, "")}</li>}</For>
        </ul>
      </Show>
      <Show when={text(payload().proposedComment)}>
        {(comment) => <pre class="rq-code">{comment()}</pre>}
      </Show>
    </>
  );
}

function ApprovalControls(props: { request: Request; people: TaskPeople; onDone: () => void }) {
  const approval = () => (props.request.source as Extract<Request["source"], { type: "approval" }>).approval;
  const [note, setNote] = createSignal("");
  const [noting, setNoting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const decide = createMutation(() => ({
    mutationFn: (action: "approve" | "reject" | "revise") => {
      const decisionNote = note().trim() || undefined;
      if (action === "approve") return approvalsApi.approve(approval().id, decisionNote);
      if (action === "reject") return approvalsApi.reject(approval().id, decisionNote);
      return approvalsApi.requestRevision(approval().id, decisionNote);
    },
    onSuccess: () => {
      setError(null);
      props.onDone();
    },
    onError: (failure: Error) => setError(failure.message),
  }));
  const busy = () => decide.isPending;
  return (
    <>
      <ApprovalPayload request={props.request} />
      <Show when={noting()}>
        <TextArea aria-label="Decision note" rows={2} placeholder="A note with your decision (optional)" value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
      </Show>
      <Footer request={props.request} error={error()}>
        <Button size="compact" variant="primary" disabled={busy()} onClick={() => decide.mutate("approve")}>
          Approve
        </Button>
        <Button size="compact" disabled={busy()} onClick={() => decide.mutate("revise")}>
          Request changes
        </Button>
        <Button size="compact" variant="danger" disabled={busy()} onClick={() => decide.mutate("reject")}>
          Reject
        </Button>
        <Show when={!noting()}>
          <Button size="compact" variant="quiet" onClick={() => setNoting(true)}>
            Add a note
          </Button>
        </Show>
      </Footer>
      <ApprovalDiscussion approvalId={approval().id} people={props.people} />
    </>
  );
}

/**
 * A sign-off's controls: the stages with the current one marked and where the task returns, then,
 * on your turn, a note and Approve or Send back. The server asks for the note with either: approving
 * moves the task to done, sending back to in progress, and the stage policy routes it from there.
 */
function ReviewControls(props: { request: Request; source: Extract<Request["source"], { type: "review" }>; onDone: () => void; onOpenTask?: () => void }) {
  const company = useCompany();
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const decide = createMutation(() => ({
    mutationFn: (verdict: "approve" | "send_back") =>
      issuesApi.update(props.source.issueId, { status: verdict === "approve" ? "done" : "in_progress", comment: note().trim() }),
    onSuccess: () => {
      setError(null);
      setNote("");
      props.onDone();
    },
    onError: (failure: Error) => setError(failure.message),
  }));
  const busy = () => decide.isPending || !note().trim();
  const openLabel = () => (props.source.stalled ? "Choose a review path" : "Open the task");
  const openVariant = () => (props.request.respond.allowed ? "quiet" : "primary");
  const openTask = () => (
    <Show
      when={props.onOpenTask}
      fallback={
        <a class={buttonClass({ variant: openVariant(), size: "compact" })} href={`/${company().issuePrefix}/issues/${encodeURIComponent(props.source.identifier)}`}>
          {openLabel()}
        </a>
      }
    >
      {(open) => (
        <Button size="compact" variant={openVariant()} onClick={() => open()()}>
          {openLabel()}
        </Button>
      )}
    </Show>
  );
  return (
    <>
      <Show when={props.source.signoff.steps.length > 0 || props.source.signoff.returns}>
        <div class="rq-stage">
          <For each={props.source.signoff.steps}>
            {(step) => (
              <span class="rq-step" classList={{ "rq-step--now": step.now }}>
                <Show when={step.now}>
                  <BadgeCheck size={12} aria-hidden="true" />
                </Show>
                {step.label}
              </span>
            )}
          </For>
          <Show when={props.source.signoff.returns}>{(returns) => <span>{returns()}</span>}</Show>
        </div>
      </Show>
      <Show when={props.request.respond.allowed}>
        <TextArea aria-label="Sign-off note" rows={2} placeholder="What you checked, or what to change (required)" value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
      </Show>
      <Footer request={props.request} error={error()} extra={openTask()}>
        <Button size="compact" variant="primary" disabled={busy()} onClick={() => decide.mutate("approve")}>
          Approve
        </Button>
        <Button size="compact" disabled={busy()} onClick={() => decide.mutate("send_back")}>
          Send back with notes
        </Button>
      </Footer>
    </>
  );
}

/** An approval's own thread: shown on request, with a box to add to it. */
function ApprovalDiscussion(props: { approvalId: string; people: TaskPeople }) {
  const client = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [body, setBody] = createSignal("");
  const key = () => ["approvals", "comments", props.approvalId] as const;
  const comments = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => approvalsApi.comments(props.approvalId, signal),
    enabled: open(),
  }));
  const post = createMutation(() => ({
    mutationFn: () => approvalsApi.addComment(props.approvalId, body().trim()),
    onSuccess: () => {
      setBody("");
      void client.invalidateQueries({ queryKey: key() });
    },
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't post to the discussion", body: error.message }),
  }));
  const author = (comment: { authorAgentId: string | null; authorUserId: string | null }) =>
    comment.authorAgentId
      ? (props.people.agent(comment.authorAgentId)?.name ?? "An agent")
      : comment.authorUserId === props.people.youId()
        ? "You"
        : comment.authorUserId
          ? props.people.personName(comment.authorUserId)
          : "Someone";
  return (
    <Show
      when={open()}
      fallback={
        <div>
          <Button size="compact" variant="quiet" icon={<MessageSquare size={14} aria-hidden="true" />} onClick={() => setOpen(true)}>
            Discussion
          </Button>
        </div>
      }
    >
      <section class="rq-thread" aria-label="Discussion">
        <Show when={!comments.isPending} fallback={<p class="rq-note">Loading the discussion…</p>}>
          <For each={comments.data ?? []} fallback={<p class="rq-note">No discussion yet.</p>}>
            {(comment) => (
              <div class="rq-thread-item">
                <b>
                  {author(comment)} <small>· {stampLabel(comment.createdAt)}</small>
                </b>
                <Markdown source={comment.body} />
              </div>
            )}
          </For>
        </Show>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (body().trim()) post.mutate();
          }}
        >
          <TextArea aria-label="Add to the discussion" rows={1} placeholder="Add to the discussion" value={body()} onInput={(event) => setBody(event.currentTarget.value)} />
          <Button type="submit" size="compact" disabled={!body().trim() || post.isPending}>
            Post
          </Button>
          <Button size="compact" variant="quiet" onClick={() => setOpen(false)}>
            Hide
          </Button>
        </form>
      </section>
    </Show>
  );
}
