import type { StatusCard } from "@paperclipai/shared";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { ArchiveRestore, ChevronDown, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { statusCardsApi } from "@/api/status-cards";
import { Dock } from "@/layout/Panel";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { updatedLabel } from "@/tasks/list-model";
import { Button } from "@/ui/Button";
import { HeaderNumber, PageHeader } from "@/ui/PageHeader";
import { pushToast } from "@/ui/Toast";
import { CARD_TABS, CardPanel, type CardTab } from "./CardPanel";
import { CardTile } from "./CardTile";
import { NewCardDialog } from "./NewCardDialog";
import { useCardQuery, useCardsQuery, useRefreshCards, useStatusCardsEnabled, useUpdatesQuery } from "./queries";
import { formatCents, formatTokens, midSentence, rollupAll } from "./status-model";
import "./StatusCards.css";

/*
 * `/:prefix/status` and `/:prefix/status/:cardId`, status cards (decision 39, D3; after
 * ui/src/pages/StatusCards/index.tsx), behind `enableStatusCards`. Old `/status-cards/…` links land
 * here (routes/legacy-model.ts). No board draws them, so the old page's structure is built from
 * Capsule Stack pieces, to be designed once they've been tried:
 *
 * - The header: how many cards, and what they spent today.
 * - The tiles (CardTile), and New card (NewCardDialog).
 * - A card's panel (CardPanel), docked beside the tiles, with its tab in `?tab=`.
 * - Archived cards, folded below, with their lifetime cost and Restore.
 *
 * Status cards are separate from the briefings idea (build plan 3.13), though they may come to do
 * that job.
 */

export function StatusPage() {
  const company = useCompany();
  const commands = useCommands();
  const navigate = useNavigate();
  const params = useParams<{ cardId?: string }>();
  const [search, setSearch] = useSearchParams<{ tab?: string }>();
  const refresh = useRefreshCards();
  const enabled = useStatusCardsEnabled();
  const on = () => enabled() === true;

  const active = useCardsQuery(() => false, on);
  const archived = useCardsQuery(() => true, on);
  const [showArchived, setShowArchived] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);

  const cardId = () => params.cardId ?? null;
  const listed = createMemo(() => [...(active.data ?? []), ...(archived.data ?? [])].find((card) => card.id === cardId()) ?? null);
  // A link to a card that isn't in the lists (yet) fetches it on its own.
  const single = useCardQuery(() => (on() && cardId() && !listed() ? cardId() : null));
  const openCard = () => listed() ?? (single.data?.id === cardId() ? single.data : null);
  const tab = (): CardTab => (CARD_TABS.some((entry) => entry.value === search.tab) ? (search.tab as CardTab) : "summary");

  const base = () => `/${company().issuePrefix}/status`;
  const open = (id: string, next?: CardTab) => navigate(`${base()}/${id}${next && next !== "summary" ? `?tab=${next}` : ""}`);
  const close = () => navigate(base());

  const today = createMemo(() =>
    (active.data ?? []).reduce((sum, card) => ({ tokens: sum.tokens + (card.todayTokens ?? 0), cents: sum.cents + (card.todayCostCents ?? 0) }), { tokens: 0, cents: 0 }),
  );

  const run = async (card: StatusCard, what: string, action: () => Promise<unknown>, done: string) => {
    setBusy(`${card.id}:${what}`);
    try {
      await action();
      pushToast({ tone: "success", title: done, body: card.title ?? undefined });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't ${what === "setup" ? "start the setup" : what === "archive" ? "change the card" : "update the card"}`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const update = (card: StatusCard, full = false) =>
    void run(
      card,
      "update",
      async () => {
        const result = await statusCardsApi.refresh(card.id, full);
        if (result.alreadyGenerating) throw new Error("An update is already running.");
      },
      full ? "Full rebuild started" : "Update started",
    );
  const setup = (card: StatusCard) => void run(card, "setup", () => statusCardsApi.recompile(card.id), "Setup started");
  const archive = (card: StatusCard, value: boolean) =>
    void run(card, "archive", () => statusCardsApi.patch(card.id, { archived: value }), value ? "Card archived" : "Card restored");

  const openTask = (task: { id: string; identifier: string | null; title?: string }) =>
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title ?? task.identifier ?? "Task", projectId: null });

  return (
    <div class="sc-page">
      <PageHeader
        crumbs={<span>{company().name}</span>}
        title="Status"
        numbers={
          <Show when={active.data}>
            <HeaderNumber value={active.data!.length} label={active.data!.length === 1 ? "card" : "cards"} />
            <Show when={today().tokens > 0 || today().cents > 0}>
              <span class="cap">
                Today {formatTokens(today().tokens)} · {formatCents(today().cents)}
              </span>
            </Show>
          </Show>
        }
        actions={
          <Show when={on()}>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
              New card
            </Button>
          </Show>
        }
      />
      <Switch>
        <Match when={enabled() === undefined}>
          <p class="card sc-page-note muted">Loading…</p>
        </Match>
        <Match when={enabled() === false}>
          <p class="card sc-page-note">Status cards are off on this instance. An instance admin turns them on with the `enableStatusCards` experimental setting.</p>
        </Match>
        <Match when={on()}>
          <Dock>
            <Switch>
              <Match when={active.isPending}>
                <p class="card sc-page-note muted">Loading cards…</p>
              </Match>
              <Match when={active.isError}>
                <p class="card sc-page-note">The cards couldn't be loaded: {(active.error as Error).message}</p>
              </Match>
              <Match when={(active.data ?? []).length === 0}>
                <section class="card sc-empty">
                  <h2 class="disp">No status cards yet</h2>
                  <p class="muted">A card keeps a summary of the tasks you care about current: ask it a standing question, and an agent answers it as the tasks change.</p>
                  <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
                    New card
                  </Button>
                </section>
              </Match>
              <Match when={true}>
                <div class="sc-grid">
                  <For each={active.data}>
                    {(card) => (
                      <CardTile
                        card={card}
                        selected={card.id === cardId()}
                        busy={busy()}
                        onOpen={(next) => open(card.id, next)}
                        onUpdate={() => update(card)}
                        onSetup={() => setup(card)}
                        onArchive={() => archive(card, true)}
                        onOpenTask={(id) => openTask({ id, identifier: null })}
                      />
                    )}
                  </For>
                </div>
              </Match>
            </Switch>

            <Show when={(archived.data ?? []).length > 0}>
              <section class="sc-archived">
                <button type="button" class="sc-archived-toggle" aria-expanded={showArchived()} onClick={() => setShowArchived(!showArchived())}>
                  <ChevronDown size={14} aria-hidden="true" class="sc-caret" />
                  Archived <span class="cap">{archived.data!.length}</span>
                </button>
                <Show when={showArchived()}>
                  <ul class="card sc-archived-list">
                    <For each={archived.data}>
                      {(card) => (
                        <ArchivedRow card={card} selected={card.id === cardId()} restoring={busy() === `${card.id}:archive`} onView={() => open(card.id)} onRestore={() => archive(card, false)} />
                      )}
                    </For>
                  </ul>
                </Show>
              </section>
            </Show>

            <Show when={cardId()}>
              <Show
                when={openCard()}
                fallback={
                  <Show when={single.isError}>
                    <p class="card sc-page-note" role="status">
                      That card wasn't found. It may have been deleted.{" "}
                      <Button size="compact" variant="quiet" onClick={close}>
                        Dismiss
                      </Button>
                    </p>
                  </Show>
                }
              >
                {(card) => (
                  <CardPanel
                    card={card()}
                    tab={tab()}
                    onTab={(next) => setSearch({ tab: next === "summary" ? undefined : next }, { replace: true })}
                    onClose={close}
                    busy={busy()}
                    onUpdate={(full) => update(card(), full)}
                    onSetup={() => setup(card())}
                    onArchive={(value) => archive(card(), value)}
                    onOpenTask={openTask}
                  />
                )}
              </Show>
            </Show>
          </Dock>
        </Match>
      </Switch>
      <NewCardDialog open={creating()} onOpenChange={setCreating} onCreated={(card) => open(card.id)} />
    </div>
  );
}

/** An archived card: when it was archived, its last summary, and what it cost in all. */
function ArchivedRow(props: { card: StatusCard; selected: boolean; restoring: boolean; onView: () => void; onRestore: () => void }) {
  const updates = useUpdatesQuery(() => props.card.id);
  const lifetime = () => (updates.data ? rollupAll(updates.data) : null);
  const day = (value: string | null) => (value ? midSentence(updatedLabel(value)) : "never");
  return (
    <li class="sc-archived-row" classList={{ "sc-archived-row--selected": props.selected }}>
      <div class="sc-archived-text">
        <button type="button" class="sc-archived-title" onClick={() => props.onView()}>
          {props.card.title ?? "Untitled card"}
        </button>
        <span class="cap">
          Archived {day(props.card.archivedAt)} · last summary {day(props.card.lastGeneratedAt)}
          {lifetime() ? ` · ${formatTokens(lifetime()!.totalTokens)} · ${formatCents(lifetime()!.totalCostCents)} in all` : ""}
        </span>
      </div>
      <Button size="compact" icon={<ArchiveRestore size={14} aria-hidden="true" />} disabled={props.restoring} title="Restoring runs an update at once" onClick={() => props.onRestore()}>
        {props.restoring ? "Restoring…" : "Restore"}
      </Button>
    </li>
  );
}
