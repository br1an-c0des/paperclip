import type { Issue, IssueBlockerStalledWakeContext } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, EyeOff, Hourglass, LifeBuoy, Lock, PauseCircle, PlugZap, RotateCcw, ShieldCheck, ShieldX, TriangleAlert, Wrench } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import {
  BUDGET_WAIT_LINE,
  pauseDetail,
  rejectedModelText,
  resumeCountdown,
  retryCountdown,
  retryWaitTitle,
  scheduledLine,
  SETUP_STEP_TEXT,
  setupFailureText,
  stalledDependencyRows,
  stalledDependencyTitle,
  taskNotices,
  timeOfDay,
  waitingText,
  type RetryBlocker,
  type SetupFailure,
  type StalledDependencyRow,
  type TaskNotice,
} from "./recovery";
import { useTaskRetry, type TaskRetry } from "./retry";
import { TreeControlDialog, useTreeControlState } from "./TaskActions";
import { ProviderFailureNotice } from "@/ui/ProviderFailureNotice";
import { ConfirmServerStopped, TaskRecovery } from "./TaskRecovery";
import "./TaskNotices.css";
import { TaskIntegrations } from "./integrations/TaskIntegrations";

/*
 * Health notices at the top of an open task (`tasks/recovery`), in every section of the panel, the
 * modal and the full page. recovery.ts decides which show; this draws them with their one fix each:
 * Retry (the same request as the list rows' Retry, retry.tsx), Resume for a paused task or subtree
 * (releasing its pause, with the agents woken), Resume agent for a paused assignee (and a fresh
 * wake, since the pause dropped the assignment's), and the project access notice from the
 * 2026-10-24 upstream sync, which links to the agent's project access and retries once it's added.
 * A provider's refusal shows as its own notice (ui/ProviderFailureNotice.tsx), with Retry.
 *
 * Since the 2026-11-09 sync: a saved Retry held by unfinished blockers lists them, each with what to
 * do (#20109), and the children and blockers stopped on a recovery action that needs the board get
 * "A dependency needs the board", each with its own Retry (#20098, `StalledDependencies`).
 *
 * Since the 2026-11-10 sync: a Retry parked on a run that never recorded its process carries the
 * stop confirmation (#20310); a failed setup command is named, with its command and output behind
 * a disclosure and a link to the project's workspace settings (#20478); a rejected model is named
 * (#20488); a budget hold links to Costs (#20338); and an agent parked while its setup is checked
 * points to the task's connection card instead of Resume agent (#20361).
 */

export function TaskNotices(props: { taskId: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const projects = useProjectsQuery();
  const retry = useTaskRetry();
  const tree = useTreeControlState(() => props.taskId);
  const [resumeOpen, setResumeOpen] = createSignal(false);
  const [resumingAgent, setResumingAgent] = createSignal(false);
  // Whether the recovery card offers its own way on, which Retry then gives way to (#19840).
  const [recoveryOwnsRetry, setRecoveryOwnsRetry] = createSignal(true);

  const query = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const subtasks = createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, { parentId: props.taskId }),
    queryFn: ({ signal }) => issuesApi.list(company().id, { parentId: props.taskId }, signal),
  }));
  const task = () => query.data;
  const assignee = () => people.agent(task()?.assigneeAgentId);
  const project = () => task()?.project ?? projects.data?.find((candidate) => candidate.id === task()?.projectId) ?? null;
  const hasSubtasks = () => (subtasks.data?.length ?? 0) > 0;
  const notices = createMemo(() => {
    const current = task();
    if (!current) return [];
    return taskNotices({
      task: current,
      assignee: assignee(),
      project: project(),
      tree: tree.data,
      hasSubtasks: hasSubtasks(),
      recoveryOwnsRetry: !!current.activeRecoveryAction && recoveryOwnsRetry(),
    });
  });

  const resumeAgent = async (agentId: string) => {
    const current = task();
    if (!current) return;
    setResumingAgent(true);
    try {
      await taskActionsApi.resumeAgent(agentId, company().id);
      // The pause dropped this task's assignment wake; send it again so the task doesn't sit idle.
      if (current.status === "todo" || current.status === "in_progress") {
        await taskActionsApi
          .wakeAgent(agentId, company().id, {
            source: "assignment",
            reason: "Assignee resumed from the task panel",
            payload: { issueId: current.id, mutation: "assignee_resumed" },
          })
          .catch(() => undefined);
      }
      pushToast({ tone: "success", title: `${assignee()?.name ?? "The agent"} is running again` });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't resume the agent", body: (error as Error).message });
    } finally {
      setResumingAgent(false);
      void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
    }
  };

  return (
    <>
    <Show when={notices().length > 0 && task()}>
      {(current) => (
        <div class="tn" role="region" aria-label="Task health">
          <For each={notices()}>
            {(notice) => (
              <Notice
                notice={notice}
                task={current()}
                projectName={project()?.name ?? null}
                projectKey={project()?.urlKey ?? null}
                assigneeName={assignee()?.name ?? null}
                retrying={retry.busy(props.taskId)}
                onRetry={() => void retry.retry(current())}
                resumingAgent={resumingAgent()}
                onResumeAgent={(agentId) => void resumeAgent(agentId)}
                onResumeTree={() => setResumeOpen(true)}
              />
            )}
          </For>
          <TreeControlDialog
            task={current()}
            mode={resumeOpen() ? "resume" : null}
            scope={hasSubtasks() ? "subtree" : "leaf"}
            holdId={tree.data?.activePauseHold?.holdId ?? null}
            wakeByDefault={(!!current().assigneeAgentId && current().status !== "done" && current().status !== "cancelled") || hasSubtasks()}
            onClose={() => setResumeOpen(false)}
          />
        </div>
      )}
    </Show>
    <Show when={task()?.stalledDependencies?.length ? task()!.stalledDependencies : undefined}>
      {(stalled) => <StalledDependencies entries={stalled()} retry={retry} />}
    </Show>
    <Show when={task()?.activeRecoveryAction && task()}>
      {(current) => (
        <div class="tn">
          <TaskRecovery task={current()} onOwnsRetry={setRecoveryOwnsRetry} />
        </div>
      )}
    </Show>
    <TaskIntegrations taskId={props.taskId} />
    </>
  );
}

function Notice(props: {
  notice: TaskNotice;
  task: Issue;
  projectName: string | null;
  /** The project's URL key, for the link to its workspace settings. */
  projectKey: string | null;
  assigneeName: string | null;
  retrying: boolean;
  onRetry: () => void;
  resumingAgent: boolean;
  onResumeAgent: (agentId: string) => void;
  onResumeTree: () => void;
}) {
  const company = useCompany();
  // A second-by-second clock while the retry countdown is on screen.
  const now = useNow(() => (props.notice.kind === "interrupted" || props.notice.kind === "provider-failure") && props.notice.state === "retry_scheduled");
  const costsLink = () => (
    <A class="btn btn--secondary btn--compact" href={`/${company().issuePrefix}/activity/costs`}>
      Open Costs
      <ArrowRight size={14} aria-hidden="true" />
    </A>
  );
  const retryButton = (label = "Retry") => (
    <Button size="compact" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={props.retrying} onClick={() => props.onRetry()}>
      {props.retrying ? "Retrying…" : label}
    </Button>
  );
  return (
    <Switch>
      <Match when={props.notice.kind === "hidden"}>
        <Row tone="red" icon={<EyeOff size={16} />} title="This task is hidden">
          It doesn't show in task lists. Show it again from More task actions.
        </Row>
      </Match>
      <Match when={props.notice.kind === "interrupted" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "interrupted" }>;
          const scheduled = found.state === "retry_scheduled";
          const title = () => {
            if (scheduled && found.resuming) return `${resumeCountdown(found.nextRetryAt, now())}…`;
            if (scheduled) return found.recoveryStep ? "Recovering saved work" : `${retryCountdown(found.nextRetryAt, now())}…`;
            if (found.retryWait) return "Retry is waiting";
            return !found.workspaceFailure && found.setupFailure ? "Workspace setup failed" : "Interrupted";
          };
          // The setup command's failure, unless a saved-work step, a resume, a Retry wait or the
          // folders' own failure says more (the old UI's order).
          const setup = () => (found.recoveryStep || found.resuming || found.retryWait || found.workspaceFailure ? null : found.setupFailure);
          return (
            <Row
              tone={found.resuming ? "neutral" : scheduled || found.retryWait ? "amber" : "red"}
              icon={found.recoveryStep ? <LifeBuoy size={16} /> : found.resuming ? <RotateCcw size={16} /> : <TriangleAlert size={16} />}
              title={title()}
              action={found.canRetry ? retryButton(scheduled ? "Retry now" : "Retry") : undefined}
              extra={<Show when={setup()}>{(failure) => <SetupFailureDetails failure={failure()} projectKey={props.projectKey} />}</Show>}
            >
              {scheduled && found.resuming
                ? `The last attempt stopped, and Paperclip resumes it by itself at ${timeOfDay(found.nextRetryAt!)}. Anything you sent is saved.`
                : scheduled
                ? found.recoveryStep
                  ? `${found.recoveryStep}. ${retryCountdown(found.nextRetryAt, now())}…`
                  : setup()
                    ? setupFailureText(setup()!, retryCountdown(found.nextRetryAt, now()))
                    : "The last attempt didn't finish, so the agent will try again by itself."
                : found.retryWait
                  ? found.retryWait
                  : found.workspaceFailure
                    ? `Couldn't prepare the task folders. ${found.workspaceFailure}`
                    : setup()
                      ? setupFailureText(setup()!)
                      : "The agent couldn't finish its last attempt. Anything you sent is saved."}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "recovering" && props.notice}>
        {(notice) => (
          <Row tone="neutral" icon={<LifeBuoy size={16} />} title="Recovering saved work">
            {(notice() as Extract<TaskNotice, { kind: "recovering" }>).step}…
          </Row>
        )}
      </Match>
      <Match when={props.notice.kind === "retry-waiting" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "retry-waiting" }>;
          return (
            <Row
              tone="amber"
              icon={<Hourglass size={16} />}
              title={retryWaitTitle(found)}
              extra={
                <Show when={found.blockers.length > 0}>
                  <ul class="tn-deps" data-testid="retry-waiting-on">
                    <For each={found.blockers}>{(blocker) => <WaitingBlocker blocker={blocker} />}</For>
                  </ul>
                </Show>
              }
            >
              {found.message}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "provider-failure" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "provider-failure" }>;
          return (
            <ProviderFailureNotice
              failure={found.failure}
              tone={found.state === "retry_scheduled" ? "amber" : "red"}
              action={
                found.canRetry ? retryButton(found.state === "retry_scheduled" ? "Retry now" : "Retry") : found.budgetWait ? costsLink() : undefined
              }
            >
              {found.state === "retry_scheduled"
                ? scheduledLine(found, now())
                : found.budgetWait
                  ? BUDGET_WAIT_LINE
                  : found.rejectedModel
                    ? rejectedModelText(found.rejectedModel)
                    : undefined}
            </ProviderFailureNotice>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "project-access" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "project-access" }>;
          return <ProjectAccessNotice notice={found} task={props.task} projectName={props.projectName} assigneeName={props.assigneeName} retry={retryButton("Retry task")} />;
        }}
      </Match>
      <Match when={props.notice.kind === "waiting" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "waiting" }>;
          const budget = found.action === "budget";
          return (
            <Row
              tone={budget && found.attempted ? "red" : "amber"}
              icon={<PauseCircle size={16} />}
              title={budget ? "Waiting for the budget" : found.action === "choose_model" && found.rejectedModel ? "Model rejected" : "Waiting on someone"}
              action={budget ? costsLink() : undefined}
            >
              {waitingText(found)}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "confirm-run-stopped" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "confirm-run-stopped" }>;
          return (
            <Row
              tone="amber"
              icon={<Hourglass size={16} />}
              title="Retry is waiting for a stop check"
              label="Confirm the previous run stopped"
              extra={
                // A new task or run starts a fresh form (the old UI keys it by task and run).
                <Show keyed when={`${props.task.id}:${found.runId}`}>
                  <ConfirmServerStopped stop={{ kind: "run", runId: found.runId }} actionId={null} task={props.task} />
                </Show>
              }
            >
              {found.message}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "tree-paused" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "tree-paused" }>;
          const root = () => (found.isRoot ? null : props.task.ancestors?.find((ancestor) => ancestor.id === found.rootIssueId));
          return (
            <Row
              tone="neutral"
              icon={<PauseCircle size={16} />}
              title={found.isRoot ? (found.scope === "subtree" ? "This task and its subtasks are paused" : "This task is paused") : "Paused with its parent"}
              action={
                found.isRoot ? (
                  <Button size="compact" onClick={() => props.onResumeTree()}>
                    {found.scope === "subtree" ? "Resume subtree" : "Resume work"}
                  </Button>
                ) : (
                  <A class="btn btn--secondary btn--compact" href={`/${company().issuePrefix}/issues/${root()?.identifier ?? found.rootIssueId}`}>
                    Open {root()?.identifier ?? "the paused task"}
                  </A>
                )
              }
            >
              {found.isRoot ? "No new runs start until it's resumed." : "A task above this one was paused, and its pause covers this task. Resume it there."}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "agent-paused" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "agent-paused" }>;
          return (
            <Row
              tone="amber"
              icon={<PauseCircle size={16} />}
              title={`${found.agentName} is paused`}
              action={
                found.canResume ? (
                  <Button size="compact" disabled={props.resumingAgent} onClick={() => props.onResumeAgent(found.agentId)}>
                    {props.resumingAgent ? "Resuming…" : "Resume agent"}
                  </Button>
                ) : undefined
              }
            >
              New runs won't start until the agent is resumed.{pauseDetail(found.reason) ? ` ${pauseDetail(found.reason)}` : ""}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "agent-setup" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "agent-setup" }>;
          return (
            <Row
              tone="neutral"
              icon={<Wrench size={16} />}
              title={`${found.agentName} is still being set up`}
              action={
                found.preparing ? undefined : (
                  <A class="btn btn--secondary btn--compact" href={`/${company().issuePrefix}/agents/new?setupAgentId=${encodeURIComponent(found.agentId)}`}>
                    Finish setup
                    <ArrowRight size={14} aria-hidden="true" />
                  </A>
                )
              }
            >
              {found.preparing
                ? "Its computer is being prepared. Runs start by themselves when setup finishes."
                : "Its setup isn't finished yet. Finish setup to let it start runs."}
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "agent-checking" && props.notice}>
        {(notice) => {
          const found = notice() as Extract<TaskNotice, { kind: "agent-checking" }>;
          return (
            <Row tone="neutral" icon={<PlugZap size={16} />} title={`${found.agentName} is finishing its setup`}>
              {found.error ? `${found.error} ` : ""}Runs start once its setup check passes. If it needs an AI account, connect one in the
              connection card on this task; Resume agent can't finish setup.
            </Row>
          );
        }}
      </Match>
      <Match when={props.notice.kind === "project-paused" && props.notice}>
        {(notice) => (
          <Row tone="amber" icon={<PauseCircle size={16} />} title={`${(notice() as Extract<TaskNotice, { kind: "project-paused" }>).projectName ?? "The project"} is paused`}>
            Work in it waits until the project is resumed from its settings.
          </Row>
        )}
      </Match>
      <Match when={props.notice.kind === "paused"}>
        <Row tone="amber" icon={<PauseCircle size={16} />} title="Paused">
          Something this task depends on is paused, such as its agent, project or company. It carries on once that's resumed.
        </Row>
      </Match>
    </Switch>
  );
}

/**
 * A failed setup command's details (#20478), behind a disclosure: which command, its exit status
 * and the tail of its output, as the server bounded and redacted them, and a link to the project's
 * workspace settings (Code and workspaces), where the command is set.
 */
function SetupFailureDetails(props: { failure: SetupFailure; projectKey: string | null }) {
  const company = useCompany();
  return (
    <div class="tn-setup" data-testid="setup-failure">
      <details>
        <summary>Command and output</summary>
        <dl class="tn-setup-facts">
          <dt>{SETUP_STEP_TEXT[props.failure.step] ?? "Setup command"}</dt>
          <dd class="mono">{props.failure.command}</dd>
          <dt>Exit code</dt>
          <dd class="mono">{props.failure.exitCode ?? "none"}</dd>
        </dl>
        <Show when={props.failure.output}>{(output) => <pre class="tn-setup-output mono">{output()}</pre>}</Show>
      </details>
      <Show when={props.projectKey}>
        {(key) => (
          <A class="tn-setup-link" href={`/${company().issuePrefix}/projects/${key()}/settings/code`}>
            Open the project's workspace settings
            <ArrowRight size={12} aria-hidden="true" />
          </A>
        )}
      </Show>
    </div>
  );
}

/**
 * The project access notice (since the 2026-10-24 sync; the old UI's TaskProjectAccessNotice and
 * ProjectAccessNotice): the agent may not read the task's project, so it hasn't started. People who
 * can manage the agent get a link to its project access; once access is added, Retry.
 */
function ProjectAccessNotice(props: {
  notice: Extract<TaskNotice, { kind: "project-access" }>;
  task: Issue;
  projectName: string | null;
  assigneeName: string | null;
  retry: JSX.Element;
}) {
  const company = useCompany();
  const people = useTaskPeople();
  const permission = createQuery(() => ({
    queryKey: ["agents", "detail", props.notice.agentId, "project-access"],
    queryFn: ({ signal }) => taskActionsApi.agentProjectAccess(props.notice.agentId, signal),
    enabled: !props.notice.ready,
    retry: false,
  }));
  const agent = () => people.agent(props.notice.agentId);
  const agentName = () => agent()?.name ?? props.assigneeName ?? "This agent";
  const project = () => (props.notice.projectId ? props.projectName : null);
  const href = () =>
    `/${company().issuePrefix}/agents/${agent()?.urlKey ?? props.notice.agentId}/permissions?fromTask=${encodeURIComponent(props.task.identifier ?? props.task.id)}`;
  return (
    <Show
      when={!props.notice.ready}
      fallback={
        <Row
          tone="green"
          icon={<ShieldCheck size={16} />}
          title="Project access is ready"
          action={props.notice.canRetry ? props.retry : undefined}
        >
          {agentName()} can now read the project. Retry to carry on with your saved message.
        </Row>
      }
    >
      <Row
        tone="red"
        icon={<ShieldX size={16} />}
        title={`${agentName()} can't access this project`}
        action={
          <A class="btn btn--secondary btn--compact" href={href()}>
            {permission.data?.canManage ? "Manage project access" : "View agent access"}
            <ArrowRight size={14} aria-hidden="true" />
          </A>
        }
      >
        This task needs {project() ?? "a project"} outside the agent's allowed projects, so it hasn't started. Your message is saved.
        <Show when={permission.isSuccess && !permission.data?.canManage}>
          {" "}Someone who can manage agents can add the project in the agent's permissions.
        </Show>
      </Row>
    </Show>
  );
}

/** A blocker a saved Retry waits on: its link, title and what to do; a private one only its identifier. */
function WaitingBlocker(props: { blocker: RetryBlocker }) {
  const company = useCompany();
  return (
    <li class="tn-dep">
      <Show
        when={!props.blocker.locked}
        fallback={
          <span class="tn-dep-locked mono" title="Private: you don't have access">
            <Lock size={12} aria-hidden="true" />
            {props.blocker.identifier ?? "Private"}
          </span>
        }
      >
        <A class="tn-dep-link mono" href={issuePath(company().issuePrefix, props.blocker)}>
          {props.blocker.identifier ?? "Task"}
        </A>
        <span class="tn-dep-title">{props.blocker.title}</span>
        <span class="tn-dep-action">{props.blocker.action}</span>
      </Show>
    </li>
  );
}

/**
 * "A dependency needs the board" (#20098; the old UI's StalledDependencyNotice): each child or
 * blocker stopped on a recovery action that needs the board, with its link, title, the recovery's
 * next step and its own Retry. Each one's state is read on its own (`GET /issues/:id`): Retry is
 * offered when that task allows it, and its row drops once its status moves on.
 */
function StalledDependencies(props: { entries: IssueBlockerStalledWakeContext[]; retry: TaskRetry }) {
  const children = createQueries(() => ({
    queries: props.entries.map((entry) => ({
      queryKey: queryKeys.issues.detail(entry.stalledIssueId),
      queryFn: ({ signal }: { signal: AbortSignal }) => issuesApi.get(entry.stalledIssueId, signal),
    })),
  }));
  const child = (issueId: string) => children[props.entries.findIndex((entry) => entry.stalledIssueId === issueId)];
  const rows = createMemo(() => stalledDependencyRows(props.entries, (issueId) => child(issueId)?.data?.status));
  return (
    <Show when={rows().length > 0}>
      <div class="tn">
        <Row
          tone="amber"
          icon={<TriangleAlert size={16} />}
          title={stalledDependencyTitle(rows().length)}
          label="Stalled dependencies"
          extra={
            <ul class="tn-deps" data-testid="stalled-dependency-notice">
              <For each={rows()}>{(row) => <StalledDependency row={row} child={child(row.entry.stalledIssueId)} retry={props.retry} />}</For>
            </ul>
          }
        />
      </div>
    </Show>
  );
}

function StalledDependency(props: {
  row: StalledDependencyRow;
  child: { data?: Issue; error: Error | null; isFetching: boolean; refetch: () => unknown } | undefined;
  retry: TaskRetry;
}) {
  const company = useCompany();
  const entry = () => props.row.entry;
  const issue = () => props.child?.data;
  const canRetry = () => issue()?.interruption?.canRetry === true;
  const busy = () => props.retry.busy(entry().stalledIssueId);
  return (
    <li class="tn-dep" data-testid="stalled-dependency-row">
      <span class="tn-dep-relation">{props.row.relation}</span>
      <A class="tn-dep-link mono" href={`/${company().issuePrefix}/issues/${props.row.ref}`}>
        {entry().stalledIssueIdentifier ?? "Task"}
      </A>
      <span class="tn-dep-title">{entry().stalledIssueTitle}</span>
      <Show when={canRetry() && issue()}>
        {(found) => (
          <button
            type="button"
            class="retry-button"
            disabled={busy()}
            aria-label={`Retry ${entry().stalledIssueIdentifier ?? "task"}`}
            onClick={() => void props.retry.retry(found())}
          >
            <RotateCcw size={12} stroke-width={2.2} aria-hidden="true" />
            {busy() ? "Retrying…" : "Retry"}
          </button>
        )}
      </Show>
      <Show when={entry().recoveryAction.nextAction}>{(next) => <span class="tn-dep-note">{next()}</span>}</Show>
      <Show when={props.child?.error && !issue()}>
        <span class="tn-dep-note tn-files-alert" role="alert">
          Couldn't load this task's state: {props.child?.error?.message}{" "}
          <button type="button" class="retry-button" disabled={props.child?.isFetching} onClick={() => void props.child?.refetch()}>
            Reload
          </button>
        </span>
      </Show>
    </li>
  );
}

function Row(props: {
  tone: "red" | "amber" | "green" | "neutral";
  icon: JSX.Element;
  title: JSX.Element;
  action?: JSX.Element;
  /** Block content under the text, such as a list of tasks. */
  extra?: JSX.Element;
  label?: string;
  children?: JSX.Element;
}) {
  return (
    <section class="tn-row" data-tone={props.tone} role={props.tone === "red" ? "alert" : "status"} aria-label={props.label}>
      <span class="tn-icon" aria-hidden="true">
        {props.icon}
      </span>
      <div class="tn-text">
        <b>{props.title}</b>
        <Show when={props.children}>
          <span>{props.children}</span>
        </Show>
        {props.extra}
      </div>
      <Show when={props.action}>
        <div class="tn-action">{props.action}</div>
      </Show>
    </section>
  );
}
