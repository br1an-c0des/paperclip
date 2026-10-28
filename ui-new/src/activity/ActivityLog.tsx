import { A, useSearchParams } from "@solidjs/router";
import { createInfiniteQuery } from "@tanstack/solid-query";
import { ArrowRightLeft, BadgeCheck, Download, Pause, Play, UserPlus, type LucideProps } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch as Branch, type JSX } from "solid-js";
import { activityApi, type AuditRecord } from "@/api/activity";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { useChatIndex } from "@/chat/chat-index";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { clockTime, dayLabel } from "@/runs/run-model";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { activityLine, type ActivityLine } from "./activity-line";
import {
  ACTION_DOMAINS,
  ACTOR_KINDS,
  actorAgentId,
  clearedSearch,
  ENTITY_TYPES,
  filtersKey,
  hasFilters,
  LOG_PAGE_SIZE,
  logFilters,
  needsFullTier,
  type LogSearch,
} from "./log-model";
import { PickMenu } from "./PickMenu";

/*
 * The activity log (`/:prefix/activity`): everything recorded in the organization, newest first,
 * 50 at a time (the audit feed, `GET /companies/:id/audit/agent-actions`, `actorScope=all`).
 *
 * Filters, all in the address: who acted (people, agents, Paperclip, plugins, or one agent), what
 * kind of action, what it's about (and a case's id when cases are on), and a range of days. Readers
 * with the audit permission ("full" tier) also see who an agent acted for and the run behind each
 * entry, can narrow to one agent or person, and can export the filtered log as CSV.
 *
 * Lines are worded by the shared formatter (activity-line.ts); reads and housekeeping are hidden
 * unless "Reads and housekeeping" is on. Entries link to their task, agent, project, recurring task
 * or skill, and your chats link to the chat. "View run" opens the run modal.
 */

const ICON: Record<ActivityLine["tone"], (props: LucideProps) => JSX.Element> = {
  run: Play,
  green: BadgeCheck,
  amber: UserPlus,
  gray: ArrowRightLeft,
};

export function ActivityLog() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const commands = useCommands();
  const people = useTaskPeople();
  const chats = useChatIndex();
  const settings = useExperimentalSettingsQuery();
  const [search, setSearch] = useSearchParams<LogSearch>();
  const filters = createMemo(() => logFilters(search));
  const showAll = () => search.all === "1";

  const feed = createInfiniteQuery(() => ({
    queryKey: queryKeys.activity.log(company().id, filtersKey(filters())),
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      activityApi.log(company().id, filters(), { cursor: pageParam, limit: LOG_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    retry: (count: number, error: Error) => !(error instanceof ApiError && error.status === 403) && count < 2,
  }));

  const pages = () => feed.data?.pages ?? [];
  /** The least access any loaded page was answered with: access can be taken away between pages. */
  const tier = createMemo(() => (pages().some((page) => page.accessTier === "basic") ? "basic" : pages()[0]?.accessTier));
  const full = () => tier() === "full";
  const denied = () => feed.error instanceof ApiError && feed.error.status === 403;

  // An old `/audit` link opens agents' actions; without the permission, show everyone's activity instead.
  createEffect(() => {
    if (denied() && search.mode === "agents") setSearch({ mode: undefined }, { replace: true });
  });

  const names = createMemo(() => ({
    agent: (id: string) => people.agent(id),
    person: people.personName,
    youId: people.youId(),
    chatAgent: chats.agentIdFor,
  }));
  const records = createMemo<AuditRecord[]>(() => pages().flatMap((page) => page.items));
  const lines = createMemo(() => records().flatMap((record) => activityLine(record, names(), { keepQuiet: showAll() || Boolean(search.action) }) ?? []));
  const hidden = () => records().length - lines().length;
  const days = createMemo(() => {
    const groups: { day: string; lines: ActivityLine[] }[] = [];
    for (const line of lines()) {
      const day = dayLabel(line.at);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.lines.push(line);
      else groups.push({ day, lines: [line] });
    }
    return groups;
  });

  const set = (patch: Partial<LogSearch>) => setSearch(patch, { replace: true });
  const casesOn = () => settings.data?.enableCases === true || search.entityType === "case";
  const agentOptions = createMemo(() =>
    people.assignableAgents().map((agent) => ({ value: agent.id, label: agent.name, icon: <AgentAvatar agent={agent} size={20} /> })),
  );
  const actorValue = () => actorAgentId(search) ?? search.actor;
  const [caseDraft, setCaseDraft] = createSignal("");
  createEffect(() => setCaseDraft(search.entityId ?? ""));

  const [exporting, setExporting] = createSignal(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await activityApi.exportCsv(company().id, filters());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-${company().issuePrefix.toLowerCase()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      pushToast({ tone: "success", title: "Exporting the activity log", body: "The CSV download has started." });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't export the activity log", body: error instanceof Error ? error.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section class="act-section" aria-label="Activity log">
      <div class="act-toolbar">
        <PickMenu
          label="Who"
          allLabel="Everyone"
          value={actorValue()}
          options={ACTOR_KINDS}
          groups={full() ? [{ label: "One agent", options: agentOptions() }] : []}
          onPick={(value) => set({ actor: value, agentId: undefined })}
        />
        <PickMenu label="Action" allLabel="All actions" value={search.action} options={ACTION_DOMAINS} onPick={(value) => set({ action: value })} />
        <PickMenu
          label="About"
          allLabel="Anything"
          value={search.entityType}
          options={ENTITY_TYPES.filter((entry) => !entry.cases || casesOn())}
          onPick={(value) => set({ entityType: value, entityId: undefined })}
        />
        <Show when={search.entityType === "case"}>
          <TextInput
            class="act-case"
            type="search"
            aria-label="Case ID or identifier"
            placeholder="CAS-C1"
            value={caseDraft()}
            onInput={(event) => {
              setCaseDraft(event.currentTarget.value);
              if (!event.currentTarget.value) set({ entityId: undefined });
            }}
            onBlur={() => set({ entityId: caseDraft().trim() || undefined })}
            onKeyDown={(event) => {
              if (event.key === "Enter") set({ entityId: caseDraft().trim() || undefined });
            }}
          />
        </Show>
        <Show when={full() && people.otherPeople().length > 0}>
          <PickMenu
            label="For"
            allLabel="Anyone"
            value={search.for}
            options={[...(people.youId() ? [{ value: people.youId()!, label: "You" }] : []), ...people.otherPeople().map((person) => ({ value: person.id, label: person.name }))]}
            onPick={(value) => set({ for: value })}
          />
        </Show>
        <label class="act-date">
          <span>From</span>
          <TextInput type="date" value={search.from ?? ""} max={search.to || undefined} onChange={(event) => set({ from: event.currentTarget.value || undefined })} />
        </label>
        <label class="act-date">
          <span>To</span>
          <TextInput type="date" value={search.to ?? ""} min={search.from || undefined} onChange={(event) => set({ to: event.currentTarget.value || undefined })} />
        </label>
        <Show when={hasFilters(search)}>
          <Button size="compact" variant="quiet" onClick={() => set(clearedSearch())}>
            Clear filters
          </Button>
        </Show>
        <div class="act-toolbar-end">
          <Switch label="Reads and housekeeping" checked={showAll()} onChange={(on) => set({ all: on ? "1" : undefined })} />
          <Show when={full()}>
            <Button size="compact" icon={<Download size={14} aria-hidden="true" />} disabled={exporting() || records().length === 0} onClick={() => void exportCsv()}>
              {exporting() ? "Exporting…" : "Export CSV"}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={search.mode === "agents" || search.runId}>
        <p class="act-scope">
          <Show when={search.runId} fallback={<>Agents' actions only, with who each was for.</>}>
            {(runId) => (
              <>
                The actions of run <span class="mono">{runId().slice(0, 8)}</span>.
              </>
            )}
          </Show>{" "}
          <button type="button" class="act-linkish" onClick={() => set({ mode: undefined, runId: undefined })}>
            Show everyone's activity
          </button>
        </p>
      </Show>

      <section class="card act-card">
        <Branch>
          <Match when={feed.isPending}>
            <p class="org-empty">Loading activity…</p>
          </Match>
          <Match when={denied() && needsFullTier(filters())}>
            <div class="org-empty">
              <p>Narrowing the log to one agent, person or run needs the audit permission (audit:view_agent_actions).</p>
              <Button size="compact" onClick={() => set(clearedSearch())}>
                Clear filters
              </Button>
            </div>
          </Match>
          <Match when={feed.isError}>
            <div class="org-empty">
              <p>Couldn't load the activity log. {feed.error instanceof Error ? feed.error.message : ""}</p>
              <Button size="compact" onClick={() => void feed.refetch()}>
                Try again
              </Button>
            </div>
          </Match>
          <Match when={lines().length === 0 && !feed.hasNextPage}>
            <p class="org-empty">{hasFilters(search) ? "Nothing matches these filters. Try a wider range of days or other filters." : "Nothing recorded yet."}</p>
          </Match>
        </Branch>
        <For each={days()}>
          {(group) => (
            <div class="act-day">
              <h3 class="act-day-head">{group.day}</h3>
              <ol class="act-list">
                <For each={group.lines}>{(line) => <LogRow line={line} base={base()} onRun={commands.openRunModal} people={people} />}</For>
              </ol>
            </div>
          )}
        </For>
        <Show when={feed.hasNextPage || (hidden() > 0 && !showAll())}>
          <div class="act-more">
            <Show when={hidden() > 0 && !showAll()}>
              <span class="org-muted">
                {hidden()} {hidden() === 1 ? "read or housekeeping entry" : "reads and housekeeping entries"} hidden
              </span>
            </Show>
            <Show when={feed.hasNextPage}>
              <Button size="compact" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                {feed.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </Show>
          </div>
        </Show>
      </section>
      <p class="org-foot">Recorded by Paperclip; entries can't be edited, and secret values are never stored.</p>
    </section>
  );
}

function LogRow(props: { line: ActivityLine; base: string; onRun: (runId: string) => void; people: ReturnType<typeof useTaskPeople> }) {
  const agent = () => (props.line.actorAgentId ? props.people.agent(props.line.actorAgentId) : undefined);
  const Icon = () => {
    const Glyph = props.line.verb.startsWith("paused") ? Pause : ICON[props.line.tone];
    return <Glyph size={13} />;
  };
  return (
    <li class="act-row">
      <Show
        when={agent()}
        fallback={
          <span class={`org-act-icon org-act-icon--${props.line.tone}`} aria-hidden="true">
            <Icon />
          </span>
        }
      >
        {(found) => (
          <span class="act-av">
            <AgentAvatar agent={found()} size={24} />
          </span>
        )}
      </Show>
      <div class="act-main">
        <div class="act-sentence">
          <Show when={agent()} fallback={<span class="org-act-who">{props.line.who}</span>}>
            {(found) => (
              <A class="org-act-who act-who-link" href={`${props.base}/agents/${found().urlKey}`}>
                {props.line.who}
              </A>
            )}
          </Show>{" "}
          {props.line.verb}{" "}
          <Show when={props.line.href} fallback={<span class="org-act-target">{props.line.target}</span>}>
            {(href) => (
              <A class="org-act-target act-target" href={`${props.base}${href()}`}>
                {props.line.target}
              </A>
            )}
          </Show>
          <Show when={props.line.title}>
            <span class="act-title"> · {props.line.title}</span>
          </Show>
        </div>
        <Show when={props.line.excerpt}>
          <p class="act-excerpt">“{props.line.excerpt}”</p>
        </Show>
        <div class="act-meta">
          <Show when={props.line.onBehalfOf}>
            <span class="act-chip">for {props.line.onBehalfOf}</span>
          </Show>
          <Show when={props.line.document}>
            <span>
              Document <span class="mono">{props.line.document}</span>
            </span>
          </Show>
          <Show when={props.line.runId}>
            {(runId) => (
              <button type="button" class="act-linkish" onClick={() => props.onRun(runId())}>
                View run
              </button>
            )}
          </Show>
          <span class="mono act-action">{props.line.action}</span>
        </div>
      </div>
      <time class="org-muted act-time" datetime={props.line.at} title={new Date(props.line.at).toLocaleString()}>
        {clockTime(props.line.at).replace(/:\d\d (am|pm)$/, " $1")}
      </time>
    </li>
  );
}
