import type { AgentDetail, RunPromptPreview, RunPromptPreviewKind } from "@paperclipai/shared";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { ChevronDown, TriangleAlert } from "lucide-solid";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, Show } from "solid-js";
import { agentsApi, runPreviewQueryKey } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useChatListQuery } from "@/chat/chat-index";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { AccessRow, AutoMemoryRow, GitHubRow, ManifestList, ManifestRow, McpServersRow, MonoValue, OverriddenRow, SkillsRow } from "@/runs/ManifestRows";
import { PendingMark, PromptSections } from "@/runs/PromptSections";
import { InfoHeading, TextInput } from "@/ui/Field";
import { Popover } from "@/ui/Popover";
import { failure } from "../shared";
import {
  blockerLines,
  checkoutValue,
  chosenProject,
  claudeMdValue,
  credentialValue,
  effectivePromptKind,
  engineValue,
  instructionsValue,
  previewManifest,
  projectChoices,
  PROMPT_KIND_LABEL,
  promptKinds,
  promptNote,
  promptPreviewView,
  promptTaskGroups,
  promptTaskName,
  readStoredProject,
  repoSkillsValue,
  SESSION_TEXT,
  storeProject,
  taskWorktreeValue,
  unsupportedText,
  type PreviewValue,
  type PromptTask,
} from "./run-preview-model";
import "./RunPreviewCard.css";

/*
 * "What runs get" (step 4b part 2, fork/step-4b-parts-2-3.md): what the agent's next sealed run
 * would get, before any run, from `GET /agents/:id/run-preview?projectId=`. The rows are the run
 * modal's "What this run got" (runs/ManifestRows.tsx), plus the engine and the project's
 * repository; the session row says what happens instead, since that depends on the task.
 *
 * "For tasks in" picks the project whose CLAUDE.md and repo skills switches and checkout the
 * preview follows, remembered per agent on this device. The read sits under the agent's query
 * key, so saving the agent's settings (refreshAgent) refetches it; picking a project fetches that
 * project's.
 *
 * The Prompt part (step 5) shows a draft of the next run's prompt in the run view's sections:
 * without a task, the run without one that the read above drafts; with a task picked (the agent's
 * tasks first, then its chats, then any task found), a second read with `issueId` and `kind`.
 * Values the launch fills in are marked, with why behind an "i". A 422 (no comment to wake on, not
 * a chat) is a note beside the picker.
 */

export function RunPreviewCard(props: { agent: AgentDetail; dirty?: boolean }) {
  const company = useCompany();
  const projects = useProjectsQuery();
  const choices = createMemo(() => (projects.data ? projectChoices(projects.data) : undefined));
  const [stored, setStored] = createSignal(readStoredProject(props.agent.id));
  createEffect(on(() => props.agent.id, (id) => setStored(readStoredProject(id)), { defer: true }));
  const projectId = createMemo(() => chosenProject(stored(), choices()));
  const choose = (id: string) => {
    const next = id || null;
    storeProject(props.agent.id, next);
    setStored(next);
  };

  const preview = createQuery(() => ({
    queryKey: runPreviewQueryKey(props.agent.id, { projectId: projectId() }),
    queryFn: ({ signal }) => agentsApi.runPreview(props.agent.id, { projectId: projectId() }, company().id, signal),
    // Switching projects keeps the last rows on screen (dimmed) until the new ones arrive.
    placeholderData: keepPreviousData,
    retry: false,
  }));
  const manifest = createMemo(() => previewManifest(preview.data));
  const supported = () => preview.data?.supported === true;
  const project = () => (preview.data?.supported ? preview.data.project : null);
  const blockers = createMemo(() => (preview.data?.supported ? blockerLines(preview.data.blockers) : []));
  const selectId = createUniqueId();

  return (
    <section class="card settings-card rp" aria-labelledby={`${selectId}-title`}>
      <header class="chead rp-head">
        <InfoHeading
          level={3}
          class="disp"
          id={`${selectId}-title`}
          info="What a sealed Claude run of this agent gets from Paperclip, worked out from its saved settings the way a launch does, without starting anything. Each run's own list is in its Input tab."
        >
          What runs get
        </InfoHeading>
        <Show when={preview.data?.supported !== false}>
          <label class="rp-for" for={selectId}>
            <span>For tasks in</span>
            <select id={selectId} class="input rp-select" value={projectId() ?? ""} onChange={(event) => choose(event.currentTarget.value)}>
              <option value="" selected={!projectId()}>
                No project
              </option>
              <For each={choices() ?? []}>
                {(choice) => (
                  <option value={choice.id} selected={choice.id === projectId()}>
                    {choice.name}
                  </option>
                )}
              </For>
              {/* The remembered project, while the list loads. */}
              <Show when={!choices() && projectId()}>
                {(id) => (
                  <option value={id()} selected>
                    …
                  </option>
                )}
              </Show>
            </select>
          </label>
        </Show>
      </header>

      <Show when={blockers().length > 0}>
        <div class="rp-blockers" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <b>A run would be refused before it starts</b>
            <For each={blockers()}>{(line) => <span>{line}</span>}</For>
          </div>
        </div>
      </Show>

      <Show when={props.dirty && supported()}>
        <p class="ps-list-note rp-note">These are the saved settings. Save to see your changes here.</p>
      </Show>

      <Show when={preview.isError && !preview.data}>
        <p class="ps-list-note" role="alert">
          Couldn't load what runs get. {failure(preview.error, "")}
        </p>
      </Show>
      <Show when={preview.isPending}>
        <p class="ps-list-note" role="status">
          Loading…
        </p>
      </Show>
      <Show when={preview.data && !preview.data.supported ? preview.data : null}>
        {(unsupported) => <p class="ps-list-note">{unsupportedText(unsupported().reason)}</p>}
      </Show>

      <Show when={manifest()}>
        {(got) => (
          <div class="rp-body" classList={{ "rp-body--stale": preview.isPlaceholderData }} aria-busy={preview.isFetching}>
            <ManifestList>
              <ManifestRow label="Engine" info="The CLI engine runs claude --print with only Paperclip's settings, read from this agent's own Claude config folder.">
                <Value value={engineValue(got())} />
              </ManifestRow>
              <ManifestRow label="Credential">{credentialValue(got().credential)}</ManifestRow>
              <SkillsRow manifest={got()} total />
              <McpServersRow servers={got().mcpServers} />
              <AccessRow access={got().access} />
              <GitHubRow github={got().github} />
              <Show when={project()}>
                {(chosen) => (
                  <ManifestRow label="Repository" info="Where a run on this project's tasks finds the repository's CLAUDE.md and skills: the project's primary workspace.">
                    <Value value={checkoutValue(chosen().checkout)} />
                  </ManifestRow>
                )}
              </Show>
              <Show when={taskWorktreeValue(project()?.checkout)}>
                {(worktree) => (
                  <ManifestRow
                    label="Task worktrees"
                    info="Each task gets its own git worktree of the repository, made on its first run. It holds only committed files, so CLAUDE.md and the repo skills are read from that commit. Their paths say <task branch>, the folder named after the task."
                  >
                    <Value value={worktree()} />
                  </ManifestRow>
                )}
              </Show>
              <ManifestRow label="CLAUDE.md">
                <Value value={claudeMdValue(got().claudeMd, project())} />
              </ManifestRow>
              <ManifestRow label="Repo skills">
                <Value value={repoSkillsValue(got().repoSkills, project())} />
              </ManifestRow>
              <ManifestRow label="Instructions" info="Sent at the start of each new session.">
                <Value value={instructionsValue(got().instructions)} />
              </ManifestRow>
              <ManifestRow label="Session">{SESSION_TEXT}</ManifestRow>
              <AutoMemoryRow />
              <OverriddenRow names={got().overriddenEnv} />
            </ManifestList>
          </div>
        )}
      </Show>

      <Show when={supported()}>
        <PromptPart agent={props.agent} noTaskPrompt={preview.data?.supported ? preview.data.prompt : null} />
      </Show>
    </section>
  );
}

/** How many tasks the picker's search finds, beside the agent's own. */
const SEARCH_LIMIT = 8;

/**
 * The Prompt part: the task and kind pickers, a 422's note beside them, and the draft. Without a
 * task the draft is the card's own read's (a run without a task); a picked task reads its own.
 */
function PromptPart(props: { agent: AgentDetail; noTaskPrompt: RunPromptPreview | null }) {
  const company = useCompany();
  const [task, setTask] = createSignal<PromptTask | null>(null);
  const [pickedKind, setPickedKind] = createSignal<RunPromptPreviewKind | null>(null);
  createEffect(on(() => props.agent.id, () => {
    setTask(null);
    setPickedKind(null);
  }, { defer: true }));
  const kind = () => effectivePromptKind(task(), pickedKind());

  const draft = createQuery(() => {
    const picked = task();
    const query = { issueId: picked?.id ?? null, kind: kind() };
    return {
      queryKey: runPreviewQueryKey(props.agent.id, query),
      queryFn: ({ signal }: { signal: AbortSignal }) => agentsApi.runPreview(props.agent.id, query, company().id, signal),
      enabled: Boolean(picked),
      placeholderData: keepPreviousData,
      retry: false,
    };
  });
  const prompt = (): RunPromptPreview | null => {
    if (!task()) return props.noTaskPrompt;
    if (draft.isError) return null;
    return draft.data?.supported ? draft.data.prompt : null;
  };
  const view = createMemo(() => {
    const current = prompt();
    return current ? promptPreviewView(current) : null;
  });
  const note = () => (task() && draft.isError ? promptNote(draft.error, task()) : null);
  const kindId = createUniqueId();
  const titleId = createUniqueId();

  return (
    <section class="rp-prompt" aria-labelledby={titleId}>
      <div class="rp-prompt-head">
        <InfoHeading
          level={4}
          class="disp rp-prompt-title"
          id={titleId}
          info="A draft of what the agent's next run would be sent on a new session, for the task and kind of wake you pick, from the same builder a run uses. Values marked “filled in at launch” are worked out when the run starts."
        >
          Prompt
        </InfoHeading>
        <div class="rp-prompt-pick">
          <TaskChoice agent={props.agent} task={task()} onPick={(next) => setTask(next)} />
          <label class="rp-for" for={kindId}>
            <span>Kind</span>
            <select
              id={kindId}
              class="input rp-select"
              value={kind()}
              disabled={!task()}
              onChange={(event) => setPickedKind(event.currentTarget.value as RunPromptPreviewKind)}
            >
              <For each={promptKinds(task())}>
                {(option) => (
                  <option value={option} selected={option === kind()}>
                    {PROMPT_KIND_LABEL[option]}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={note()}>
            {(text) => (
              <p class="rp-prompt-note" role="status">
                {text()}
              </p>
            )}
          </Show>
        </div>
      </div>
      <Show when={task() && draft.isError && !note()}>
        <p class="ps-list-note" role="alert">
          Couldn't draft the prompt. {failure(draft.error, "")}
        </p>
      </Show>
      <Show when={task() && draft.isPending && !draft.data}>
        <p class="ps-list-note" role="status">
          Drafting…
        </p>
      </Show>
      <Show when={view()}>
        {(shown) => (
          <div class="rp-prompt-body" classList={{ "rp-body--stale": Boolean(task()) && draft.isPlaceholderData }} aria-busy={draft.isFetching}>
            <PromptSections view={shown()} idPrefix="rp-prompt" headingLevel={5} renderPending={(why) => <PendingMark why={why} />} />
          </div>
        )}
      </Show>
    </section>
  );
}

/**
 * The task picker: "No task", the agent's open tasks, its chats with you, and, while searching,
 * other tasks the search finds. The lists load when it opens.
 */
function TaskChoice(props: { agent: AgentDetail; task: PromptTask | null; onPick: (task: PromptTask | null) => void }) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [term, setTerm] = createSignal("");
  createEffect(
    on(query, (value) => {
      const timer = window.setTimeout(() => setTerm(value.trim()), 200);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  const assigned = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "assigned-tasks"),
    queryFn: ({ signal }) => agentsApi.assignedTasks(company().id, props.agent.id, signal),
    enabled: open(),
  }));
  const chats = useChatListQuery();
  const found = createQuery(() => ({
    queryKey: queryKeys.issues.search(company().id, term(), SEARCH_LIMIT),
    queryFn: ({ signal }) => issuesApi.search(company().id, { q: term(), limit: SEARCH_LIMIT }, signal),
    enabled: open() && term().length > 0,
    placeholderData: keepPreviousData,
  }));
  const groups = createMemo(() =>
    promptTaskGroups({
      query: query(),
      assigned: assigned.data ?? [],
      chats: (chats.data ?? []).filter((chat) => chat.conversationAgentId === props.agent.id),
      found: term() ? found.data ?? [] : [],
    }),
  );
  const pick = (next: PromptTask | null) => {
    setOpen(false);
    setQuery("");
    props.onPick(next);
  };
  const loading = () => assigned.isPending || (term().length > 0 && found.isFetching);

  return (
    <div class="rp-for">
      <span>Task</span>
      <Popover open={open()} onOpenChange={setOpen}>
        <Popover.Trigger
          class="input rp-select rp-task"
          aria-label={`Task: ${promptTaskName(props.task)}. Change the task the prompt is drafted for`}
        >
          <span class="rp-task-name">{promptTaskName(props.task)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content label="Task for the prompt draft" width={420} hideClose>
          <div class="rp-picker">
            <TextInput
              type="search"
              aria-label="Find a task"
              placeholder="Find a task by title or ID"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              autofocus
            />
            <div class="rp-picker-list" role="listbox" aria-label="Task for the prompt draft">
              <button type="button" class="rp-option" role="option" aria-selected={!props.task} onClick={() => pick(null)}>
                <span class="rp-option-label">No task</span>
              </button>
              <For each={groups()}>
                {(group) => (
                  <div role="group" aria-label={group.label}>
                    <p class="rp-picker-group cap">{group.label}</p>
                    <For each={group.tasks}>
                      {(entry) => (
                        <button
                          type="button"
                          class="rp-option"
                          role="option"
                          aria-selected={props.task?.id === entry.id}
                          onClick={() => pick(entry)}
                        >
                          <Show when={entry.identifier}>
                            <span class="rp-option-id mono">{entry.identifier}</span>
                          </Show>
                          <span class="rp-option-label">{entry.title}</span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
              <Show when={groups().length === 0}>
                <p class="rp-picker-empty">{loading() ? "Loading…" : query().trim() ? "No tasks match." : "No open tasks or chats for this agent."}</p>
              </Show>
            </div>
          </div>
        </Popover.Content>
      </Popover>
    </div>
  );
}

/** Words, a path in Fragment Mono, or words then a path. */
function Value(props: { value: PreviewValue }) {
  return (
    <>
      {props.value.text}
      <Show when={props.value.path}>
        {(path) => (
          <>
            {props.value.text ? " " : ""}
            <MonoValue>{path()}</MonoValue>
          </>
        )}
      </Show>
    </>
  );
}
