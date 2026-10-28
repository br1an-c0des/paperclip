import type { AgentCommentaryEntry } from "@paperclipai/shared";
import { A, useSearchParams } from "@solidjs/router";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { ArrowUpRight, Lightbulb, MessageSquareWarning, Search } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { activityApi } from "@/api/activity";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { agoLabel } from "@/runs/run-model";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Markdown } from "@/ui/Markdown";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { COMMENTARY_PAGE_SIZE, commentaryFilters, pageRange, type CommentarySearch } from "./log-model";
import { PickMenu } from "./PickMenu";

/*
 * Commentary (`/:prefix/activity/commentary`): the suggestions and complaints agents send in while
 * they work (`GET /companies/:id/agent-commentary`), searchable, by agent and kind, 50 a page.
 * Opening one reads it in full (`/:id`) with links to its task and run; `?entry=` makes that a
 * link to share.
 */

type Kind = "all" | "suggestion" | "complaint";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "suggestion", label: "Suggestions" },
  { value: "complaint", label: "Complaints" },
];

function KindPill(props: { kind: AgentCommentaryEntry["kind"] }) {
  return (
    <TonePill tone={props.kind === "suggestion" ? "violet" : "amber"} compact icon={props.kind === "suggestion" ? <Lightbulb size={12} aria-hidden="true" /> : <MessageSquareWarning size={12} aria-hidden="true" />}>
      {props.kind === "suggestion" ? "Suggestion" : "Complaint"}
    </TonePill>
  );
}

export function Commentary() {
  const company = useCompany();
  const people = useTaskPeople();
  const [search, setSearch] = useSearchParams<CommentarySearch>();
  const filters = createMemo(() => commentaryFilters(search));
  const [draft, setDraft] = createSignal(search.q ?? "");

  // Search as you type, a beat after the last key.
  createEffect(() => {
    const value = draft();
    if (value === (search.q ?? "")) return;
    const timer = window.setTimeout(() => setSearch({ q: value || undefined, offset: undefined, entry: undefined }, { replace: true }), 250);
    onCleanup(() => window.clearTimeout(timer));
  });

  const list = createQuery(() => ({
    queryKey: queryKeys.activity.commentary(company().id, JSON.stringify(filters())),
    queryFn: ({ signal }) => activityApi.commentary(company().id, filters(), signal),
    placeholderData: keepPreviousData,
  }));

  const set = (patch: CommentarySearch) => setSearch({ ...patch, offset: undefined, entry: undefined }, { replace: true });
  const offset = () => filters().offset ?? 0;
  const items = () => list.data?.items ?? [];
  const hasFilters = () => Boolean(search.q || search.agentId || search.kind);

  return (
    <section class="act-section" aria-label="Commentary">
      <div class="act-toolbar">
        <label class="org-search act-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" placeholder="Search messages" aria-label="Search commentary" maxLength={200} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} />
        </label>
        <PickMenu
          label="Agent"
          allLabel="All agents"
          value={search.agentId}
          options={people.assignableAgents().map((agent) => ({ value: agent.id, label: agent.name, icon: <AgentAvatar agent={agent} size={20} /> }))}
          onPick={(value) => set({ agentId: value })}
        />
        <Segmented label="Kind" options={KINDS} value={(filters().kind ?? "all") as Kind} onChange={(value) => set({ kind: value === "all" ? undefined : value })} />
        <Show when={hasFilters()}>
          <Button size="compact" variant="quiet" onClick={() => { setDraft(""); set({ q: undefined, agentId: undefined, kind: undefined }); }}>
            Clear filters
          </Button>
        </Show>
      </div>

      <section class="card act-card">
        <Switch>
          <Match when={list.isPending}>
            <p class="org-empty">Loading commentary…</p>
          </Match>
          <Match when={list.isError}>
            <div class="org-empty">
              <p>Couldn't load the commentary. {list.error instanceof Error ? list.error.message : ""}</p>
              <Button size="compact" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          </Match>
          <Match when={items().length === 0}>
            <p class="org-empty">
              {offset() > 0
                ? "No messages on this page."
                : hasFilters()
                  ? "No messages match these filters."
                  : "No commentary yet. Suggestions and complaints show up here when agents send them."}
            </p>
          </Match>
        </Switch>
        <ul class="act-list act-comments">
          <For each={items()}>
            {(entry) => (
              <li>
                <button type="button" class="act-comment" onClick={() => setSearch({ entry: entry.id })} aria-label={`Read the ${entry.kind} from ${entry.agent.name}`}>
                  <span class="act-comment-who">
                    <AgentAvatar agent={{ id: entry.agent.id, name: entry.agent.name, appearance: people.agent(entry.agent.id)?.appearance }} size={24} />
                    <span class="org-strong org-ellipsis">{entry.agent.name}</span>
                  </span>
                  <span class="act-comment-kind">
                    <KindPill kind={entry.kind} />
                  </span>
                  <span class="act-comment-text">
                    <span class="act-comment-preview">
                      {entry.preview.trim()}
                      {entry.preview.length >= 280 ? "…" : ""}
                    </span>
                    <Show when={entry.task}>
                      {(task) => (
                        <span class="org-muted org-ellipsis">
                          <span class="mono">{task().identifier ?? "Task"}</span> · {task().title}
                        </span>
                      )}
                    </Show>
                  </span>
                  <time class="org-muted act-time" datetime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
                    {agoLabel(entry.createdAt)}
                  </time>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={list.data && list.data.total > COMMENTARY_PAGE_SIZE}>
          <div class="act-more act-pager">
            <span class="org-muted mono">{pageRange(offset(), items().length, list.data!.total)} messages</span>
            <Button size="compact" disabled={offset() === 0} onClick={() => setSearch({ offset: offset() - COMMENTARY_PAGE_SIZE > 0 ? String(offset() - COMMENTARY_PAGE_SIZE) : undefined }, { replace: true })}>
              Previous
            </Button>
            <Button size="compact" disabled={offset() + items().length >= list.data!.total} onClick={() => setSearch({ offset: String(offset() + COMMENTARY_PAGE_SIZE) }, { replace: true })}>
              Next
            </Button>
          </div>
        </Show>
      </section>

      <CommentaryEntry id={search.entry ?? null} onClose={() => setSearch({ entry: undefined }, { replace: true })} />
    </section>
  );
}

function CommentaryEntry(props: { id: string | null; onClose: () => void }) {
  const company = useCompany();
  const commands = useCommands();
  const people = useTaskPeople();
  const base = () => `/${company().issuePrefix}`;
  const entry = createQuery(() => ({
    queryKey: queryKeys.activity.commentaryEntry(company().id, props.id ?? ""),
    queryFn: ({ signal }) => activityApi.commentaryEntry(company().id, props.id!, signal),
    enabled: props.id !== null,
  }));
  const agentKey = (id: string) => people.agent(id)?.urlKey ?? id;
  return (
    <Dialog
      open={props.id !== null}
      onOpenChange={(open) => !open && props.onClose()}
      width={720}
      title={entry.data ? (entry.data.kind === "complaint" ? "Complaint" : "Suggestion") : "Commentary"}
      description={entry.data ? `Sent ${new Date(entry.data.createdAt).toLocaleString()}` : undefined}
    >
      <Switch>
        <Match when={entry.isPending}>
          <p class="org-muted">Loading the message…</p>
        </Match>
        <Match when={entry.isError}>
          <p class="org-muted" role="alert">
            Couldn't load the message. {entry.error instanceof Error ? entry.error.message : ""}
          </p>
        </Match>
        <Match when={entry.data}>
          {(data) => (
            <div class="act-entry">
              <div class="act-entry-head">
                <A class="act-comment-who act-who-link" href={`${base()}/agents/${agentKey(data().agent.id)}`}>
                  <AgentAvatar agent={{ id: data().agent.id, name: data().agent.name, appearance: people.agent(data().agent.id)?.appearance }} size={24} />
                  <span class="org-strong">{data().agent.name}</span>
                </A>
                <KindPill kind={data().kind} />
              </div>
              <div class="act-entry-body">
                <Markdown source={data().body} />
              </div>
              <div class="act-entry-links">
                <Show when={data().task}>
                  {(task) => (
                    <A class="org-link" href={`${base()}/issues/${task().identifier ?? task().id}`}>
                      <span class="mono">{task().identifier ?? "The task"}</span> <ArrowUpRight size={13} aria-hidden="true" />
                    </A>
                  )}
                </Show>
                <button
                  type="button"
                  class="act-linkish"
                  onClick={() => {
                    const runId = data().runId;
                    props.onClose();
                    commands.openRunModal(runId);
                  }}
                >
                  View run
                </button>
              </div>
            </div>
          )}
        </Match>
      </Switch>
    </Dialog>
  );
}
