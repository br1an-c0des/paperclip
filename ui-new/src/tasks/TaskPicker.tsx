import type { Issue } from "@paperclipai/shared";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { Check } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { TextInput } from "@/ui/Field";
import { StatusCapsule } from "@/ui/Status";

/*
 * Finds tasks by title or identifier, for the new-task dialog's Parent task and Blocked by fields.
 * Results come from the task search (`GET /companies/:id/issues?q=`), a few at a time.
 */

const LIMIT = 8;

export function taskName(issue: Pick<Issue, "id" | "identifier" | "title">) {
  return issue.identifier ?? issue.title;
}

export function TaskPicker(props: {
  label: string;
  selected: readonly string[];
  onPick: (issue: Issue) => void;
  /** Leave this task out, such as the parent itself. */
  excludeId?: string | null;
}) {
  const company = useCompany();
  const [query, setQuery] = createSignal("");
  const [term, setTerm] = createSignal("");
  createEffect(
    on(query, (value) => {
      const timer = window.setTimeout(() => setTerm(value.trim()), 200);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  const results = createQuery(() => ({
    queryKey: queryKeys.issues.search(company().id, term(), LIMIT),
    queryFn: ({ signal }) => issuesApi.search(company().id, { q: term() || undefined, limit: LIMIT }, signal),
    placeholderData: keepPreviousData,
  }));
  const issues = () => (results.data ?? []).filter((issue) => issue.id !== props.excludeId);

  return (
    <div class="nt-picker">
      <TextInput
        type="search"
        aria-label={props.label}
        placeholder="Find a task by title or ID"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        autofocus
      />
      <div class="nt-picker-list" role="listbox" aria-label={props.label} aria-multiselectable={props.selected.length > 1 || undefined}>
        <For
          each={issues()}
          fallback={<p class="nt-picker-empty">{results.isFetching ? "Searching…" : "No tasks match."}</p>}
        >
          {(issue) => {
            const on = () => props.selected.includes(issue.id);
            return (
              <button type="button" class="nt-option" role="option" aria-selected={on()} onClick={() => props.onPick(issue)}>
                <StatusCapsule status={issue.status} size="row" />
                <span class="nt-option-id mono">{issue.identifier}</span>
                <span class="nt-option-label">{issue.title}</span>
                <Show when={on()}>
                  <Check size={14} aria-hidden="true" class="nt-option-check" />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
