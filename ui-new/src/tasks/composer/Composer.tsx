import type { Issue, IssueWorkMode } from "@paperclipai/shared";
import { createQuery, keepPreviousData, useQueryClient } from "@tanstack/solid-query";
import { ArrowUp, AtSign, Check, ChevronDown, LoaderCircle, Paperclip, RotateCcw, Target, TriangleAlert, X } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { agentsApi } from "@/api/agents";
import { commentsApi } from "@/api/comments";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { queuedCommentsApi } from "@/api/queued-comments";
import { useCompany } from "@/lib/company";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { newId } from "../new-task";
import { useTaskPeople, type TaskPeople } from "../people";
import { agentRunDefaults, agentSupportsOverrides, effortOptions, mergeRunOverrides, readRunSettings, type RunSettings } from "../run-overrides";
import {
  clearComposerDraft,
  loadComposerDraft,
  placeholderFor,
  planSend,
  reopensByDefault,
  saveComposerDraft,
  WORK_MODES,
  type Assignee,
  type ComposerAttachment,
  type SendMode,
} from "./composer-model";
import { activeMention, insertMention, matchesQuery, type ActiveMention, type MentionTarget } from "./mentions";
import { MentionOption } from "./MentionTextArea";
import { createRunnerGoal, RunnerGoalCard } from "./RunnerGoal";
import { goalFromComposer, type GoalCommand } from "./runner-goal-model";
import "./Composer.css";

/*
 * The composer (board 3, tasks/discussion and steering/*), under a task's thread and in the run
 * modal's live footer.
 *
 * - Markdown text with @-mentions of agents, people and tasks, picked from a list as you type.
 * - Files by the clip button, paste or drop. Images go inline; other files ride along as links.
 * - The work mode, who the message is for (reassigning the task) with the run's model and effort
 *   (decision 13), and reopening a closed task.
 * - Cmd/Ctrl+Enter sends. While a run is going the message queues for the next turn; the send menu
 *   steers it into the current turn or interrupts the run instead.
 * - For runners that support it, the Goal pill ("Goal: keep pursuing", or `/goal …` typed) sets a
 *   goal the agent keeps working toward instead of sending a message; its card sits above the
 *   composer (RunnerGoal.tsx).
 * - The draft is saved per task.
 *
 * `compact` (the run modal) keeps the text, files and send controls only.
 */

const SAVE_DELAY = 300;

export function Composer(props: {
  task: Issue;
  /** The run going on this task now, if any. */
  liveRunId?: string | null;
  compact?: boolean;
  autofocus?: boolean;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  let textarea: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const [body, setBody] = createSignal("");
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [workMode, setWorkMode] = createSignal<IssueWorkMode>(props.task.workMode);
  const [assignee, setAssignee] = createSignal<Assignee | null>(null);
  const [runSettings, setRunSettings] = createSignal<RunSettings | null>(null);
  const [reopenChoice, setReopenChoice] = createSignal<boolean | null>(null);
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [caret, setCaret] = createSignal(0);
  const [pickerIndex, setPickerIndex] = createSignal(0);
  const [pickerClosedAt, setPickerClosedAt] = createSignal<number | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [goalMode, setGoalMode] = createSignal(false);
  let requestId = newId();

  // Each task keeps its own draft: switching tasks saves this one and loads the next.
  createEffect(
    on(
      () => props.task.id,
      (taskId, previous) => {
        if (previous) saveComposerDraft(previous, { body: untrack(body), attachments: untrack(attachments) });
        const draft = loadComposerDraft(taskId);
        batch(() => {
          setBody(draft.body);
          setAttachments(draft.attachments);
          setAssignee(null);
          setRunSettings(null);
          setReopenChoice(null);
          setProblem(null);
          setGoalMode(false);
          setWorkMode(props.task.workMode);
        });
        requestId = newId();
        queueMicrotask(resize);
      },
    ),
  );
  createEffect(on(() => props.task.workMode, (mode) => setWorkMode(mode), { defer: true }));
  createEffect(
    on([body, attachments], () => {
      const taskId = props.task.id;
      const timer = window.setTimeout(() => saveComposerDraft(taskId, { body: body(), attachments: attachments() }), SAVE_DELAY);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  onCleanup(() => saveComposerDraft(props.task.id, { body: body(), attachments: attachments() }));

  const current = (): Assignee => ({ agentId: props.task.assigneeAgentId, userId: props.task.assigneeUserId });
  const target = () => assignee() ?? current();
  const targetAgent = () => people.agent(target().agentId);
  const targetName = () => {
    const agent = targetAgent();
    if (agent) return agent.name;
    const userId = target().userId;
    if (userId) return userId === people.youId() ? "You" : people.personName(userId);
    return null;
  };
  const closed = () => ["done", "cancelled", "blocked"].includes(props.task.status);
  const reopen = () => closed() && (reopenChoice() ?? reopensByDefault(props.task.status, target()));
  const live = () => !!props.liveRunId;
  const goal = createRunnerGoal({ taskId: () => props.task.id, agentId: () => target().agentId ?? null, enabled: () => !props.compact });

  const queue = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.task.id, "queued-comments"),
    queryFn: ({ signal }) => queuedCommentsApi.get(props.task.id, signal),
    enabled: live(),
  }));
  const canSteer = () => !queue.data || (queue.data.protocol !== "legacy" && queue.data.steeringDisposition === "available");

  // @-mentions: the "@query" before the caret opens the picker.
  const mention = createMemo<ActiveMention | null>(() => {
    const found = activeMention(body(), caret());
    return found && found.start !== pickerClosedAt() ? found : null;
  });
  const [term, setTerm] = createSignal("");
  createEffect(
    on(
      () => mention()?.query ?? null,
      (query) => {
        if (query === null) return setTerm("");
        const timer = window.setTimeout(() => setTerm(query.trim()), 150);
        onCleanup(() => window.clearTimeout(timer));
      },
    ),
  );
  const taskResults = createQuery(() => ({
    queryKey: queryKeys.issues.search(company().id, term(), 5),
    queryFn: ({ signal }) => issuesApi.search(company().id, { q: term(), limit: 5 }, signal),
    enabled: !!mention() && term().length > 0,
    placeholderData: keepPreviousData,
  }));
  const candidates = createMemo((): MentionTarget[] => {
    const at = mention();
    if (!at) return [];
    const agents = people
      .assignableAgents()
      .filter((agent) => matchesQuery(agent.name, at.query))
      .slice(0, 5)
      .map((agent): MentionTarget => ({ kind: "agent", id: agent.id, name: agent.name }));
    const users = people
      .otherPeople()
      .filter((person) => matchesQuery(person.name, at.query))
      .slice(0, 4)
      .map((person): MentionTarget => ({ kind: "user", id: person.id, name: person.name }));
    const tasks = at.query
      ? (taskResults.data ?? [])
          .filter((issue) => issue.identifier && issue.id !== props.task.id)
          .map((issue): MentionTarget => ({ kind: "task", id: issue.id, identifier: issue.identifier!, title: issue.title }))
      : [];
    return [...agents, ...users, ...tasks];
  });
  createEffect(on(() => mention()?.start, () => setPickerIndex(0)));
  const pickerOpen = () => !!mention() && candidates().length > 0;

  const syncCaret = () => textarea && setCaret(textarea.selectionStart ?? 0);
  const resize = () => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  };
  const setText = (text: string, nextCaret: number) => {
    setBody(text);
    queueMicrotask(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
      resize();
    });
  };
  const pick = (target: MentionTarget) => {
    const at = mention();
    if (!at) return;
    const result = insertMention(body(), at, target);
    setText(result.text, result.caret);
  };
  const insertAtCaret = (text: string) => {
    const position = textarea?.selectionStart ?? body().length;
    const before = body().slice(0, position);
    const spaced = before && !/\s$/.test(before) ? ` ${text}` : text;
    setText(before + spaced + body().slice(position), position + spaced.length);
  };

  // Files: uploaded at once to the task's attachments, then sent with the message.
  const upload = async (file: File) => {
    const key = newId();
    const inline = file.type.startsWith("image/");
    setAttachments((list) => [...list, { key, name: file.name, size: file.size, status: "uploading", inline }]);
    try {
      const uploaded = await issuesApi.uploadAttachment(company().id, props.task.id, file);
      if (!attachments().some((item) => item.key === key)) return;
      const name = uploaded.originalFilename ?? file.name;
      setAttachments((list) =>
        list.map((item) => (item.key === key ? { ...item, name, status: "attached", attachmentId: uploaded.id, contentPath: uploaded.contentPath } : item)),
      );
      if (inline) insertAtCaret(`![${name.replace(/[[\]\\]/g, "\\$&")}](${uploaded.contentPath})`);
    } catch (error) {
      setAttachments((list) => list.map((item) => (item.key === key ? { ...item, status: "error", error: error instanceof Error ? error.message : "Upload failed" } : item)));
    }
  };
  const addFiles = (files: FileList | File[] | null | undefined) => {
    for (const file of Array.from(files ?? [])) void upload(file);
  };
  const removeAttachment = (item: ComposerAttachment) => {
    setAttachments((list) => list.filter((entry) => entry.key !== item.key));
    if (item.inline && item.contentPath) setBody((text) => text.replace(new RegExp(`!\\[[^\\]]*\\]\\(${item.contentPath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"), "").trimEnd());
  };

  const send = async (mode: SendMode) => {
    if (sending()) return;
    const goalSend = props.compact ? null : goalFromComposer({ body: body(), goalMode: goalMode(), attachmentCount: attachments().length });
    if (goalSend) return sendGoal(goalSend);
    const plan = planSend(
      { body: body(), attachments: attachments(), workMode: workMode(), assignee: assignee(), runSettings: runSettings(), reopen: reopen() },
      { task: props.task, mode, clientRequestId: requestId, adapterTypeOf: (id) => people.agent(id)?.adapterType },
    );
    if (!plan.ok) {
      setProblem(plan.problem);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      if (plan.workMode) await issuesApi.update(props.task.id, { workMode: plan.workMode });
      const commentId =
        plan.request.via === "post"
          ? (await commentsApi.post(props.task.id, plan.request.data)).id
          : ((await commentsApi.updateWithComment(props.task.id, plan.request.data)).comment?.id ?? null);
      if (plan.steer && commentId) await steerIn(commentId);
      batch(() => {
        setBody("");
        setAttachments([]);
        setAssignee(null);
        setRunSettings(null);
        setReopenChoice(null);
      });
      clearComposerDraft(props.task.id);
      requestId = newId();
      queueMicrotask(resize);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  /**
   * Sets or acts on the runner goal instead of sending a message. A goal for another agent hands the
   * task over first, without waking anyone (`deferWakeForGoal`): the goal starts the run.
   */
  const sendGoal = async (plan: { ok: true; command: GoalCommand } | { ok: false; problem: string }) => {
    if (!plan.ok) {
      setProblem(plan.problem);
      return;
    }
    const reassignment = assignee();
    if (reassignment && plan.command.action !== "focus" && !reassignment.agentId) {
      setProblem("Pick an agent for the goal: goals are for agents.");
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      if (reassignment && plan.command.action !== "focus") {
        const adapterType = people.agent(reassignment.agentId)?.adapterType ?? null;
        const settings = runSettings();
        await issuesApi.update(props.task.id, {
          assigneeAgentId: reassignment.agentId,
          assigneeUserId: null,
          assigneeAdapterOverrides: settings ? mergeRunOverrides(props.task.assigneeAdapterOverrides, adapterType, settings, true) : null,
          deferWakeForGoal: true,
        });
        batch(() => {
          setAssignee(null);
          setRunSettings(null);
        });
        void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
        void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      }
      await goal.run(plan.command);
      batch(() => {
        setBody("");
        setGoalMode(false);
      });
      clearComposerDraft(props.task.id);
      queueMicrotask(resize);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  /** Steers a just-posted message into the running turn, if it's still waiting in the queue. */
  const steerIn = async (commentId: string) => {
    const latest = await queuedCommentsApi.get(props.task.id);
    const queued = latest.entries.some((entry) => entry.comment.id === commentId);
    if (!queued || !latest.queueId || !latest.targetRunId || latest.steeringDisposition !== "available") {
      if (queued) pushToast({ tone: "info", title: "Queued for the next turn", body: "This run can't take messages mid-run, so it waits for the next turn." });
      return;
    }
    try {
      const next = await queuedCommentsApi.steer(props.task.id, commentId, { queueId: latest.queueId, revision: latest.revision, targetRunId: latest.targetRunId });
      client.setQueryData(queryKeys.issues.section(props.task.id, "queued-comments"), next);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't steer the message", body: `${error instanceof Error ? error.message : String(error)} It's queued for the next turn.` });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (pickerOpen()) {
      const count = candidates().length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setPickerIndex((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
        event.preventDefault();
        pick(candidates()[pickerIndex()]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPickerClosedAt(mention()!.start);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send("send");
    }
  };

  const placeholder = () =>
    goalMode() ? `What should ${targetAgent()?.name ?? "the agent"} keep working toward? It keeps going across turns until it's done` : basePlaceholder();
  const basePlaceholder = () => (props.compact ? (live() ? "Message the agent. It waits for the next turn unless you steer it in" : "Comment") : placeholderFor(workMode(), targetAgent() ? targetName() : null));
  const optionId = (index: number) => `cmp-${props.task.id}-opt-${index}`;
  const fieldId = () => `cmp-${props.task.id}${props.compact ? "-run" : ""}`;

  return (
    <>
    <Show when={!props.compact}>
      <RunnerGoalCard control={goal} agentName={targetAgent()?.name ?? null} />
    </Show>
    <form
      class="cmp"
      classList={{ "cmp--compact": props.compact, "cmp--drop": dragging(), "cmp--goal": goalMode() }}
      data-mode={workMode()}
      aria-busy={sending()}
      onSubmit={(event) => {
        event.preventDefault();
        void send("send");
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      <div class="cmp-field">
        <Show when={pickerOpen()}>
          <div class="cmp-picker" role="listbox" id={`${fieldId()}-list`} aria-label="Mention">
            <For each={candidates()}>
              {(candidate, index) => (
                <>
                  <Show when={index() === 0 || candidates()[index() - 1]!.kind !== candidate.kind}>
                    <div class="mh" aria-hidden="true">
                      {candidate.kind === "agent" ? "Agents" : candidate.kind === "user" ? "People" : "Tasks"}
                    </div>
                  </Show>
                  <div
                    id={optionId(index())}
                    class="cmp-option"
                    role="option"
                    aria-selected={index() === pickerIndex()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(candidate)}
                  >
                    <MentionOption candidate={candidate} people={people} />
                  </div>
                </>
              )}
            </For>
          </div>
        </Show>
        <label class="sr-only" for={fieldId()}>
          {props.compact ? "Message the agent" : "Comment"}
        </label>
        <textarea
          id={fieldId()}
          ref={(element) => {
            textarea = element;
            if (props.autofocus) queueMicrotask(() => element.focus());
          }}
          class="cmp-text"
          rows={2}
          value={body()}
          placeholder={placeholder()}
          readOnly={sending()}
          role="combobox"
          aria-expanded={pickerOpen()}
          aria-controls={pickerOpen() ? `${fieldId()}-list` : undefined}
          aria-activedescendant={pickerOpen() ? optionId(pickerIndex()) : undefined}
          aria-autocomplete="list"
          onInput={(event) => {
            setBody(event.currentTarget.value);
            syncCaret();
            setPickerClosedAt(null);
            resize();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onBlur={() => setPickerClosedAt(mention()?.start ?? null)}
          onFocus={() => setPickerClosedAt(null)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            addFiles(files);
          }}
        />
      </div>

      <Show when={attachments().length > 0}>
        <ul class="cmp-files" aria-label="Files">
          <For each={attachments()}>
            {(item) => (
              <li class="cmp-file" data-status={item.status} title={item.error}>
                <Show when={item.status === "uploading"} fallback={item.status === "error" ? <TriangleAlert size={13} aria-hidden="true" /> : <Paperclip size={13} aria-hidden="true" />}>
                  <LoaderCircle size={13} class="cmp-spin" aria-hidden="true" />
                </Show>
                <span class="cmp-file-name">{item.name}</span>
                <Show when={item.status === "error"}>
                  <span class="cmp-file-error">{item.error ?? "Didn't upload"}</span>
                </Show>
                <button type="button" class="cmp-file-x" aria-label={`Remove ${item.name}`} onClick={() => removeAttachment(item)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={problem()}>
        <p class="cmp-problem" role="alert">
          {problem()}
        </p>
      </Show>

      <div class="cmp-bar">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <button type="button" class="btn btn--icon btn--compact" aria-label="Attach files" title="Attach files" onClick={() => fileInput?.click()}>
          <Paperclip size={15} aria-hidden="true" />
        </button>
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Mention someone" title="Mention an agent, person or task" onClick={() => insertAtCaret("@")}>
          <AtSign size={15} aria-hidden="true" />
        </button>

        <Show when={!props.compact}>
          <Menu>
            <Menu.Trigger class="cmp-pill" aria-label={`Work mode: ${WORK_MODES.find((mode) => mode.value === workMode())?.label ?? workMode()}`}>
              {WORK_MODES.find((mode) => mode.value === workMode())?.label ?? "Skill test"}
              <ChevronDown size={13} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Work mode" width={280}>
              <For each={WORK_MODES}>
                {(mode) => (
                  <Menu.Item description={mode.description} hint={mode.value === workMode() ? <Check size={14} aria-hidden="true" /> : undefined} onSelect={() => setWorkMode(mode.value)}>
                    {mode.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>

          <AssigneePicker
            task={props.task}
            people={people}
            target={target()}
            changed={!!assignee()}
            runSettings={runSettings()}
            onAssign={(next) => {
              batch(() => {
                setAssignee(next.agentId === current().agentId && next.userId === current().userId ? null : next);
                setRunSettings(null);
              });
            }}
            onRunSettings={setRunSettings}
            name={targetName()}
          />
        </Show>

        <Show when={!props.compact && (goal.available() || goalMode())}>
          <button
            type="button"
            class="cmp-pill"
            aria-pressed={goalMode()}
            title={goal.projection()?.capability.reason ?? "Set a goal the agent keeps pursuing across turns"}
            onClick={() => {
              setGoalMode(!goalMode());
              setProblem(null);
              textarea?.focus();
            }}
          >
            <Target size={13} aria-hidden="true" />
            {goalMode() ? "Goal: keep pursuing" : "Goal"}
          </button>
        </Show>

        <Show when={closed() && !goalMode()}>
          <button
            type="button"
            class="cmp-pill"
            aria-pressed={reopen()}
            title={reopen() ? "Sending moves the task back to Todo" : "Sending leaves the task closed"}
            onClick={() => setReopenChoice(!reopen())}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {reopen() ? "Reopens the task" : "Keep closed"}
          </button>
        </Show>

        <div class="cmp-send">
          <Button type="submit" variant="primary" size="compact" class="cmp-send-main" disabled={sending()} title="Send (Ctrl+Enter or ⌘+Enter)">
            <Show when={sending()} fallback={<ArrowUp size={14} aria-hidden="true" />}>
              <LoaderCircle size={14} class="cmp-spin" aria-hidden="true" />
            </Show>
            {goalMode() ? "Set goal" : live() ? "Queue" : "Send"}
          </Button>
          <Show when={live() && !goalMode()}>
            <Menu placement="top-end">
              <Menu.Trigger class="btn btn--primary btn--compact cmp-send-more" aria-label="Send options: steer now, interrupt and send" disabled={sending()}>
                <ChevronDown size={14} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Send options" width={300}>
                <Menu.Item
                  disabled={!canSteer()}
                  description={canSteer() ? "Send it into the run that's going now" : "This agent's runner can't take messages mid-run"}
                  onSelect={() => void send("steer")}
                >
                  Steer now
                </Menu.Item>
                <Menu.Item description="Stop the run and start a new one with this message" onSelect={() => void send("interrupt")}>
                  Interrupt and send
                </Menu.Item>
                <Menu.Item description="Wait for the agent's next turn" onSelect={() => void send("send")}>
                  Queue for the next turn
                </Menu.Item>
              </Menu.Content>
            </Menu>
          </Show>
        </div>
      </div>
    </form>
    </>
  );
}

/**
 * "To <assignee>": who the message is for. Picking someone else reassigns the task when it's sent.
 * For agents whose runner takes them, the run's model and effort are set here too; they stay on the
 * task for its next runs.
 */
function AssigneePicker(props: {
  task: Issue;
  people: TaskPeople;
  target: Assignee;
  changed: boolean;
  runSettings: RunSettings | null;
  name: string | null;
  onAssign: (next: Assignee) => void;
  onRunSettings: (settings: RunSettings) => void;
}) {
  const company = useCompany();
  const agent = () => props.people.agent(props.target.agentId);
  const overridable = () => agentSupportsOverrides(agent());
  const defaults = () => (agent() ? agentRunDefaults(agent()!.adapterType, agent()!.adapterConfig) : { model: null, effort: null });
  const shown = (): RunSettings =>
    props.runSettings ?? (props.changed ? { model: null, effort: null } : readRunSettings(props.task.assigneeAdapterOverrides, agent()?.adapterType));
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, agent()?.adapterType ?? "none"),
    queryFn: () => agentsApi.adapterModels(company().id, agent()!.adapterType),
    enabled: overridable(),
    staleTime: 5 * 60_000,
  }));
  const efforts = () => (agent() ? effortOptions(agent()!.adapterType, shown().model ?? defaults().model, agent()!.adapterConfig) : []);
  const is = (agentId: string | null, userId: string | null) => (props.target.agentId ?? null) === agentId && (props.target.userId ?? null) === userId;
  const summary = () => {
    const settings = props.runSettings;
    if (!settings) return "";
    const model = settings.model ? (models.data?.find((entry) => entry.id === settings.model)?.label ?? settings.model) : null;
    return [model, settings.effort].filter(Boolean).join(" · ");
  };

  return (
    <Popover>
      <Popover.Trigger class="cmp-pill" classList={{ "cmp-pill--changed": props.changed || !!props.runSettings }} aria-label={`Message for ${props.name ?? "no one"}. Change who it's for`}>
        <Show when={agent()} fallback={<Show when={props.target.userId}>{(id) => <InitialsDisc name={props.name ?? "?"} seed={id()} size={16} you={id() === props.people.youId()} />}</Show>}>
          {(found) => <AgentAvatar agent={found()} size={16} />}
        </Show>
        <span class="cmp-pill-text">{props.name ? `To ${props.name}` : "Unassigned"}</span>
        <Show when={summary()}>
          <span class="cmp-pill-meta">· {summary()}</span>
        </Show>
        <ChevronDown size={13} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content label="Who it's for" width={overridable() ? 560 : 300} class="cmp-who">
        <div class="cmp-who-grid" classList={{ "cmp-who-grid--run": overridable() }}>
          <div class="cmp-who-list" role="listbox" aria-label="Assignee">
            <p class="cmp-who-note">Picking someone else reassigns the task when you send.</p>
            <div class="mh">Agents</div>
            <For each={props.people.assignableAgents()}>
              {(candidate) => (
                <button type="button" class="cmp-option" role="option" aria-selected={is(candidate.id, null)} onClick={() => props.onAssign({ agentId: candidate.id, userId: null })}>
                  <AgentAvatar agent={candidate} size={24} />
                  <span class="cmp-option-label">{candidate.name}</span>
                  <Show when={is(candidate.id, null)}>
                    <Check size={14} aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
            <div class="mh">People</div>
            <Show when={props.people.youId()}>
              {(you) => (
                <button type="button" class="cmp-option" role="option" aria-selected={is(null, you())} onClick={() => props.onAssign({ agentId: null, userId: you() })}>
                  <InitialsDisc name="You" seed={you()} size={20} you />
                  <span class="cmp-option-label">You</span>
                </button>
              )}
            </Show>
            <For each={props.people.otherPeople()}>
              {(person) => (
                <button type="button" class="cmp-option" role="option" aria-selected={is(null, person.id)} onClick={() => props.onAssign({ agentId: null, userId: person.id })}>
                  <InitialsDisc name={person.name} seed={person.id} size={20} />
                  <span class="cmp-option-label">{person.name}</span>
                </button>
              )}
            </For>
            <button type="button" class="cmp-option" role="option" aria-selected={is(null, null)} onClick={() => props.onAssign({ agentId: null, userId: null })}>
              <span class="cmp-option-label">No one</span>
            </button>
          </div>
          <Show when={overridable()}>
            <div class="cmp-who-run">
              <div role="radiogroup" aria-label="Model" class="cmp-radios">
                <div class="mh">Model</div>
                <button type="button" class="cmp-radio" role="radio" aria-checked={shown().model === null} onClick={() => props.onRunSettings({ ...shown(), model: null })}>
                  <span>Agent default</span>
                  <small>{defaults().model ?? "Its own setting"}</small>
                </button>
                <For each={models.data ?? []} fallback={<p class="cmp-who-note">{models.isLoading ? "Loading models…" : "No models listed."}</p>}>
                  {(model) => (
                    <button type="button" class="cmp-radio" role="radio" aria-checked={shown().model === model.id} onClick={() => props.onRunSettings({ ...shown(), model: model.id })}>
                      <span>{model.label}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={efforts().length > 0}>
                <div role="radiogroup" aria-label="Effort" class="cmp-radios">
                  <div class="mh">Effort</div>
                  <button type="button" class="cmp-radio" role="radio" aria-checked={shown().effort === null} onClick={() => props.onRunSettings({ ...shown(), effort: null })}>
                    <span>Agent default</span>
                    <small>{defaults().effort ?? "Its own setting"}</small>
                  </button>
                  <For each={efforts()}>
                    {(option) => (
                      <button type="button" class="cmp-radio" role="radio" aria-checked={shown().effort === option.value} onClick={() => props.onRunSettings({ ...shown(), effort: option.value })}>
                        <span>{option.label}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <p class="cmp-who-note">Applies to this task's next runs.</p>
            </div>
          </Show>
        </div>
      </Popover.Content>
    </Popover>
  );
}
