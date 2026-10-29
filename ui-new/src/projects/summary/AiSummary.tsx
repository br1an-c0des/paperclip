import type { SummarySlotKey, SummarySlotScopeKind } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, History, LoaderCircle, RefreshCw, Sparkles } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { agentsApi } from "@/api/agents";
import { failure } from "@/projects/settings/shared";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { useLiveEvent } from "@/lib/live-events";
import { Button } from "@/ui/Button";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { briefView, generatedAgo, isGenerating, summarizerState } from "./summary-model";
import { summaryApi, type SummarySlotSelector } from "./summary-api";
import "./AiSummary.css";

/*
 * AI summaries (`enableSummaries`; `projects/summary`), as ui/src/components/SummarySlotCard.tsx
 * shows them: the latest revision of a Markdown summary the built-in Summarizer agent writes, with
 * Regenerate, the earlier revisions under History, what it's doing while it works, and a note
 * when the Summarizer still needs setting up (built-in agents live under Manage agents).
 *
 * `useAiSummary` holds the queries; `SummaryControls` (the "AI" chip and Regenerate) and
 * `SummaryBody` are placed by the caller: the project dashboard's Brief well (board 8, M12) puts
 * them in the well's head and body. `SummaryCard` is the same in a card of its own, for the
 * Workspaces tab's "Workspace summary" (scope `workspaces_overview`) and an execution workspace.
 *
 * Generate starts a task for the Summarizer and spends tokens; the slot is polled every 3 seconds
 * while it works, and a `summary_slot` activity event (the Summarizer's write) refreshes it at once.
 */

const SETUP_HINT = "Summaries are written by Paperclip's built-in Summarizer agent.";

export type AiSummary = ReturnType<typeof useAiSummary>;

export function useAiSummary(scope: () => { scopeKind: SummarySlotScopeKind; scopeId?: string | null; slotKey?: SummarySlotKey }) {
  const company = useCompany();
  const client = useQueryClient();
  const experimental = useExperimentalSettingsQuery();
  const enabled = () => experimental.data?.enableSummaries === true;
  const selector = (): SummarySlotSelector => ({ companyId: company().id, scopeKind: scope().scopeKind, scopeId: scope().scopeId ?? null, slotKey: scope().slotKey ?? "header" });
  const slotKey = () => queryKeys.projects.summary(company().id, selector().scopeKind, selector().slotKey, selector().scopeId);
  const revisionsKey = () => queryKeys.projects.summaryRevisions(company().id, selector().scopeKind, selector().slotKey, selector().scopeId);

  const slot = createQuery(() => ({
    queryKey: slotKey(),
    queryFn: ({ signal }) => summaryApi.get(selector(), signal),
    enabled: enabled(),
    retry: false,
    refetchInterval: (query) => (query.state.data?.slot?.status === "generating" ? 3_000 : false),
  }));
  const revisions = createQuery(() => ({
    queryKey: revisionsKey(),
    queryFn: ({ signal }) => summaryApi.revisions(selector(), signal),
    enabled: enabled() && !!slot.data?.document,
    retry: false,
  }));
  const builtIns = createQuery(() => ({
    queryKey: queryKeys.projects.builtInAgents(company().id),
    queryFn: ({ signal }) => summaryApi.builtInAgents(company().id, signal),
    enabled: enabled() && experimental.data?.enableBuiltInAgents === true,
    retry: false,
    staleTime: 60_000,
  }));

  const refresh = () =>
    Promise.all([client.invalidateQueries({ queryKey: slotKey() }), client.invalidateQueries({ queryKey: revisionsKey() })]);
  useLiveEvent(["activity.logged"], (event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.entityType !== "summary_slot") return;
    const details = (payload.details ?? {}) as Record<string, unknown>;
    if (details.scopeKind === selector().scopeKind && (details.scopeId ?? null) === (selector().scopeId ?? null)) void refresh();
  });

  const [selected, setSelected] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const generate = createMutation(() => ({
    mutationFn: () => summaryApi.generate(selector()),
    onMutate: () => setProblem(null),
    onSuccess: async () => {
      setSelected(null);
      await refresh();
    },
    onError: (caught) => setProblem(failure(caught, "Couldn't start a new summary.")),
  }));
  const resume = createMutation(() => ({
    mutationFn: (agentId: string) => agentsApi.resume(agentId, company().id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.projects.builtInAgents(company().id) }),
    onError: (caught) => setProblem(failure(caught, "Couldn't resume the Summarizer.")),
  }));

  const view = createMemo(() => briefView(slot.data, revisions.data?.revisions, selected()));
  const summarizer = createMemo(() => summarizerState(builtIns.data));
  const working = () => isGenerating(slot.data);
  const failed = () => slot.data?.slot?.status === "failed";

  return {
    enabled,
    /** The flag has loaded: off means the caller shows its own content. */
    settled: () => experimental.data !== undefined,
    slot,
    view,
    summarizer,
    working,
    failed,
    selected,
    select: setSelected,
    problem,
    generate,
    resume,
    /** Regenerate is offered once there's a summary, and for the first one when the Summarizer is ready. */
    canGenerate: () => !working() && (view() !== null || failed() || summarizer().kind === "ready"),
  };
}

/** The "AI" chip, History and Regenerate, for the head of the brief. */
export function SummaryControls(props: { summary: AiSummary; label: string }) {
  const s = props.summary;
  return (
    <span class="ais-controls">
      <span class="ais-chip" title="Written by the Summarizer agent">
        AI
      </span>
      <Show when={s.canGenerate() && (s.view() || s.failed())}>
        <button
          type="button"
          class="nt-icon nt-icon--small ais-regen"
          aria-label={`Regenerate the ${props.label}`}
          title={`Regenerate the ${props.label}`}
          disabled={s.generate.isPending}
          onClick={() => s.generate.mutate()}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </Show>
    </span>
  );
}

/** The summary itself, with its state: setting up, working, failed, empty or written. */
export function SummaryBody(props: { summary: AiSummary; label: string; empty?: JSX.Element }) {
  const company = useCompany();
  const s = props.summary;
  const prefix = () => company().issuePrefix;
  return (
    <div class="ais">
      <Switch>
        <Match when={s.summarizer().kind === "setup" || s.summarizer().kind === "pending"}>
          <p class="ais-note">
            <Show when={s.summarizer().kind === "pending"} fallback={<>{SETUP_HINT} Set it up with a harness and model before asking for a summary. </>}>
              {SETUP_HINT} Its setup is waiting for approval in the Inbox.{" "}
            </Show>
            <A class="pd-link" href={`/${prefix()}/agents?filter=builtin`}>
              Built-in agents
            </A>
          </p>
        </Match>
        <Match when={s.summarizer().kind === "paused" && s.summarizer()}>
          {(state) => (
            <p class="ais-note">
              The Summarizer is paused: the summary stays readable, but no new one is written.{" "}
              <button type="button" class="ais-link" disabled={s.resume.isPending} onClick={() => s.resume.mutate((state() as { agentId: string }).agentId)}>
                {s.resume.isPending ? "Resuming…" : "Resume it"}
              </button>
            </p>
          )}
        </Match>
      </Switch>
      <Show when={s.slot.isError}>
        <p class="ais-note" role="alert">
          Couldn't load the {props.label}: {failure(s.slot.error, "")}{" "}
          <button type="button" class="ais-link" onClick={() => void s.slot.refetch()}>
            Try again
          </button>
        </p>
      </Show>
      <Show when={s.problem()}>
        <p class="ais-note ais-note--error" role="alert">
          {s.problem()}
        </p>
      </Show>
      <Show when={s.failed() && !s.working()}>
        <p class="ais-note ais-note--error" role="alert">
          The last summary failed: {s.slot.data?.slot?.failureReason ?? "the Summarizer's task ended before it wrote one."}{" "}
          <button type="button" class="ais-link" disabled={s.generate.isPending} onClick={() => s.generate.mutate()}>
            {s.generate.isPending ? "Retrying…" : "Retry"}
          </button>
        </p>
      </Show>
      <Show when={s.working() && s.slot.data?.generatingIssue}>
        {(issue) => <Working issue={issue()} />}
      </Show>
      <Show
        when={s.view()}
        fallback={
          <Show when={!s.slot.isPending && !s.slot.isError && !s.working()}>
            {props.empty}
            <Show when={s.summarizer().kind === "ready" && !s.failed()}>
              <Button size="compact" icon={<Sparkles size={14} aria-hidden="true" />} disabled={s.generate.isPending} onClick={() => s.generate.mutate()}>
                {s.generate.isPending ? "Starting…" : `Generate a ${props.label}`}
              </Button>
            </Show>
          </Show>
        }
      >
        {(view) => (
          <>
            <Markdown source={view().body} class="ais-body" />
            <div class="ais-foot">
              <span title={view().at ? new Date(view().at!).toLocaleString() : undefined}>
                {view().historical ? "Written" : "Generated"} {view().at ? generatedAgo(view().at!) : ""}
              </span>
              <span aria-hidden="true">·</span>
              <span>revision {view().shown?.number ?? view().latestNumber}</span>
              <Show when={view().historical}>
                <span aria-hidden="true">·</span>
                <button type="button" class="ais-link" onClick={() => s.select(null)}>
                  Back to the latest
                </button>
              </Show>
              <Show when={view().earlier.length > 0}>
                <span aria-hidden="true">·</span>
                <Menu placement="bottom-start">
                  <Menu.Trigger class="ais-link ais-history" aria-label={`Earlier ${props.label}s`}>
                    <History size={12} aria-hidden="true" />
                    History
                  </Menu.Trigger>
                  <Menu.Content label={`Earlier ${props.label}s`} width={240}>
                    <Menu.Item onSelect={() => s.select(null)} hint={view().historical ? undefined : <Check size={14} />} description={`Revision ${view().latestNumber}`}>
                      Latest
                    </Menu.Item>
                    <Menu.Separator />
                    <For each={view().earlier}>
                      {(entry) => (
                        <Menu.Item onSelect={() => s.select(entry.id)} hint={s.selected() === entry.id ? <Check size={14} /> : undefined} description={new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}>
                          Revision {entry.number}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Content>
                </Menu>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

/** While the Summarizer works: the latest line its run reports, and its task. */
function Working(props: { issue: { id: string; identifier: string | null; title: string } }) {
  const company = useCompany();
  const [line, setLine] = createSignal<string | null>(null);
  useLiveEvent(["heartbeat.run.progress"], (event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.issueId !== props.issue.id) return;
    const pick = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const tool = pick(payload.currentToolName);
    setLine(pick(payload.message) ?? pick(payload.lastAssistantSnippet) ?? (tool ? `Working with ${tool}` : null));
  });
  return (
    <div class="ais-working" role="status">
      <LoaderCircle size={14} class="ais-spin" aria-hidden="true" />
      <div>
        <b>Writing a new summary</b>
        <Show when={line()}>
          <span class="ais-line" title={line()!}>
            {line()}
          </span>
        </Show>
        <span class="ais-task">
          In{" "}
          <A href={`/${company().issuePrefix}/issues/${props.issue.identifier ?? props.issue.id}`}>
            {props.issue.identifier ? `${props.issue.identifier} · ` : ""}
            {props.issue.title}
          </A>
        </span>
      </div>
    </div>
  );
}

/** A summary in a card of its own (the Workspaces tab, an execution workspace). Nothing while summaries are off. */
export function SummaryCard(props: { scopeKind: SummarySlotScopeKind; scopeId?: string | null; title: string; description: string; label?: string }) {
  const summary = useAiSummary(() => ({ scopeKind: props.scopeKind, scopeId: props.scopeId ?? null }));
  const label = () => props.label ?? "summary";
  return (
    <Show when={summary.enabled()}>
      <section class="card ais-card" aria-label={props.title}>
        <div class="ais-card-head">
          <h2 class="disp">{props.title}</h2>
          <SummaryControls summary={summary} label={label()} />
        </div>
        <SummaryBody summary={summary} label={label()} empty={<p class="ais-note">{props.description}</p>} />
      </section>
    </Show>
  );
}
