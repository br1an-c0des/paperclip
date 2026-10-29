import type { Issue } from "@paperclipai/shared";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, Show, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { useTaskPeople, type TaskPeople } from "../people";
import { activeMention, insertMention, matchesQuery, type ActiveMention, type MentionTarget } from "./mentions";
import "./Composer.css";

/*
 * The composer's @-mentions (mentions.ts) for other fields: typing "@" and a name lists agents,
 * people and tasks, and picking one writes the mention link. MentionTextArea is a plain Markdown
 * text area with them (New task's description, `tasks/create`); the document editor uses the
 * candidates and the list with CodeMirror (src/documents/MarkdownEditor.tsx). The composer keeps its
 * own copy of the picker, wired into its sending.
 */

/** Who and what an "@query" can mention: up to five agents, four people and five tasks. */
export function useMentionCandidates(mention: () => ActiveMention | null, excludeTaskId?: () => string | undefined) {
  const company = useCompany();
  const people = useTaskPeople();
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
  const tasks = createQuery(() => ({
    queryKey: queryKeys.issues.search(company().id, term(), 5),
    queryFn: ({ signal }) => issuesApi.search(company().id, { q: term(), limit: 5 }, signal),
    enabled: !!mention() && term().length > 0,
    placeholderData: keepPreviousData,
  }));
  // Read through an effect, which never suspends: a memo reading `tasks.data` would put the nearest
  // <Suspense> (TaskFiles' document view) back on its fallback while a search loads, and the editor
  // would lose focus mid-word.
  const [matches, setMatches] = createSignal<Issue[]>([]);
  createEffect(() => setMatches(tasks.data ?? []));
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
    const found = at.query
      ? matches()
          .filter((issue) => issue.identifier && issue.id !== excludeTaskId?.())
          .map((issue): MentionTarget => ({ kind: "task", id: issue.id, identifier: issue.identifier!, title: issue.title }))
      : [];
    return [...agents, ...users, ...found];
  });
  return { candidates, people };
}

/** The list of mention candidates, grouped by kind, with the highlighted one marked. */
export function MentionList(props: {
  id: string;
  candidates: MentionTarget[];
  index: number;
  people: TaskPeople;
  onPick: (target: MentionTarget) => void;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  return (
    <div class={`cmp-picker ${props.class ?? ""}`} style={props.style} role="listbox" id={props.id} aria-label="Mention">
      <For each={props.candidates}>
        {(candidate, at) => (
          <>
            <Show when={at() === 0 || props.candidates[at() - 1]!.kind !== candidate.kind}>
              <div class="mh" aria-hidden="true">
                {candidate.kind === "agent" ? "Agents" : candidate.kind === "user" ? "People" : "Tasks"}
              </div>
            </Show>
            <div
              id={`${props.id}-opt-${at()}`}
              class="cmp-option"
              role="option"
              aria-selected={at() === props.index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onPick(candidate)}
            >
              <MentionOption candidate={candidate} people={props.people} />
            </div>
          </>
        )}
      </For>
    </div>
  );
}

export function MentionTextArea(props: {
  value: string;
  onInput: (value: string) => void;
  id?: string;
  class?: string;
  rows?: number;
  placeholder?: string;
  /** Leave this task out of the task matches, such as the task being edited. */
  excludeTaskId?: string;
  /** Draw the list under the field instead of above it. */
  below?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  "aria-label"?: string;
}) {
  const listId = createUniqueId();
  let field: HTMLTextAreaElement | undefined;
  const [caret, setCaret] = createSignal(0);
  const [closedAt, setClosedAt] = createSignal<number | null>(null);
  const [index, setIndex] = createSignal(0);

  const mention = createMemo<ActiveMention | null>(() => {
    const found = activeMention(props.value, caret());
    return found && found.start !== closedAt() ? found : null;
  });
  const { candidates, people } = useMentionCandidates(mention, () => props.excludeTaskId);
  createEffect(on(() => mention()?.start, () => setIndex(0)));
  const open = () => !!mention() && candidates().length > 0;

  const sync = () => field && setCaret(field.selectionStart ?? 0);
  const pick = (target: MentionTarget) => {
    const at = mention();
    if (!at) return;
    const result = insertMention(props.value, at, target);
    props.onInput(result.text);
    queueMicrotask(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(result.caret, result.caret);
      setCaret(result.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (open()) {
      const count = candidates().length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
        event.preventDefault();
        pick(candidates()[index()]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setClosedAt(mention()!.start);
        return;
      }
    }
    props.onKeyDown?.(event);
  };

  return (
    <div class="cmp-field">
      <Show when={open()}>
        <MentionList id={listId} candidates={candidates()} index={index()} people={people} onPick={pick} class={props.below ? "cmp-picker--below" : ""} />
      </Show>
      <textarea
        id={props.id}
        ref={field}
        class={props.class}
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props["aria-label"]}
        role="combobox"
        aria-expanded={open()}
        aria-controls={open() ? listId : undefined}
        aria-activedescendant={open() ? `${listId}-opt-${index()}` : undefined}
        aria-autocomplete="list"
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          sync();
          setClosedAt(null);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={sync}
        onClick={sync}
        onBlur={() => setClosedAt(mention()?.start ?? null)}
        onFocus={() => setClosedAt(null)}
      />
    </div>
  );
}

/** One entry in the mention list: an agent's avatar, a person's disc, or a task's ID and title. */
export function MentionOption(props: { candidate: MentionTarget; people: TaskPeople }) {
  const candidate = props.candidate;
  if (candidate.kind === "agent") {
    const agent = props.people.agent(candidate.id);
    return (
      <>
        <Show when={agent} fallback={<InitialsDisc name={candidate.name} seed={candidate.id} size={20} />}>
          {(found) => <AgentAvatar agent={found()} size={24} />}
        </Show>
        <span class="cmp-option-label">{candidate.name}</span>
      </>
    );
  }
  if (candidate.kind === "user") {
    return (
      <>
        <InitialsDisc name={candidate.name} seed={candidate.id} size={20} />
        <span class="cmp-option-label">{candidate.name}</span>
      </>
    );
  }
  return (
    <>
      <span class="mono cmp-option-id">{candidate.identifier}</span>
      <span class="cmp-option-label">{candidate.title}</span>
    </>
  );
}
