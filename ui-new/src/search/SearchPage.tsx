import type { Agent, CompanySearchResponse, CompanySearchResult, CompanySearchScope } from "@paperclipai/shared";
import { useLocation, useNavigate } from "@solidjs/router";
import { createInfiniteQuery, keepPreviousData } from "@tanstack/solid-query";
import { Clock, Plus, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, untrack } from "solid-js";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET, searchApi, searchQueryString, type SearchRequest } from "@/api/search";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useLabelsQuery, useProjectsQuery } from "@/lib/company-data";
import { hasOpenDialog, isTextInputTarget } from "@/lib/shortcuts";
import { useChatIndex } from "@/chat/chat-index";
import { useTaskPeople, type TaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import {
  EMPTY_FILTERS,
  filterChips,
  filterCount,
  filterRequest,
  hasFilters,
  loosenOptions,
  mergeFilters,
  resultsLabel,
  toggleFilter,
  clearDimension,
  type FilterDimension,
  type FilterNames,
  type SearchFilters,
} from "./filters";
import { parseQuery, stripFilters, type ParserContext } from "./query-parser";
import { loadRecent, pushRecent } from "./recent";
import { chatResultHref, enterTarget, groupResults, kindOfScope, resultIssueId, resultTask, scopeTabs, shownResults, type ResultSection } from "./results-model";
import { FacetColumn, FilterChips, FilterMenu, SortMenu, TypedFiltersTip } from "./SearchControls";
import { SearchRow } from "./SearchRow";
import { readSearchState, searchPath, type SearchState } from "./search-url";
import "./Search.css";

/*
 * `/:prefix/search` (boards S1–S3; the phone's M14): one search over tasks, comments, docs, files,
 * agents and projects. Everything the page shows is in its URL (search-url.ts), so links and Back
 * work; typing replaces the entry, while picking a kind, a filter or a sort adds one.
 *
 * - All groups the results by kind, each with "All n" leading to that kind's view (S1). A kind's
 *   view lists its results, 25 at a time.
 * - Filters come from the Filter menu, the "Narrow tasks" column or typed tokens (S2). Changing
 *   them with the controls folds the typed ones into the URL.
 * - With nothing found, the response's `zeroResults` offers filters to drop (S3).
 * - A task, a comment or document on a task, or a file opens its task in the task modal, as on
 *   other pages without a task list; agents and projects go to their pages. Results from your
 *   chats with agents show as chats and open the chat (decision 8), with the document open when the
 *   result was found in one.
 * - Keys: `/` focuses the box, ↓ moves into the results and ↑/↓ through them, Enter opens (from the
 *   box: the task whose ID was typed, or the first result), Escape clears the box.
 *
 * One request per search, debounced; the server allows 60 a minute. A kind's view reads All's counts
 * for the other tabs from the cache, when All was searched first, rather than asking again.
 */

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

export function SearchPage() {
  const company = useCompany();
  const commands = useCommands();
  const location = useLocation();
  const navigate = useNavigate();
  const people = useTaskPeople();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const labels = useLabelsQuery();
  const chats = useChatIndex();
  /** The agent, when a result is in one of your chats. */
  const chatAgent = (result: CompanySearchResult) => people.agent(chats.agentIdFor(resultIssueId(result)));

  const state = createMemo(() => readSearchState(location.search));

  // The box holds what's typed; the URL catches up after a pause.
  const [draft, setDraft] = createSignal(untrack(() => state().q));
  let committed = untrack(() => state().q);
  createEffect(
    on(
      () => state().q,
      (q) => {
        if (q !== committed) {
          committed = q;
          setDraft(q);
        }
      },
      { defer: true },
    ),
  );

  const go = (next: Partial<SearchState>, replace = false) => {
    const target = { ...state(), q: draft(), ...next };
    committed = target.q;
    if (target.q !== draft()) setDraft(target.q);
    navigate(searchPath(company().issuePrefix, target), { replace, scroll: false });
  };
  createEffect(
    on(
      draft,
      (value) => {
        if (value === state().q) return;
        const timer = window.setTimeout(() => go({ q: value }, true), DEBOUNCE_MS);
        onCleanup(() => window.clearTimeout(timer));
      },
      { defer: true },
    ),
  );

  const parserContext = createMemo<ParserContext>(() => ({
    youId: people.youId(),
    agents: agents.data,
    projects: projects.data,
    labels: labels.data,
  }));
  const parsed = createMemo(() => parseQuery(state().q, parserContext()));
  const filters = createMemo(() => mergeFilters(state().filters, parsed().filters));
  const text = () => parsed().text.trim();
  const searching = () => text().length > 0 || hasFilters(filters());
  const filterable = () => state().scope !== "agents" && state().scope !== "projects";

  const names = createMemo<FilterNames>(() => ({
    agent: (id) => people.agent(id)?.name,
    person: (id) => people.personName(id),
    project: (id) => projects.data?.find((project) => project.id === id)?.name,
    label: (id) => labels.data?.find((label) => label.id === id)?.name,
    youId: people.youId(),
  }));

  const request = (scope: CompanySearchScope): SearchRequest => ({
    q: text(),
    scope,
    sort: state().sort,
    limit: scope === "all" ? SEARCH_MAX_LIMIT : PAGE_SIZE,
    ...filterRequest(filters()),
  });
  const searchQuery = (scope: () => CompanySearchScope, enabled: () => boolean, keepPrevious: boolean) =>
    createInfiniteQuery(() => {
      const current = request(scope());
      const limit = current.limit ?? PAGE_SIZE;
      return {
        queryKey: queryKeys.search.results(company().id, searchQueryString(current)),
        queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
          searchApi.search(company().id, { ...current, offset: pageParam }, signal),
        initialPageParam: 0,
        getNextPageParam: (last: CompanySearchResponse, pages: CompanySearchResponse[]) => {
          const offset = pages.length * limit;
          return last.hasMore && offset <= SEARCH_MAX_OFFSET ? offset : undefined;
        },
        enabled: enabled(),
        placeholderData: keepPrevious ? keepPreviousData : undefined,
      };
    });
  const results = searchQuery(() => state().scope, searching, true);
  // All's counts, for the tabs while a kind's view is open: read from the cache, never fetched here.
  const allCounts = searchQuery(() => "all", () => false, false);

  const first = () => (searching() ? results.data?.pages[0] : undefined);
  const flat = createMemo(() => {
    if (!searching()) return [];
    const seen = new Set<string>();
    return (results.data?.pages ?? [])
      .flatMap((page) => page.results)
      .filter((result) => {
        const key = `${result.type}:${result.id}:${result.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
  const sections = createMemo(() => groupResults(flat(), first()?.countsByType ?? {}, state().scope));
  const tabs = createMemo(() => {
    const scope = state().scope;
    const all = scope === "all" ? first() : allCounts.data?.pages[0];
    const own = scope === "all" ? undefined : first();
    return scopeTabs(all?.countsByType ?? null, own ? { scope, counts: own.countsByType } : undefined, hasFilters(filters()));
  });
  const settled = () => searching() && !!results.data && !results.isPlaceholderData;
  const empty = () => settled() && flat().length === 0;
  const loosen = createMemo(() => {
    const zero = first()?.zeroResults;
    return zero && empty() ? loosenOptions(zero, filters(), names()) : [];
  });

  // Recent searches: kept once a query has answered.
  const [recent, setRecent] = createSignal(loadRecent(untrack(() => company().id)));
  createEffect(
    on(
      () => (settled() && flat().length > 0 ? state().q.trim() : ""),
      (q) => {
        if (q) setRecent(pushRecent(company().id, q));
      },
    ),
  );

  const changeFilters = (next: SearchFilters) => go({ filters: next, q: stripFilters(draft(), parserContext()) });
  const toggle = (dimension: FilterDimension, value: string) => changeFilters(toggleFilter(filters(), dimension, value));
  const removeFilter = (dimension: FilterDimension) =>
    go({ filters: clearDimension(filters(), dimension), q: stripFilters(draft(), parserContext()) });
  const clearFilters = () => changeFilters(EMPTY_FILTERS);
  const pickScope = (scope: CompanySearchScope) => {
    if (scope !== state().scope) go({ scope });
  };

  const open = (result: CompanySearchResult) => {
    const agent = chatAgent(result);
    if (agent) return navigate(chatResultHref(company().issuePrefix, agent.urlKey, result));
    const task = resultTask(result);
    if (task) commands.openTaskModal(task);
    else navigate(result.href);
  };

  let input!: HTMLInputElement;
  let list: HTMLDivElement | undefined;
  const rows = () => [...(list?.querySelectorAll<HTMLAnchorElement>("[data-result-row]") ?? [])];

  // Enter from the box opens a result once the results are for what's typed.
  const [enterPending, setEnterPending] = createSignal(false);
  const openFromBox = () => {
    const target = enterTarget(shownResults(sections()), text());
    if (target) open(target);
  };
  createEffect(() => {
    if (!enterPending() || draft() !== state().q) return;
    if (results.isError) return setEnterPending(false);
    if (!settled() || results.isFetching) return;
    setEnterPending(false);
    untrack(openFromBox);
  });

  const onBoxKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      const row = rows()[0];
      if (!row) return;
      event.preventDefault();
      row.focus();
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (draft() !== state().q) go({ q: draft() }, true);
      setEnterPending(true);
    } else if (event.key === "Escape" && draft()) {
      event.preventDefault();
      go({ q: "" }, true);
    }
  };
  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = rows();
    const index = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    event.preventDefault();
    const next = index + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) input.focus();
    else all[Math.min(next, all.length - 1)]?.focus();
  };

  // `/` lands in the box here; elsewhere it opens the palette (lib/shortcuts.ts). This listener runs
  // first, in the capture phase, and the global one skips a key that's already handled.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextInputTarget(event.target) || hasOpenDialog()) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
    input.focus();
  });

  const counts = () => first()?.filterOptionCounts;
  const scopeLabel = () => kindOfScope(state().scope)?.label.toLowerCase() ?? "everything";

  return (
    <div class="sx">
      <header class="card sx-head">
        <div role="search" class="sx-box">
          <Search size={20} aria-hidden="true" />
          <label for="sx-q" class="sr-only">
            Search everything
          </label>
          <input
            ref={input}
            id="sx-q"
            class="sx-input disp"
            type="text"
            value={draft()}
            placeholder="Search tasks, comments, docs, agents and projects"
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onBoxKeyDown}
          />
          <Show when={draft()}>
            <button
              type="button"
              class="sx-clear"
              aria-label="Clear search"
              onClick={() => {
                go({ q: "" }, true);
                input.focus();
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </Show>
        </div>
        <div class="sx-scope-row">
          <nav class="sx-scopes" aria-label="Search in">
            <For each={tabs()}>
              {(tab) => (
                <button type="button" aria-pressed={tab.scope === state().scope} onClick={() => pickScope(tab.scope)}>
                  {tab.label}
                  <Show when={tab.count !== null && searching()}>
                    <small>{tab.count}</small>
                  </Show>
                </button>
              )}
            </For>
          </nav>
          <span class="sx-in">In {company().name}</span>
        </div>
      </header>

      <Show when={searching()} fallback={<SearchIdle recent={recent()} onPick={(q) => go({ q })} prefix={company().issuePrefix} />}>
        <div class="sx-grid" classList={{ "sx-grid--facets": filterable() }}>
          <div class="sx-col">
            <div class="sx-tools">
              <Show when={filterable()}>
                <FilterChips chips={filterChips(filters(), names())} onRemove={removeFilter} />
                <FilterMenu
                  filters={filters()}
                  counts={counts()}
                  people={people}
                  projects={openProjects(projects.data)}
                  labels={[...(labels.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
                  onToggle={toggle}
                />
                <TypedFiltersTip />
              </Show>
              <Show when={results.isFetching}>
                <span class="sx-busy" aria-live="polite">
                  Searching…
                </span>
              </Show>
              <SortMenu sort={state().sort} onChange={(sort) => go({ sort })} />
            </div>

            <Switch>
              <Match when={results.isError && !results.data}>
                <section class="card sx-note">
                  <h2 class="disp">Couldn't search</h2>
                  <p>{(results.error as Error)?.message}</p>
                  <div class="sx-note-actions">
                    <Button size="compact" onClick={() => void results.refetch()}>
                      Try again
                    </Button>
                  </div>
                </section>
              </Match>
              <Match when={!results.data}>
                <section class="card sx-note" aria-busy="true">
                  <p class="muted">Searching for “{text() || "filtered tasks"}”…</p>
                </section>
              </Match>
              <Match when={empty()}>
                <NoResults
                  query={text()}
                  scope={state().scope}
                  scopeLabel={scopeLabel()}
                  filtered={hasFilters(filters())}
                  filterTotal={filterCount(filters())}
                  unfiltered={first()?.zeroResults?.unfilteredTotal ?? 0}
                  loosen={loosen()}
                  onLoosen={(dimension) => (dimension ? removeFilter(dimension) : clearFilters())}
                  onAllKinds={() => pickScope("all")}
                  onNewTask={() => commands.openNewTask({ title: text() })}
                />
              </Match>
              <Match when={true}>
                <div ref={list} class="sx-sections" onKeyDown={onListKeyDown}>
                  <For each={sections()}>
                    {(section) => (
                      <ResultGroup
                        section={section}
                        all={state().scope === "all"}
                        people={people}
                        projectName={(id) => (id ? names().project(id) : undefined)}
                        onOpen={open}
                        chatAgent={chatAgent}
                        onAll={() => pickScope(section.scope)}
                      />
                    )}
                  </For>
                  <Show when={results.hasNextPage}>
                    <div class="sx-more">
                      <Button size="compact" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                        {results.isFetchingNextPage ? "Loading…" : "Show more"}
                      </Button>
                    </div>
                  </Show>
                  <Show when={!results.hasNextPage && first()?.hasMore}>
                    <p class="sx-cap muted">Showing the first {flat().length}. Add words or filters to find the rest.</p>
                  </Show>
                </div>
              </Match>
            </Switch>
          </div>

          <Show when={filterable()}>
            <FacetColumn
              filters={filters()}
              counts={counts()}
              names={names()}
              people={people}
              projects={projects.data ?? []}
              labels={labels.data ?? []}
              hasFilters={hasFilters(filters())}
              onToggle={toggle}
              onClear={clearFilters}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ResultGroup(props: {
  section: ResultSection;
  all: boolean;
  people: TaskPeople;
  projectName: (id: string | null) => string | undefined;
  onOpen: (result: CompanySearchResult) => void;
  chatAgent: (result: CompanySearchResult) => Agent | undefined;
  onAll: () => void;
}) {
  const company = useCompany();
  return (
    <section class="card sx-section" aria-label={props.section.label}>
      <div class="sx-section-head">
        <h2 class="disp">{props.section.label}</h2>
        <span class="sx-section-n">{props.section.count}</span>
        <Show when={props.all && props.section.more}>
          <Button ghost size="compact" class="sx-all" onClick={props.onAll}>
            All {props.section.count}
          </Button>
        </Show>
      </div>
      <Show
        when={props.section.results.length > 0}
        fallback={<p class="sx-section-note muted">{sectionNote(props.section)}</p>}
      >
        <For each={props.section.results}>
          {(result) => (
            <SearchRow
              result={result}
              kind={props.section.kind}
              people={props.people}
              projectName={props.projectName}
              onOpen={props.onOpen}
              chatAgent={props.chatAgent(result)}
              chatHref={props.chatAgent(result) ? chatResultHref(company().issuePrefix, props.chatAgent(result)!.urlKey, result) : undefined}
            />
          )}
        </For>
      </Show>
    </section>
  );
}

/**
 * For a section of All whose matches didn't make the page: mostly tasks found through a comment or
 * a document that also match by title, which the Tasks section shows.
 */
function sectionNote(section: ResultSection) {
  const one = section.count === 1;
  const tasks = one ? "1 task matches" : `${section.count} tasks match`;
  const them = one ? "it" : "them";
  if (section.kind === "comment") return `${tasks} in ${one ? "its" : "their"} comments. Open Comments to see ${them}.`;
  if (section.kind === "document") return `${tasks} in ${one ? "its" : "their"} documents. Open Docs to see ${them}.`;
  return `Open ${section.label} to see ${them}.`;
}

function NoResults(props: {
  query: string;
  scope: CompanySearchScope;
  scopeLabel: string;
  filtered: boolean;
  filterTotal: number;
  /** How many the query finds without filters, from `zeroResults`. */
  unfiltered: number;
  loosen: ReturnType<typeof loosenOptions>;
  onLoosen: (dimension: FilterDimension | null) => void;
  onAllKinds: () => void;
  onNewTask: () => void;
}) {
  const quoted = () => (props.query ? `“${props.query}”` : "these filters");
  return (
    <section class="card sx-empty" aria-labelledby="sx-empty-h">
      <Switch>
        <Match when={props.filtered}>
          <h2 id="sx-empty-h" class="disp">
            No {props.scope === "all" ? "results" : props.scopeLabel} match {props.filterTotal === 1 ? "this filter" : "these filters"}
          </h2>
          <p>
            <Show when={props.unfiltered > 0} fallback={`Nothing matches ${quoted()} even without filters.`}>
              {resultsLabel(props.unfiltered)} match {quoted()} without {props.filterTotal === 1 ? "it" : "them"}.
            </Show>
          </p>
        </Match>
        <Match when={true}>
          <h2 id="sx-empty-h" class="disp">
            Nothing matches {quoted()}
          </h2>
          <p>
            {props.scope === "all" ? "Try fewer words, or a single distinctive one." : `No ${props.scopeLabel} match it. Other kinds may.`}
          </p>
        </Match>
      </Switch>
      <div class="sx-ways">
        <For each={props.loosen}>
          {(option) => (
            <button type="button" class="sx-way" onClick={() => props.onLoosen(option.dimension)}>
              <X size={15} aria-hidden="true" />
              {option.label}
              <span class="muted">{resultsLabel(option.count)}</span>
            </button>
          )}
        </For>
        <Show when={props.scope !== "all"}>
          <button type="button" class="sx-way" onClick={props.onAllKinds}>
            <Search size={15} aria-hidden="true" />
            Search all kinds
          </button>
        </Show>
        <Show when={!props.filtered && props.query}>
          <button type="button" class="sx-way" onClick={props.onNewTask}>
            <Plus size={15} aria-hidden="true" />
            New task “{props.query}”
          </button>
        </Show>
      </div>
    </section>
  );
}

/** Before anything is typed: recent searches and what's searched (phone board M14's "recent"). */
function SearchIdle(props: { recent: string[]; onPick: (q: string) => void; prefix: string }) {
  return (
    <section class="card sx-idle" aria-label="Search tips">
      <Show when={props.recent.length > 0}>
        <h2 class="lbl">Recent searches</h2>
        <div class="sx-recent">
          <For each={props.recent}>
            {(entry) => (
              <button type="button" class="sx-way" onClick={() => props.onPick(entry)}>
                <Clock size={15} aria-hidden="true" />
                {entry}
              </button>
            )}
          </For>
        </div>
      </Show>
      <h2 class="lbl">What's searched</h2>
      <ul class="sx-tips">
        <li>Task titles, descriptions, comments and documents; files; agents; projects.</li>
        <li>
          A task ID such as <code class="mono">{props.prefix}-12</code> and Enter opens that task.
        </li>
        <li>
          Filters can be typed: <code class="mono">status:blocked</code>, <code class="mono">assignee:me</code>,{" "}
          <code class="mono">is:open</code>, <code class="mono">updated:7d</code>.
        </li>
        <li>Quotes match a phrase exactly.</li>
      </ul>
    </section>
  );
}
