import type { Issue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, EyeOff, PauseCircle, RotateCcw, ShieldCheck, ShieldX, TriangleAlert } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import { pauseDetail, retryCountdown, taskNotices, WAITING_TEXT, type TaskNotice } from "./recovery";
import { useTaskRetry } from "./retry";
import { TreeControlDialog, useTreeControlState } from "./TaskActions";
import "./TaskNotices.css";

/*
 * Health notices at the top of an open task (`tasks/recovery`), in every section of the panel, the
 * modal and the full page. recovery.ts decides which show; this draws them with their one fix each:
 * Retry (the same request as the list rows' Retry, retry.tsx), Resume for a paused task or subtree
 * (releasing its pause, with the agents woken), Resume agent for a paused assignee (and a fresh
 * wake, since the pause dropped the assignment's), and the project access notice from the
 * 2026-10-24 upstream sync, which links to the agent's project access and retries once it's added.
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
    return taskNotices({ task: current, assignee: assignee(), project: project(), tree: tree.data, hasSubtasks: hasSubtasks() });
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
    <Show when={notices().length > 0 && task()}>
      {(current) => (
        <div class="tn" role="region" aria-label="Task health">
          <For each={notices()}>
            {(notice) => (
              <Notice
                notice={notice}
                task={current()}
                projectName={project()?.name ?? null}
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
  );
}

function Notice(props: {
  notice: TaskNotice;
  task: Issue;
  projectName: string | null;
  assigneeName: string | null;
  retrying: boolean;
  onRetry: () => void;
  resumingAgent: boolean;
  onResumeAgent: (agentId: string) => void;
  onResumeTree: () => void;
}) {
  const company = useCompany();
  // A second-by-second clock while the retry countdown is on screen.
  const now = useNow(() => props.notice.kind === "interrupted" && props.notice.state === "retry_scheduled");
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
          return (
            <Row
              tone={found.state === "failed" ? "red" : "amber"}
              icon={<TriangleAlert size={16} />}
              title={found.state === "failed" ? "Interrupted" : `${retryCountdown(found.nextRetryAt, now())}…`}
              action={found.canRetry ? retryButton(found.state === "failed" ? "Retry" : "Retry now") : undefined}
            >
              {found.state === "failed"
                ? "The agent couldn't finish its last attempt. Anything you sent is saved."
                : "The last attempt didn't finish, so the agent will try again by itself."}
            </Row>
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
        {(notice) => (
          <Row tone="amber" icon={<PauseCircle size={16} />} title="Waiting on someone">
            {WAITING_TEXT[(notice() as Extract<TaskNotice, { kind: "waiting" }>).action]}
          </Row>
        )}
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
              New runs won't start until the agent is resumed. {pauseDetail(found.reason)}
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

function Row(props: {
  tone: "red" | "amber" | "green" | "neutral";
  icon: JSX.Element;
  title: JSX.Element;
  action?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section class="tn-row" data-tone={props.tone} role={props.tone === "red" ? "alert" : "status"}>
      <span class="tn-icon" aria-hidden="true">
        {props.icon}
      </span>
      <div class="tn-text">
        <b>{props.title}</b>
        <span>{props.children}</span>
      </div>
      <Show when={props.action}>
        <div class="tn-action">{props.action}</div>
      </Show>
    </section>
  );
}
