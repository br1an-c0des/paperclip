import type { StatusCard } from "@paperclipai/shared";
import { Archive, Ellipsis, History, ListChecks, RefreshCw, Settings2, TriangleAlert, Wand2 } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { updatedLabel } from "@/tasks/list-model";
import { Button } from "@/ui/Button";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { Capsule } from "@/ui/Status";
import { cardIsLive, cardLifecycle, formatCents, formatTokens, LIFECYCLE, midSentence, policyLabel, setupRunning } from "./status-model";
import type { CardTab } from "./CardPanel";

/*
 * One card on the Status page (after ui/src/pages/StatusCards/StatusCardTile.tsx): its state capsule
 * and title, a line for the state when it needs one (setting up, updating, stale with Update, error
 * with Retry, paused), the summary, and a footer with freshness, refresh policy and today's tokens
 * and cost. The title opens the card's panel, and so does a click anywhere on the tile; the "…" menu
 * holds Update now, Run setup again (when setup stalled or failed), Settings, Watched tasks,
 * History and Archive.
 *
 * The old tile also streams the summary as the agent writes it, from the run's `acpx.text_delta`
 * output. That only works for ACP harnesses and isn't ported; an update shows its task instead.
 */

export function CardTile(props: {
  card: StatusCard;
  selected: boolean;
  busy: string | null;
  onOpen: (tab?: CardTab) => void;
  onUpdate: () => void;
  onSetup: () => void;
  onArchive: () => void;
  onOpenTask: (issueId: string) => void;
}) {
  const state = () => cardLifecycle(props.card);
  const meta = () => LIFECYCLE[state()];
  const summary = () => props.card.summaryBody?.trim() ?? "";
  const pending = () => props.card.pendingChangeCount;
  const updating = () => props.busy === `${props.card.id}:update`;
  const settingUp = () => props.busy === `${props.card.id}:setup`;
  const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
  const footer = () => {
    if (state() === "compiling") return "Setting up · first summary to come";
    return [
      props.card.lastGeneratedAt ? `Updated ${midSentence(updatedLabel(props.card.lastGeneratedAt))}` : "No summary yet",
      policyLabel(props.card.refreshPolicy),
      props.card.todayTokens ? formatTokens(props.card.todayTokens) : null,
      props.card.todayCostCents ? formatCents(props.card.todayCostCents) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <article
      class="card sc-tile"
      aria-label={props.card.title ?? "New card"}
      classList={{ "sc-tile--setup": state() === "compiling", "sc-tile--selected": props.selected }}
      data-state={state()}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, [role=menuitem]")) return;
        props.onOpen();
      }}
    >
      <header class="sc-tile-head">
        <Capsule gradient={meta().gradient} size="row" live={cardIsLive(props.card)} />
        <h3 class="sc-tile-title disp">
          <button type="button" aria-current={props.selected || undefined} title={props.card.interestPrompt} onClick={() => props.onOpen()}>
            {props.card.title ?? "New card"}
          </button>
        </h3>
        <span class="sc-state cap">{meta().label}</span>
        <Menu placement="bottom-end">
          <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`${props.card.title ?? "Card"}: actions`}>
            <Ellipsis size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Card actions" width={250}>
            <Menu.Item icon={<RefreshCw size={16} />} disabled={state() === "compiling" || state() === "updating" || updating()} onSelect={props.onUpdate}>
              Update now
            </Menu.Item>
            <Show when={(state() === "compiling" && !setupRunning(props.card)) || state() === "error"}>
              <Menu.Item icon={<Wand2 size={16} />} disabled={settingUp()} description="Rebuilds the query from the prompt" onSelect={props.onSetup}>
                Run setup again
              </Menu.Item>
            </Show>
            <Menu.Item icon={<Settings2 size={16} />} onSelect={() => props.onOpen("settings")}>
              Settings
            </Menu.Item>
            <Menu.Item icon={<ListChecks size={16} />} onSelect={() => props.onOpen("watched")}>
              Watched tasks
            </Menu.Item>
            <Menu.Item icon={<History size={16} />} onSelect={() => props.onOpen("history")}>
              History
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item icon={<Archive size={16} />} onSelect={props.onArchive}>
              Archive
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </header>

      <Switch>
        <Match when={state() === "compiling"}>
          <div class="sc-banner" role="status">
            <Show
              when={setupRunning(props.card)}
              fallback={
                <>
                  <span class="sc-banner-text">
                    <TriangleAlert size={14} aria-hidden="true" /> Setup didn't finish.
                  </span>
                  <Button size="compact" variant="quiet" disabled={settingUp()} onClick={props.onSetup}>
                    {settingUp() ? "Starting…" : "Run setup again"}
                  </Button>
                </>
              }
            >
              <span class="sc-banner-text">The agent is building the query and the first summary.</span>
              <Button size="compact" variant="quiet" onClick={() => props.onOpenTask(props.card.generatingIssueId!)}>
                Setup task
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={state() === "updating"}>
          <div class="sc-banner" role="status">
            <span class="sc-banner-text">{pending() > 0 ? `Folding in ${changes(pending())}…` : "Updating now…"}</span>
            <Button size="compact" variant="quiet" onClick={() => props.onOpenTask(props.card.generatingIssueId!)}>
              Update task
            </Button>
          </div>
        </Match>
        <Match when={state() === "stale"}>
          <div class="sc-banner sc-banner--amber">
            <span class="sc-banner-text">{changes(pending())} since the last update</span>
            <Button size="compact" variant="quiet" disabled={updating()} onClick={props.onUpdate}>
              {updating() ? "Starting…" : "Update"}
            </Button>
          </div>
        </Match>
        <Match when={state() === "error"}>
          <div class="sc-banner sc-banner--red" role="alert">
            <span class="sc-banner-text" title={props.card.failureReason ?? undefined}>
              <TriangleAlert size={14} aria-hidden="true" /> {props.card.queries.length > 0 ? "The last update failed" : "Setup failed"}
            </span>
            {/* Without a built query an update can't run (409), so a failed setup is retried as a setup. */}
            <Show
              when={props.card.queries.length > 0}
              fallback={
                <Button size="compact" variant="quiet" disabled={settingUp()} onClick={props.onSetup}>
                  Run setup again
                </Button>
              }
            >
              <Button size="compact" variant="quiet" disabled={updating()} onClick={props.onUpdate}>
                Retry
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={state() === "paused_budget" || state() === "paused_hours"}>
          <div class="sc-banner">
            <span class="sc-banner-text">{state() === "paused_budget" ? "Daily token cap reached: automatic updates paused" : "Outside active hours: automatic updates paused"}</span>
          </div>
        </Match>
      </Switch>

      <div class="sc-tile-body">
        <Show
          when={summary()}
          fallback={<p class="muted sc-tile-empty">{state() === "compiling" ? `“${props.card.interestPrompt}”` : "No summary yet."}</p>}
        >
          <Show when={state() === "error"}>
            <p class="cap">The last good summary:</p>
          </Show>
          <Markdown source={summary()} class="sc-tile-md" />
        </Show>
      </div>

      <footer class="sc-tile-foot">
        <span class="cap sc-tile-meta">{footer()}</span>
        <Show when={state() === "fresh" || state() === "paused_budget" || state() === "paused_hours"}>
          <Button variant="icon" ghost size="compact" aria-label="Update now" disabled={updating()} onClick={props.onUpdate}>
            <RefreshCw size={14} aria-hidden="true" class={updating() ? "sc-spin" : undefined} />
          </Button>
        </Show>
      </footer>
    </article>
  );
}
