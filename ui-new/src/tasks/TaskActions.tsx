import type { Issue, IssueTreeControlMode } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Copy, EyeOff, Globe, Link2, Lock, MoreHorizontal, PauseCircle, PlayCircle, Plus, RotateCcw, XCircle } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { canManagePrivacy, taskLink, taskMarkdown, type BoardAccess } from "./task-edits";
import "./TaskActions.css";

/*
 * An open task's header actions (boards 2 and 6), after the old task page's header and its "More
 * task actions" menu (ui/src/pages/IssueDetail.tsx, IssuePrivacyActions.tsx, TaskTreeControls.tsx):
 *
 * - The privacy pill: "Open" or "Private". Making a task private is immediate; making it public
 *   asks first, since what others have seen can't be taken back, and is refused while a private
 *   parent or project keeps it private.
 * - More: add a subtask, copy the link or the task as Markdown, pause or resume the task (or its
 *   subtree), cancel or restore its subtree with a preview of what's affected, and hide the task.
 *
 * Archive from inbox comes with the Inbox (M3); sharing a private task with named people (the old
 * share sheet) isn't built yet.
 */

/** Copies text, falling back to a hidden field where the Clipboard API isn't available (plain HTTP). */
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const ok = document.execCommand("copy");
  field.remove();
  if (!ok) throw new Error("The browser didn't allow copying.");
}

/** The task's pause state, shared by the More menu and the paused notice. */
export function useTreeControlState(taskId: () => string) {
  return createQuery(() => ({
    queryKey: queryKeys.issues.section(taskId(), "tree-control-state"),
    queryFn: ({ signal }) => taskActionsApi.treeControlState(taskId(), signal),
    retry: false,
  }));
}

export function useBoardAccess() {
  const client = useQueryClient();
  const session = useSession();
  return () => ({
    access: client.getQueryData<BoardAccess>(queryKeys.access.currentBoardAccess) ?? null,
    localTrusted: !session.isAuthenticatedMode(),
    youId: session.youId(),
  });
}

/** The header actions for a task by id, once it has loaded; it shares the open task's queries. */
export function TaskHeaderActions(props: { taskId: string; onHidden?: () => void }) {
  const company = useCompany();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const subtasks = createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, { parentId: props.taskId }),
    queryFn: ({ signal }) => issuesApi.list(company().id, { parentId: props.taskId }, signal),
  }));
  return (
    <Show when={task.data}>
      {(found) => <TaskActions task={found()} subtaskCount={subtasks.data?.length ?? 0} onHidden={props.onHidden} />}
    </Show>
  );
}

function refreshTask(client: ReturnType<typeof useQueryClient>, companyId: string, taskId: string) {
  void client.invalidateQueries({ queryKey: queryKeys.issues.detail(taskId) });
  void client.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
}

export function TaskActions(props: {
  task: Issue;
  /** Subtasks make pausing and cancelling apply to the subtree. */
  subtaskCount: number;
  /** After the task is hidden, such as closing the panel. */
  onHidden?: () => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const access = useBoardAccess();
  const tree = useTreeControlState(() => props.task.id);
  const [publicOpen, setPublicOpen] = createSignal(false);
  const [treeMode, setTreeMode] = createSignal<Exclude<IssueTreeControlMode, "pause"> | null>(null);
  const [busy, setBusy] = createSignal(false);

  const isPrivate = () => props.task.visibility === "private";
  const canManage = () => {
    const current = access();
    return canManagePrivacy(props.task, current.youId, current.access, current.localTrusted);
  };
  const canControlTree = () => {
    const current = access();
    return current.localTrusted || current.access?.isInstanceAdmin === true || current.access?.companyIds.includes(props.task.companyId) === true;
  };
  const cancelHolds = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.task.id, "tree-holds", "active-cancel"),
    queryFn: ({ signal }) => taskActionsApi.listTreeHolds(props.task.id, { status: "active", mode: "cancel" }, signal),
    enabled: canControlTree() && props.subtaskCount > 0,
  }));

  const hold = () => tree.data?.activePauseHold ?? null;
  const terminal = () => props.task.status === "done" || props.task.status === "cancelled";
  const scope = () => (props.subtaskCount > 0 ? "subtree" : "leaf");
  const canPause = () => canControlTree() && !hold() && (props.subtaskCount > 0 || !terminal());
  const canResume = () => canControlTree() && hold()?.isRoot === true;
  const canCancel = () => canControlTree() && props.subtaskCount > 0;
  const canRestore = () => canControlTree() && props.subtaskCount > 0 && (cancelHolds.data?.length ?? 0) > 0;

  const setVisibility = async (visibility: "open" | "private") => {
    setBusy(true);
    try {
      await issuesApi.update(props.task.id, { visibility });
      // Privacy reaches subtasks and can move a task out of a private project.
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: queryKeys.projects.all(company().id) });
      pushToast({ tone: "success", title: visibility === "private" ? "Task is now private" : "Task is now public" });
      setPublicOpen(false);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't change who can see this task", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await copyText(text);
      pushToast({ tone: "success", title: `Copied ${what}` });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't copy", body: (error as Error).message });
    }
  };

  const pause = async () => {
    try {
      await taskActionsApi.createTreeHold(props.task.id, {
        mode: "pause",
        releasePolicy: { strategy: "manual", note: scope() === "leaf" ? "leaf_pause" : "full_pause" },
      });
      pushToast({ tone: "success", title: scope() === "leaf" ? "Work paused" : "Subtree paused" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't pause", body: (error as Error).message });
    } finally {
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      refreshTask(client, company().id, props.task.id);
    }
  };

  const hide = async () => {
    try {
      await issuesApi.update(props.task.id, { hiddenAt: new Date().toISOString() });
      pushToast({ tone: "success", title: `${props.task.identifier ?? "The task"} is hidden`, body: "It no longer shows in task lists." });
      refreshTask(client, company().id, props.task.id);
      props.onHidden?.();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't hide the task", body: (error as Error).message });
    }
  };
  const unhide = async () => {
    try {
      await issuesApi.update(props.task.id, { hiddenAt: null });
      refreshTask(client, company().id, props.task.id);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't unhide the task", body: (error as Error).message });
    }
  };

  const privacyLabel = () => (isPrivate() ? "Private" : "Open");
  const privacyHelp = () =>
    !canManage()
      ? "Only the task's owner or an admin can change who can see it."
      : isPrivate()
        ? "Only people and agents with access can see this task. Make it public…"
        : "Everyone in the company can see this task. Make it private.";

  return (
    <>
      <button
        type="button"
        class="ta-privacy"
        data-private={isPrivate() ? "" : undefined}
        aria-label={`${privacyLabel()}. ${privacyHelp()}`}
        title={privacyHelp()}
        disabled={!canManage() || busy()}
        onClick={() => (isPrivate() ? setPublicOpen(true) : void setVisibility("private"))}
      >
        <Show when={isPrivate()} fallback={<Globe size={15} aria-hidden="true" />}>
          <Lock size={15} aria-hidden="true" />
        </Show>
        {privacyLabel()}
      </button>
      <Menu placement="bottom-end">
        <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label="More task actions" title="More task actions">
          <MoreHorizontal size={16} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label="Task actions" width={250}>
          <Menu.Item icon={<Plus size={15} />} onSelect={() => commands.openNewTask({ parentId: props.task.id, projectId: props.task.projectId })}>
            Add subtask
          </Menu.Item>
          <Menu.Item icon={<Link2 size={15} />} onSelect={() => void copy(taskLink(window.location.origin, company().issuePrefix, props.task), "the link")}>
            Copy link
          </Menu.Item>
          <Menu.Item icon={<Copy size={15} />} onSelect={() => void copy(taskMarkdown(props.task), "the task as Markdown")}>
            Copy as Markdown
          </Menu.Item>
          <Show when={canPause() || canResume() || canCancel() || canRestore()}>
            <Menu.Separator />
          </Show>
          <Show when={canPause()}>
            <Menu.Item icon={<PauseCircle size={15} />} onSelect={() => void pause()}>
              {scope() === "leaf" ? "Pause work" : "Pause subtree"}
            </Menu.Item>
          </Show>
          <Show when={canResume()}>
            <Menu.Item icon={<PlayCircle size={15} />} onSelect={() => setTreeMode("resume")}>
              {scope() === "leaf" ? "Resume work" : "Resume subtree"}
            </Menu.Item>
          </Show>
          <Show when={canCancel()}>
            <Menu.Item icon={<XCircle size={15} />} danger onSelect={() => setTreeMode("cancel")}>
              Cancel subtree…
            </Menu.Item>
          </Show>
          <Show when={canRestore()}>
            <Menu.Item icon={<RotateCcw size={15} />} onSelect={() => setTreeMode("restore")}>
              Restore subtree…
            </Menu.Item>
          </Show>
          <Menu.Separator />
          <Show
            when={props.task.hiddenAt}
            fallback={
              <Menu.Item icon={<EyeOff size={15} />} danger onSelect={() => void hide()}>
                Hide this task
              </Menu.Item>
            }
          >
            <Menu.Item icon={<EyeOff size={15} />} onSelect={() => void unhide()}>
              Show this task again
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>

      <MakePublicDialog open={publicOpen()} task={props.task} busy={busy()} onCancel={() => setPublicOpen(false)} onConfirm={() => void setVisibility("open")} />
      <TreeControlDialog
        task={props.task}
        mode={treeMode()}
        scope={scope()}
        holdId={hold()?.holdId ?? null}
        wakeByDefault={(!!props.task.assigneeAgentId && !terminal()) || props.subtaskCount > 0}
        onClose={() => setTreeMode(null)}
      />
    </>
  );
}

function MakePublicDialog(props: { open: boolean; task: Issue; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const constraints = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.task.id, "privacy-constraints", props.task.parentId ?? "", props.task.projectId ?? ""),
    queryFn: ({ signal }) => taskActionsApi.privacyConstraints(props.task.id, signal),
    enabled: props.open,
    staleTime: 0,
  }));
  const blocked = () =>
    constraints.isError
      ? "Couldn't check this task's privacy. Try again before making it public."
      : !constraints.data || constraints.isFetching
        ? "Checking…"
        : constraints.data.publicBlockedBy === "parent"
          ? "Its parent task is private. Move it out of that parent first."
          : constraints.data.publicBlockedBy === "project"
            ? "Its project is private. Move it out of that project first."
            : null;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onCancel()}
      title="Make this task public?"
      width={480}
      footer={
        <>
          <Show when={constraints.isError}>
            <Button variant="quiet" onClick={() => void constraints.refetch()}>
              Check again
            </Button>
          </Show>
          <Button variant="quiet" onClick={() => props.onCancel()}>
            Keep it private
          </Button>
          <Button variant="danger" disabled={props.busy || blocked() !== null} onClick={() => props.onConfirm()}>
            {props.busy ? "Making it public…" : "Make public"}
          </Button>
        </>
      }
    >
      <p class="ta-dialog-text">
        Everyone in the company will be able to read this task, its comments, documents and run history. Private subtasks stay
        private.{" "}
        <Show when={constraints.data?.leavesPersonalProject}>It also leaves its personal project. </Show>
        <b>What others have seen can't be taken back.</b>
      </p>
      <Show when={blocked() && blocked() !== "Checking…"}>
        <p class="ta-dialog-warn" role="alert">
          {blocked()}
        </p>
      </Show>
    </Dialog>
  );
}

/**
 * Resume, cancel or restore a task tree, after a preview of how many tasks and agents it touches.
 * Resuming and restoring can wake the affected agents.
 */
export function TreeControlDialog(props: {
  task: Issue;
  mode: Exclude<IssueTreeControlMode, "pause"> | null;
  scope: "leaf" | "subtree";
  holdId: string | null;
  wakeByDefault: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const company = useCompany();
  const [wake, setWake] = createSignal<boolean | null>(null);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const preview = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.task.id, "tree-control-preview", props.mode ?? "none"),
    queryFn: ({ signal }) => taskActionsApi.previewTreeControl(props.task.id, props.mode!, signal),
    enabled: props.mode !== null,
    staleTime: 0,
    retry: false,
  }));
  const affected = () => (preview.data?.issues ?? []).filter((issue) => !issue.skipped).length;
  const agents = () => preview.data?.totals.affectedAgents ?? 0;
  const tasks = () => `${affected()} task${affected() === 1 ? "" : "s"}`;
  const wakeAgents = () => wake() ?? props.wakeByDefault;
  const cancel = () => props.mode === "cancel";
  const title = () =>
    cancel() ? "Cancel the subtree?" : props.mode === "restore" ? "Restore the subtree" : props.scope === "leaf" ? "Resume work" : "Resume the subtree";

  const close = () => {
    if (pending()) return;
    setWake(null);
    setError(null);
    props.onClose();
  };
  const apply = async () => {
    const mode = props.mode;
    if (!mode) return;
    setPending(true);
    setError(null);
    try {
      if (mode === "resume") {
        if (!props.holdId) throw new Error("There's no pause to resume.");
        const released = await taskActionsApi.releaseTreeHold(props.task.id, props.holdId, wakeAgents());
        const failures = released.wakeFailures ?? [];
        if (failures.length > 0) {
          pushToast({
            tone: "error",
            title: `Resumed, but ${failures.length} ${failures.length === 1 ? "task" : "tasks"} couldn't start`,
            body: failures[0]!.message,
          });
        } else {
          pushToast({ tone: "success", title: "Resumed" });
        }
      } else {
        await taskActionsApi.createTreeHold(props.task.id, {
          mode,
          releasePolicy: { strategy: "manual" },
          ...(mode === "restore" ? { metadata: { wakeAgents: wakeAgents() } } : {}),
        });
        pushToast({ tone: "success", title: mode === "cancel" ? `Cancelled ${tasks()}` : `Restored ${tasks()}` });
      }
      setPending(false);
      close();
    } catch (failure) {
      setError((failure as Error).message);
      setPending(false);
    } finally {
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    }
  };

  return (
    <Dialog
      open={props.mode !== null}
      onOpenChange={(open) => !open && close()}
      title={title()}
      width={440}
      footer={
        <>
          <Button variant="quiet" disabled={pending()} onClick={close}>
            {cancel() ? "Keep the tasks" : "Close"}
          </Button>
          <Button
            variant={cancel() ? "danger" : "primary"}
            disabled={pending() || preview.isFetching || preview.isError || !preview.data}
            onClick={() => void apply()}
          >
            {pending() ? "Working…" : cancel() ? `Cancel ${tasks()}` : props.mode === "restore" ? `Restore ${tasks()}` : title()}
          </Button>
        </>
      }
    >
      <p class="ta-dialog-text">
        {preview.isFetching && !preview.data
          ? "Checking what this affects…"
          : cancel()
            ? `${tasks()} will be cancelled.`
            : `${tasks()} will ${props.mode === "restore" ? "be restored" : "resume"}.`}
      </p>
      <Show when={preview.isError}>
        <p class="ta-dialog-warn" role="alert">
          Couldn't check what this affects: {(preview.error as Error)?.message}{" "}
          <button type="button" class="ta-link" onClick={() => void preview.refetch()}>
            Try again
          </button>
        </p>
      </Show>
      <Show when={!cancel()}>
        <label class="ta-check">
          <input type="checkbox" checked={wakeAgents()} disabled={pending() || agents() === 0} onChange={(event) => setWake(event.currentTarget.checked)} />
          Wake the affected agents ({agents()})
        </label>
      </Show>
      <Show when={error()}>
        <p class="ta-dialog-warn" role="alert">
          {error()}
        </p>
      </Show>
    </Dialog>
  );
}
