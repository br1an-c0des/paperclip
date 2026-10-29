import type { CompanySearchIssueSummary, IssueStatus, StatusCard, StatusCardUpdate } from "@paperclipai/shared";
import { Archive, ArchiveRestore, Ellipsis, History, RefreshCw, Wand2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { Panel } from "@/layout/Panel";
import { stampLabel } from "@/tasks/thread-model";
import { updatedLabel } from "@/tasks/list-model";
import { Button } from "@/ui/Button";
import { FieldButton } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Capsule, StatusCapsule, TonePill } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { CardSettings } from "./CardSettings";
import { useDryRunQuery, useRevisionsQuery, useUpdatesQuery } from "./queries";
import {
  cardIsBusy,
  cardIsLive,
  cardLifecycle,
  changeKindLabel,
  dryRunMatches,
  formatCents,
  formatTokens,
  formatTokenSplit,
  hasWatchSet,
  LIFECYCLE,
  midSentence,
  policyLabel,
  rollupToday,
  setupRunning,
  summaryUpdates,
  triggerLabel,
  updateKindLabel,
} from "./status-model";

/*
 * A card opened from the Status page (after ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx),
 * docked beside the tiles and a full page on a phone. The header has the card's state, Update now
 * (or Run setup again while setup stalled, Restore when archived) and a menu with a full rebuild and
 * Archive. Four tabs, kept in the URL as `?tab=`:
 *
 * - Summary: the latest summary, or an earlier one picked from the revisions (each update that
 *   wrote a summary pairs with a document revision), and the task changes that update folded in.
 * - History: every run in the ledger with its trigger, tokens, cost and model; today's totals.
 * - Watched: a dry run of the compiled query, the tasks it matches now, plus tasks the summary
 *   mentions. No agent runs.
 * - Settings: CardSettings.
 */

export type CardTab = "summary" | "history" | "watched" | "settings";

export const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "history", label: "History" },
  { value: "watched", label: "Watched" },
  { value: "settings", label: "Settings" },
];

export function CardPanel(props: {
  card: StatusCard;
  tab: CardTab;
  onTab: (tab: CardTab) => void;
  onClose: () => void;
  busy: string | null;
  onUpdate: (full?: boolean) => void;
  onSetup: () => void;
  onArchive: (archived: boolean) => void;
  onOpenTask: (task: { id: string; identifier: string | null; title?: string }) => void;
}) {
  const state = () => cardLifecycle(props.card);
  const meta = () => LIFECYCLE[state()];
  const archived = () => state() === "archived";
  const stalled = () => (state() === "compiling" && !setupRunning(props.card)) || state() === "error";
  const busyWith = (what: string) => props.busy === `${props.card.id}:${what}`;
  const title = () => props.card.title ?? "New card";

  const header = () => (
    <div class="sc-panel-head">
      <Capsule gradient={meta().gradient} size="pill" live={cardIsLive(props.card)} />
      <div class="sc-panel-title">
        <h2 class="disp">{title()}</h2>
        <p class="cap">
          {meta().label} · {props.card.lastGeneratedAt ? `updated ${midSentence(updatedLabel(props.card.lastGeneratedAt))}` : "no summary yet"} · {policyLabel(props.card.refreshPolicy).toLowerCase()}
        </p>
      </div>
    </div>
  );

  const actions = () => (
    <>
      <Switch>
        <Match when={archived()}>
          <Button size="compact" icon={<ArchiveRestore size={14} aria-hidden="true" />} disabled={busyWith("archive")} onClick={() => props.onArchive(false)} aria-label="Restore">
            <span class="sc-btn-label">Restore</span>
          </Button>
        </Match>
        <Match when={stalled()}>
          <Button size="compact" icon={<Wand2 size={14} aria-hidden="true" />} disabled={busyWith("setup")} onClick={props.onSetup} aria-label="Run setup again">
            <span class="sc-btn-label">{busyWith("setup") ? "Starting…" : "Run setup again"}</span>
          </Button>
        </Match>
        <Match when={true}>
          <Button
            size="compact"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={busyWith("update") || cardIsBusy(props.card)}
            onClick={() => props.onUpdate(false)}
            aria-label="Update now"
          >
            <span class="sc-btn-label">{busyWith("update") ? "Starting…" : state() === "updating" ? "Updating…" : "Update now"}</span>
          </Button>
        </Match>
      </Switch>
      <Show when={!archived()}>
        <Menu placement="bottom-end">
          <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label="More actions">
            <Ellipsis size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="More actions" width={260}>
            <Menu.Item
              icon={<RefreshCw size={16} />}
              disabled={cardIsBusy(props.card) || props.card.queries.length === 0}
              description="Writes the summary from scratch"
              onSelect={() => props.onUpdate(true)}
            >
              Full rebuild
            </Menu.Item>
            <Menu.Item icon={<Wand2 size={16} />} disabled={setupRunning(props.card)} description="Builds the query again from the prompt" onSelect={props.onSetup}>
              Rebuild the query
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item icon={<Archive size={16} />} description="Stops updates; keeps its summary and history" onSelect={() => props.onArchive(true)}>
              Archive
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </Show>
    </>
  );

  return (
    <Panel label={`Status card: ${title()}`} onClose={props.onClose} header={header()} actions={actions()}>
      <div class="sc-panel">
        <Segmented label="Card sections" options={CARD_TABS} value={props.tab} onChange={props.onTab} />
        <Switch>
          <Match when={props.tab === "summary"}>
            <SummaryTab card={props.card} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={props.tab === "history"}>
            <HistoryTab card={props.card} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={props.tab === "watched"}>
            <WatchedTab card={props.card} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={props.tab === "settings"}>
            <CardSettings card={props.card} onDeleted={props.onClose} />
          </Match>
        </Switch>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Summary

function SummaryTab(props: { card: StatusCard; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const state = () => cardLifecycle(props.card);
  const updates = useUpdatesQuery(() => props.card.id, { poll: () => cardIsBusy(props.card) });
  const revisions = useRevisionsQuery(() => props.card.id, () => Boolean(props.card.documentId));
  const written = createMemo(() => summaryUpdates(updates.data ?? []));
  const [picked, setPicked] = createSignal<string | null>(null);
  createEffect(on(() => props.card.id, () => setPicked(null)));

  const pickedUpdate = () => (picked() ? written().find((update) => update.id === picked()) ?? null : null);
  const number = (update: StatusCardUpdate) => written().length - written().indexOf(update);
  // The update and its document revision are written together, so they pair by position.
  const pickedBody = () => {
    const update = pickedUpdate();
    return update ? revisions.data?.[written().indexOf(update)]?.body ?? null : null;
  };
  const changes = () => pickedUpdate()?.changes ?? (updates.data ?? []).find((update) => update.kind !== "compile")?.changes ?? [];
  const summary = () => props.card.summaryBody?.trim() ?? "";

  return (
    <div class="sc-tab">
      <Show when={written().length > 0 && state() !== "compiling"}>
        <div class="sc-rev-row">
          <Show when={written().length > 1} fallback={<span class="cap">Revision 1 · latest</span>}>
            <Menu placement="bottom-end">
              <Menu.Trigger as={FieldButton} class="sc-rev" icon={<History size={14} aria-hidden="true" />} aria-label="Earlier summaries">
                {pickedUpdate() ? `Revision ${number(pickedUpdate()!)}` : `Revision ${written().length} · latest`}
              </Menu.Trigger>
              <Menu.Content label="Earlier summaries" width={300}>
                <Menu.Item hint={picked() === null ? "Shown" : undefined} onSelect={() => setPicked(null)}>
                  Revision {written().length} · latest
                </Menu.Item>
                <Menu.Separator />
                <For each={written().slice(1, 30)}>
                  {(update) => (
                    <Menu.Item
                      description={`${updateKindLabel(update.kind)} · ${stampLabel(update.startedAt)}`}
                      hint={picked() === update.id ? "Shown" : undefined}
                      onSelect={() => setPicked(update.id)}
                    >
                      Revision {number(update)}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </Show>
        </div>
      </Show>

      <Switch>
        <Match when={pickedUpdate()}>
          {(update) => (
            <section class="sc-earlier">
              <p class="cap">
                Revision {number(update())} · {updateKindLabel(update().kind)} · {stampLabel(update().startedAt)}
              </p>
              <Show
                when={pickedBody()}
                fallback={
                  <Show when={update().changeSummary} fallback={<p class="muted">No summary text was kept for this revision.</p>}>
                    <Markdown source={update().changeSummary!} />
                    <p class="cap">The full text of this revision isn't available; this is its change note.</p>
                  </Show>
                }
              >
                <Markdown source={pickedBody()!} />
              </Show>
              <Button size="compact" variant="quiet" onClick={() => setPicked(null)}>
                Back to the latest
              </Button>
            </section>
          )}
        </Match>
        <Match when={state() === "error"}>
          <p class="sc-note sc-note--red" role="alert">
            {props.card.queries.length > 0 ? "The last update failed" : "Setup failed"}
            {props.card.failureReason ? `: ${props.card.failureReason}` : "."}
            {summary() ? " This is the last good summary." : ""}
          </p>
          <Show when={summary()}>
            <Markdown source={summary()} />
          </Show>
        </Match>
        <Match when={summary()}>
          <Markdown source={summary()} />
        </Match>
        <Match when={state() === "compiling"}>
          <div class="sc-note">
            <p>
              {setupRunning(props.card)
                ? "Setting up: the agent is building the query, and the first summary follows on its own."
                : "Setup didn't finish. Run it again from the button above."}
            </p>
            <p class="muted">“{props.card.interestPrompt}”</p>
            <Show when={setupRunning(props.card) && props.card.generatingIssueId}>
              <Button size="compact" variant="quiet" onClick={() => props.onOpenTask({ id: props.card.generatingIssueId!, identifier: null })}>
                Open the setup task
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={true}>
          <p class="muted">No summary yet.</p>
        </Match>
      </Switch>

      <Show when={changes().length > 0}>
        <section class="sc-section">
          <h3 class="sc-section-title disp">
            {pickedUpdate() ? "Folded into this revision" : "Folded into the last update"} <span class="cap">{changes().length}</span>
          </h3>
          <ul class="sc-rows">
            <For each={changes()}>
              {(change) => (
                <li class="sc-row-item">
                  <button type="button" class="sc-task-id mono" onClick={() => props.onOpenTask({ id: change.issueId, identifier: change.identifier })}>
                    {change.identifier}
                  </button>
                  <Show when={change.from && change.to} fallback={<span class="muted">{changeKindLabel(change.changeKind)}</span>}>
                    <span class="sc-move">
                      <StatusWord status={change.from!} /> <span aria-hidden="true">→</span> <StatusWord status={change.to!} />
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}

function StatusWord(props: { status: string }) {
  const meta = () => STATUS_META[props.status as IssueStatus];
  return (
    <Show when={meta()} fallback={<span>{props.status}</span>}>
      <span class="sc-status">
        <StatusCapsule status={props.status as IssueStatus} size="tiny" />
        {meta()!.label}
      </span>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// History

function HistoryTab(props: { card: StatusCard; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const updates = useUpdatesQuery(() => props.card.id, { poll: () => cardIsBusy(props.card) });
  const today = () => rollupToday(updates.data ?? []);
  return (
    <div class="sc-tab">
      <Switch>
        <Match when={updates.isPending}>
          <p class="muted">Loading the history…</p>
        </Match>
        <Match when={updates.isError}>
          <p class="muted">The history couldn't be loaded: {(updates.error as Error).message}</p>
        </Match>
        <Match when={(updates.data ?? []).length === 0}>
          <p class="muted">No runs yet.</p>
        </Match>
        <Match when={true}>
          <p class="cap">
            Today: {today().updateCount} update{today().updateCount === 1 ? "" : "s"} · {formatTokens(today().totalTokens)} · {formatCents(today().totalCostCents)}
            {props.card.refreshPolicy.dailyTokenCap ? ` · cap ${formatTokens(props.card.refreshPolicy.dailyTokenCap)}` : ""}
          </p>
          <ul class="sc-rows">
            <For each={updates.data}>
              {(update) => (
                <li class="sc-history">
                  <div class="sc-history-top">
                    <b>{updateKindLabel(update.kind)}</b>
                    <Switch>
                      <Match when={update.status === "failed"}>
                        <TonePill tone="red" compact>
                          Failed
                        </TonePill>
                      </Match>
                      <Match when={update.status === "running"}>
                        <TonePill tone="run" compact icon={<Capsule gradient="ion" size="tiny" live />}>
                          Running
                        </TonePill>
                      </Match>
                    </Switch>
                    <span class="cap">{triggerLabel(update.trigger)}</span>
                    <span class="cap sc-history-when" title={new Date(update.startedAt).toLocaleString()}>
                      {stampLabel(update.startedAt)}
                    </span>
                  </div>
                  <p class="cap">
                    {[
                      formatTokenSplit(update.inputTokens, update.outputTokens),
                      formatCents(update.costCents),
                      update.model,
                      update.changes.length > 0 ? `${update.changes.length} change${update.changes.length === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <Show when={update.changeSummary}>
                    <p class="sc-history-note">{update.changeSummary}</p>
                  </Show>
                  <Show when={update.error}>
                    <p class="field-error">{update.error}</p>
                  </Show>
                  <Show when={update.generationIssueId}>
                    <Button size="compact" variant="quiet" onClick={() => props.onOpenTask({ id: update.generationIssueId!, identifier: null })}>
                      Open its task
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Watched (the dry run)

function WatchedTab(props: { card: StatusCard; onOpenTask: (task: { id: string; identifier: string | null; title?: string }) => void }) {
  const dryRun = useDryRunQuery(() => props.card.id, () => hasWatchSet(props.card));
  const matches = createMemo(() => dryRunMatches(dryRun.data));
  return (
    <div class="sc-tab">
      <div class="sc-watched-top">
        <p class="cap">A dry run of the card's query: the tasks it matches now. No agent runs.</p>
        <Show when={hasWatchSet(props.card)}>
          <Button size="compact" variant="quiet" icon={<RefreshCw size={14} aria-hidden="true" />} disabled={dryRun.isFetching} onClick={() => void dryRun.refetch()}>
            {dryRun.isFetching ? "Running…" : "Run again"}
          </Button>
        </Show>
      </div>
      <Switch>
        <Match when={!hasWatchSet(props.card)}>
          <p class="sc-note">The card is still setting up. The tasks it watches show here once its query is built.</p>
        </Match>
        <Match when={dryRun.isPending}>
          <p class="muted">Matching tasks…</p>
        </Match>
        <Match when={dryRun.isError}>
          <p class="muted">The dry run failed: {(dryRun.error as Error).message}</p>
        </Match>
        <Match when={matches().matched.length === 0 && matches().mentioned.length === 0}>
          <p class="sc-note">The query matches no tasks right now.</p>
        </Match>
        <Match when={true}>
          <Show when={matches().matched.length > 0}>
            <section class="sc-section">
              <h3 class="sc-section-title disp">
                Matched <span class="cap">{matches().matched.length}</span>
              </h3>
              <TaskRows tasks={matches().matched} onOpenTask={props.onOpenTask} />
            </section>
          </Show>
          <Show when={matches().mentioned.length > 0}>
            <section class="sc-section">
              <h3 class="sc-section-title disp">
                Mentioned in the summary <span class="cap">{matches().mentioned.length}</span>
              </h3>
              <TaskRows tasks={matches().mentioned} onOpenTask={props.onOpenTask} />
            </section>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

function TaskRows(props: { tasks: CompanySearchIssueSummary[]; onOpenTask: (task: { id: string; identifier: string | null; title?: string }) => void }) {
  return (
    <ul class="sc-rows">
      <For each={props.tasks}>
        {(task) => (
          <li>
            <button type="button" class="sc-task" onClick={() => props.onOpenTask({ id: task.id, identifier: task.identifier, title: task.title })}>
              <StatusCapsule status={task.status} size="row" />
              <span class="mono cap">{task.identifier ?? task.id.slice(0, 8)}</span>
              <span class="sc-task-title">{task.title}</span>
              <span class="cap">{updatedLabel(task.updatedAt)}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}
