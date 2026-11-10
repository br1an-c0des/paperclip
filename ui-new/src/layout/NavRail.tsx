import type { Agent, Project } from "@paperclipai/shared";
import { A, useLocation } from "@solidjs/router";
import { Building2, FolderKanban, Plus, Search } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX, type ParentProps } from "solid-js";
import { unreadMessagesLabel } from "@/chat/chat-model";
import { ChatUnreadBadge } from "@/chat/chat-read";
import { useNeedsYouCount } from "@/inbox/needs-you";
import { agentState } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { useYouName } from "@/lib/session";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Grain } from "@/ui/Grain";
import { Menu } from "@/ui/Menu";
import { ScrollList } from "@/ui/ScrollList";
import { AgentsIcon, InboxIcon, StatusIcon } from "./dock-icons";
import { isOrgPage } from "./dock-model";
import { useCompanyChoices, YouMenuContent } from "./Nav";
import { useNavLists } from "./nav-lists";
import { isProjectPage, showStatusLink } from "./nav-model";
import "@/ui/nav.css";
import "./NavRail.css";

/*
 * The icon rail: the left nav folded to its icons (`[`, the seam's tab, a drag under 200px, or a
 * window narrower than 1100px; nav-model.ts `NavFold`). Direction 2, "Flyout lists", of
 * design/nav-rail-options.html. 68px wide, with these places, top to bottom:
 *
 * - **Company:** the company's disc, a link to its dashboard, raised on every organization page
 *   (`isOrgPage`) as the full nav's company row is. Hovering it for 300ms opens the company card:
 *   the company, then the other companies in your order, All companies, and Create organization
 *   when you may (the company menu's choices, Nav.tsx `useCompanyChoices`). The card can be clicked;
 *   a bridge across the gap keeps it open on the way. Keyboard focus opens it too, and ↓ or →
 *   moves into it; Enter follows the link.
 * - **Search:** opens the ⌘K palette.
 * - **Inbox**, with what's waiting on you as its badge, and **Status** while the instance has
 *   status cards on (`showStatusLink`), as in the full nav.
 * - **Projects** and **Agents**, each opening its list beside the rail: hovering 300ms (hover
 *   intent, so passing over doesn't open it; a bridge, so moving into it keeps it open; it closes
 *   250ms after the pointer leaves both), or a click, Enter or Space. Arrow keys move through it,
 *   Enter follows a row, Escape closes it and gives focus back to the icon. One flyout or card is
 *   open at a time. The lists are the full nav's (nav-lists.ts): starred first, then the rest in
 *   your order (agents running first), with rows keyed by id so a refetch keeps them.
 * - **You**, at the foot: your menu, opening to the right, with Expand sidebar (`[`).
 *
 * The icon owning the current page is raised with the --sel pill (a project's pages and the task
 * lists raise Projects, an agent's pages raise Agents) and the exact page gets `aria-current`. Each
 * icon has a one-line label to its right (NavRail.css): 400ms after the pointer settles, then at
 * once along the rail until 300ms after the pointer leaves it (`data-warm`), and at once on keyboard
 * focus; never while its flyout or card is open. The labels repeat the icons' accessible names, so
 * they're hidden from screen readers.
 *
 * The flyouts leave out plugins, rows' "…" menus and Recent tasks: those stay in the full nav.
 */

/** Hover intent before a flyout or the company card opens, and the grace after the pointer leaves. */
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 250;
/** The first label waits this long; after that they show at once until the pointer has been off the rail this long. */
const LABEL_WARM_MS = 400;
const LABEL_COOL_MS = 300;
/** A lifted flyout keeps this far from the window's edges. */
const EDGE = 12;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const PALETTE_HINT = IS_MAC ? "⌘K" : "Ctrl K";

type PopKey = "company" | "projects" | "agents";
type Pop = { key: PopKey; by: "hover" | "click" | "key" | "focus" };

/** The rail's open flyout or card, the label warmth, and the hover timers they share. */
function createRailPops() {
  const [open, setOpen] = createSignal<Pop | null>(null);
  const [warm, setWarm] = createSignal(false);
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let warmTimer: number | undefined;
  let coolTimer: number | undefined;
  const clearPopTimers = () => {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
  };
  onCleanup(() => {
    clearPopTimers();
    window.clearTimeout(warmTimer);
    window.clearTimeout(coolTimer);
  });

  let quiet = false;

  return {
    open,
    isOpen: (key: PopKey) => open()?.key === key,
    /** Runs `fn` (moving focus back to an icon) without focus opening anything. */
    quietly: (fn: () => void) => {
      quiet = true;
      try {
        fn();
      } finally {
        quiet = false;
      }
    },
    /** Keyboard focus landed on the company disc: its card opens, unless focus was only coming back. */
    focusOpen: (key: PopKey) => {
      if (!quiet) {
        clearPopTimers();
        setOpen({ key, by: "focus" });
      }
    },
    show: (key: PopKey, by: Pop["by"]) => {
      clearPopTimers();
      setOpen({ key, by });
    },
    close: () => {
      clearPopTimers();
      setOpen(null);
    },
    /** The pointer came onto a slot (its icon, the bridge or its flyout). */
    hoverIn: (key: PopKey, event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      // Back on the open one: it stays. Passing over another leaves the open one's close running.
      if (open()?.key === key) return window.clearTimeout(closeTimer);
      window.clearTimeout(openTimer);
      openTimer = window.setTimeout(() => setOpen({ key, by: "hover" }), HOVER_OPEN_MS);
    },
    /** The pointer left the slot: a flyout opened by hovering closes after a moment. */
    hoverOut: (key: PopKey, event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      window.clearTimeout(openTimer);
      const current = open();
      if (current?.key === key && (current.by === "hover" || current.by === "focus")) {
        closeTimer = window.setTimeout(() => setOpen((now) => (now?.key === key ? null : now)), HOVER_CLOSE_MS);
      }
    },
    warm,
    /** A label starts its wait (the first one on the rail), or shows at once while the rail is warm. */
    labelIn: () => {
      window.clearTimeout(coolTimer);
      if (warm()) return;
      window.clearTimeout(warmTimer);
      warmTimer = window.setTimeout(() => setWarm(true), LABEL_WARM_MS);
    },
    labelOut: () => window.clearTimeout(warmTimer),
    railOut: () => {
      window.clearTimeout(warmTimer);
      window.clearTimeout(coolTimer);
      coolTimer = window.setTimeout(() => setWarm(false), LABEL_COOL_MS);
    },
  };
}

type RailPops = ReturnType<typeof createRailPops>;

/** The focusable rows of an open flyout or card, for the arrow keys. */
function focusables(panel: HTMLElement | undefined) {
  return panel ? [...panel.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")] : [];
}

function moveFocus(panel: HTMLElement | undefined, event: KeyboardEvent) {
  const items = focusables(panel);
  if (!items.length) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown" ? (at + 1) % items.length
    : event.key === "ArrowUp" ? (at <= 0 ? items.length - 1 : at - 1)
    : event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : null;
  if (next === null) return false;
  event.preventDefault();
  items[next]!.focus();
  return true;
}

function isFocusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * One place on the rail: the icon, its label, and the flyout or card it opens. The slot is the hover
 * area: the icon, the bridge across the gap while something is open (NavRail.css) and the panel.
 */
function RailSlot(
  props: ParentProps<{
    pops: RailPops;
    /** The label beside the icon. */
    label: JSX.Element;
    big?: boolean;
    /** What it opens, if anything. */
    pop?: PopKey;
    panel?: (ref: (el: HTMLElement) => void) => JSX.Element;
    class?: string;
  }>,
) {
  let slot: HTMLDivElement | undefined;
  let panel: HTMLElement | undefined;
  const isOpen = () => !!props.pop && props.pops.isOpen(props.pop);
  const trigger = () => slot?.querySelector<HTMLElement>(":scope > .rail-i");

  const closeTo = (focusIcon: boolean) => {
    props.pops.close();
    // Back on the icon without opening again (the company card opens on keyboard focus).
    if (focusIcon) props.pops.quietly(() => trigger()?.focus());
  };

  // While open: a press outside closes it, and so does focus going elsewhere.
  createEffect(
    on(isOpen, (open) => {
      if (!open) return;
      const onDown = (event: PointerEvent) => {
        if (slot && !slot.contains(event.target as Node)) props.pops.close();
      };
      document.addEventListener("pointerdown", onDown, true);
      onCleanup(() => document.removeEventListener("pointerdown", onDown, true));
      // Opened from the keyboard: the first row takes focus. Lifted to stay in the window.
      requestAnimationFrame(() => {
        if (!panel || !isOpen()) return;
        panel.style.removeProperty("--lift");
        const rect = panel.getBoundingClientRect();
        const over = rect.bottom - (window.innerHeight - EDGE);
        if (over > 0) panel.style.setProperty("--lift", `${-Math.min(over, Math.max(0, rect.top - EDGE))}px`);
        if (props.pops.open()?.by === "key") (panel.querySelector<HTMLElement>(".rail-row") ?? focusables(panel)[0])?.focus();
      });
    }),
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (!props.pop) return;
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      return closeTo(true);
    }
    const inPanel = !!panel && panel.contains(event.target as Node);
    if (inPanel) {
      // ← goes back to the icon, as Escape does; the other arrows, Home and End move through it.
      if (event.key === "ArrowLeft" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        return closeTo(true);
      }
      moveFocus(panel, event);
      return;
    }
    if (event.target === trigger() && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (isOpen()) (panel?.querySelector<HTMLElement>(".rail-row") ?? focusables(panel)[0])?.focus();
      else props.pops.show(props.pop, "key");
    }
  };

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (isOpen() && next && slot && !slot.contains(next)) props.pops.close();
  };

  return (
    <div
      ref={slot}
      class={`rail-w ${props.class ?? ""}`}
      classList={{ "rail-w--big": props.big }}
      data-open={isOpen() ? "" : undefined}
      onPointerEnter={(event) => {
        props.pops.labelIn();
        if (props.pop) props.pops.hoverIn(props.pop, event);
      }}
      onPointerLeave={(event) => {
        props.pops.labelOut();
        if (props.pop) props.pops.hoverOut(props.pop, event);
      }}
      onKeyDown={onKeyDown}
      onFocusOut={onFocusOut}
    >
      {props.children}
      <span class="rail-tip" aria-hidden="true">
        {props.label}
      </span>
      <Show when={isOpen() && props.panel}>{props.panel!((el) => (panel = el))}</Show>
    </div>
  );
}

export function NavRail() {
  const company = useCompany();
  const commands = useCommands();
  const location = useLocation();
  const needsYou = useNeedsYouCount();
  const experimental = useExperimentalSettingsQuery();
  const lists = useNavLists();
  const pops = createRailPops();
  const youName = useYouName();

  const base = () => `/${company().issuePrefix}`;
  const inboxCount = () => needsYou() ?? 0;
  const unread = () => lists.unreadChats.messages();
  const path = () => location.pathname.toLowerCase();
  const under = (segment: string) => path() === `${base().toLowerCase()}/${segment}` || path().startsWith(`${base().toLowerCase()}/${segment}/`);
  const orgPage = () => isOrgPage(location.pathname, company().issuePrefix);
  // Projects owns the projects pages and the task lists (All tasks is in its flyout); Agents owns an
  // agent's own pages (the roster is an organization page, so the company is raised there).
  const onProjects = () => under("projects") || under("issues");
  const onAgents = () => under("agents") && !orgPage();

  // Moving to another page closes whatever is open.
  createEffect(on(() => location.pathname, () => pops.close(), { defer: true }));

  const agentsLabel = () =>
    ["Agents", lists.runningCount() > 0 ? `${lists.runningCount()} running` : null, unread() > 0 ? unreadMessagesLabel(unread()) : null].filter(Boolean).join(", ");

  /** A click (or Enter or Space) on Projects or Agents: open it, keep one opened by hovering, or close it. */
  const toggle = (key: PopKey, event: MouseEvent) => {
    const current = pops.open();
    const byKey = event.detail === 0;
    if (current?.key === key && current.by === "hover" && !byKey) return pops.show(key, "click");
    if (current?.key === key) return pops.close();
    pops.show(key, byKey ? "key" : "click");
  };

  return (
    <div class="nav-rail" data-warm={pops.warm() ? "" : undefined} onPointerLeave={pops.railOut}>
      <RailSlot pops={pops} big pop="company" label={<b>{company().name}</b>} class="rail-w--company" panel={(ref) => <CompanyCard ref={ref} onPick={pops.close} />}>
        <A
          class="rail-i rail-i--big"
          classList={{ sel: orgPage() }}
          href={`${base()}/dashboard`}
          activeClass="rail-active"
          aria-label={`${company().name}: dashboard`}
          aria-haspopup="dialog"
          aria-expanded={pops.isOpen("company")}
          onFocus={(event) => {
            if (isFocusVisible(event.currentTarget)) pops.focusOpen("company");
          }}
        >
          <span class="company-mark grained" aria-hidden="true">
            <InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={28} />
            <Grain />
          </span>
        </A>
      </RailSlot>
      <div class="rail-gap rail-gap--tools" />
      <RailSlot
        pops={pops}
        label={
          <>
            <b>Search</b>
            <kbd class="rail-kbd">{PALETTE_HINT}</kbd>
          </>
        }
      >
        <button type="button" class="rail-i rail-i--search" aria-label="Search and commands" aria-keyshortcuts="Control+K Meta+K" onClick={() => commands.setPaletteOpen(true)}>
          <Search size={17} aria-hidden="true" />
        </button>
      </RailSlot>
      <div class="rail-gap rail-gap--group" />
      <RailSlot
        pops={pops}
        label={
          <>
            <b>Inbox</b>
            <Show when={inboxCount() > 0}>
              <span class="rail-tip-note">{inboxCount()} waiting</span>
            </Show>
            <kbd class="rail-kbd">G</kbd>
            <kbd class="rail-kbd">I</kbd>
          </>
        }
      >
        <A class="rail-i" href={`${base()}/inbox`} activeClass="sel" aria-label={inboxCount() > 0 ? `Inbox, ${inboxCount()} waiting` : "Inbox"}>
          <InboxIcon />
          <Show when={inboxCount() > 0}>
            <span class="rail-badge" aria-hidden="true">
              {inboxCount() > 99 ? "99+" : inboxCount()}
            </span>
          </Show>
        </A>
      </RailSlot>
      <Show when={showStatusLink(experimental.data)}>
        <div class="rail-gap rail-gap--row" />
        <RailSlot pops={pops} label={<b>Status</b>}>
          <A class="rail-i" href={`${base()}/status`} activeClass="sel" aria-label="Status">
            <StatusIcon />
          </A>
        </RailSlot>
      </Show>
      <div class="rail-sep" role="presentation" />
      <RailSlot
        pops={pops}
        pop="projects"
        label={
          <>
            <b>Projects</b>
            <span class="rail-tip-note">
              {lists.shownProjects().length} {lists.shownProjects().length === 1 ? "project" : "projects"}
            </span>
          </>
        }
        panel={(ref) => <ProjectsFlyout ref={ref} lists={lists} base={base()} onPick={pops.close} onNew={() => {
          pops.close();
          commands.openNewProject();
        }} />}
      >
        <button
          type="button"
          class="rail-i"
          classList={{ sel: onProjects() }}
          aria-label="Projects"
          aria-haspopup="dialog"
          aria-expanded={pops.isOpen("projects")}
          onClick={(event) => toggle("projects", event)}
        >
          <FolderKanban size={19} stroke-width={1.8} aria-hidden="true" />
        </button>
      </RailSlot>
      <div class="rail-gap rail-gap--row" />
      <RailSlot
        pops={pops}
        pop="agents"
        label={
          <>
            <b>Agents</b>
            <Show when={lists.runningCount() > 0}>
              <span class="rail-tip-note rail-tip-note--run">{lists.runningCount()} running</span>
            </Show>
          </>
        }
        panel={(ref) => <AgentsFlyout ref={ref} lists={lists} base={base()} onPick={pops.close} />}
      >
        <button
          type="button"
          class="rail-i"
          classList={{ sel: onAgents(), "rail-i--ringed": lists.runningCount() > 0 }}
          aria-label={agentsLabel()}
          aria-haspopup="dialog"
          aria-expanded={pops.isOpen("agents")}
          onClick={(event) => toggle("agents", event)}
        >
          <AgentsIcon />
          <Show when={unread() > 0}>
            <span class="rail-unread" aria-hidden="true">
              <ChatUnreadBadge count={unread()} />
            </span>
          </Show>
        </button>
      </RailSlot>
      <div class="rail-push" />
      <RailSlot
        pops={pops}
        big
        class="rail-w--you"
        label={
          <>
            <b>{youName()}</b>
            <span class="rail-tip-note">Account and appearance</span>
          </>
        }
      >
        <Menu placement="right-end" gutter={23} onOpenChange={(next) => next && pops.close()}>
          <Menu.Trigger class="rail-i rail-i--big" aria-label={`${youName()}: account and appearance`}>
            <InitialsDisc name={youName()} you size={30} />
          </Menu.Trigger>
          <YouMenuContent rail />
        </Menu>
      </RailSlot>
    </div>
  );
}

/** The company card: the company and its dashboard, the other companies, All companies, Create organization. */
function CompanyCard(props: { ref: (el: HTMLElement) => void; onPick: () => void }) {
  const company = useCompany();
  const choices = useCompanyChoices();
  const others = () => choices.ordered().filter((item) => item.id !== company().id);
  return (
    <div ref={props.ref} class="rail-pop rail-card" role="dialog" aria-label={company().name}>
      <A class="rail-card-top" href={`/${company().issuePrefix}/dashboard`} onClick={props.onPick}>
        <span class="company-mark grained" aria-hidden="true">
          <InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={30} />
          <Grain />
        </span>
        <span class="rail-card-text">
          <span class="rail-card-name disp">{company().name}</span>
          <span class="rail-card-note">
            Dashboard <kbd class="rail-kbd">G</kbd>
            <kbd class="rail-kbd">D</kbd>
          </span>
        </span>
      </A>
      <Show when={others().length > 0}>
        <div class="rail-pop-head">Switch company</div>
        <For each={others()}>
          {(item) => (
            <A class="rail-row" href={`/${item.issuePrefix}`} onClick={props.onPick}>
              <InitialsDisc name={item.name.slice(0, 1)} seed={item.id} size={22} />
              <span class="rail-row-label">{item.name}</span>
              <span class="rail-row-hint">{item.issuePrefix}</span>
            </A>
          )}
        </For>
      </Show>
      <div class="rail-pop-sep" role="presentation" />
      <A class="rail-row" href="/companies" onClick={props.onPick}>
        <span class="rail-row-icon">
          <Building2 size={16} aria-hidden="true" />
        </span>
        <span class="rail-row-label">All companies</span>
      </A>
      <Show when={choices.canCreate()}>
        <A class="rail-row" href="/onboarding" onClick={props.onPick}>
          <span class="rail-row-icon">
            <Plus size={16} aria-hidden="true" />
          </span>
          <span class="rail-row-label">Create organization</span>
        </A>
      </Show>
    </div>
  );
}

type Lists = ReturnType<typeof useNavLists>;

/** Projects beside the rail: starred first, then the rest in your order, with their task counts. */
function ProjectsFlyout(props: { ref: (el: HTMLElement) => void; lists: Lists; base: string; onPick: () => void; onNew: () => void }) {
  const row = (id: string) => {
    const project = props.lists.latestProject(id);
    return <Show when={project()}>{(current) => <ProjectRow project={current()} base={props.base} onPick={props.onPick} />}</Show>;
  };
  const starred = () => props.lists.starredProjectIds().length > 0;
  return (
    <div ref={props.ref} class="rail-pop rail-fly" role="dialog" aria-label="Projects">
      <div class="rail-fly-head">
        <h2 class="disp">Projects</h2>
        <button type="button" class="rail-fly-add" aria-label="New project" onClick={props.onNew}>
          <Plus size={15} stroke-width={2.2} aria-hidden="true" />
        </button>
      </div>
      <ScrollList class="rail-fly-list">
        <Show when={props.lists.projectsArranged()} fallback={<p class="rail-fly-empty">Loading…</p>}>
          <Show when={starred()}>
            <div class="rail-pop-head">Starred</div>
            <For each={props.lists.starredProjectIds()}>{row}</For>
            <Show when={props.lists.otherProjectIds().length > 0}>
              <div class="rail-pop-head">Your projects</div>
            </Show>
          </Show>
          <For each={props.lists.otherProjectIds()} fallback={<Show when={!starred()}><p class="rail-fly-empty">No projects yet.</p></Show>}>
            {row}
          </For>
        </Show>
      </ScrollList>
      <div class="rail-pop-sep" role="presentation" />
      <div class="rail-fly-foot">
        <A href={`${props.base}/projects`} end onClick={props.onPick}>
          All projects
        </A>
        <A href={`${props.base}/issues`} end onClick={props.onPick}>
          All tasks
        </A>
      </div>
    </div>
  );
}

function ProjectRow(props: { project: Project; base: string; onPick: () => void }) {
  const location = useLocation();
  const onProject = () => isProjectPage(location.pathname, props.base.slice(1), props.project);
  return (
    <A class="rail-row" href={`${props.base}/projects/${props.project.urlKey}/issues`} classList={{ "rail-row--here": onProject() }} onClick={props.onPick}>
      <InitialsDisc name={props.project.name.slice(0, 1)} seed={props.project.id} size={24} />
      <span class="rail-row-label">{props.project.name}</span>
      <Show when={props.project.taskCount !== undefined}>
        <span class="rail-row-count" aria-label={`${props.project.taskCount} tasks`}>
          {props.project.taskCount}
        </span>
      </Show>
    </A>
  );
}

/** Agents beside the rail: starred first, then the rest, running first, with their states and unread replies. */
function AgentsFlyout(props: { ref: (el: HTMLElement) => void; lists: Lists; base: string; onPick: () => void }) {
  const row = (id: string) => {
    const agent = props.lists.latestAgent(id);
    return (
      <Show when={agent()}>
        {(current) => <AgentRow agent={current()} base={props.base} running={props.lists.running()} unread={props.lists.unreadChats.countFor(id)} onPick={props.onPick} />}
      </Show>
    );
  };
  const starred = () => props.lists.starredAgentIds().length > 0;
  return (
    <div ref={props.ref} class="rail-pop rail-fly" role="dialog" aria-label="Agents">
      <div class="rail-fly-head">
        <h2 class="disp">Agents</h2>
        <Show when={props.lists.runningCount() > 0}>
          <span class="rail-fly-note">{props.lists.runningCount()} running</span>
        </Show>
      </div>
      <ScrollList class="rail-fly-list">
        <Show when={starred()}>
          <div class="rail-pop-head">Starred</div>
          <For each={props.lists.starredAgentIds()}>{row}</For>
          <Show when={props.lists.otherAgentIds().length > 0}>
            <div class="rail-pop-head">Your agents</div>
          </Show>
        </Show>
        <For each={props.lists.otherAgentIds()} fallback={<Show when={props.lists.navAgents().length === 0}><p class="rail-fly-empty">No agents yet.</p></Show>}>
          {row}
        </For>
      </ScrollList>
      <div class="rail-pop-sep" role="presentation" />
      <div class="rail-fly-foot">
        <A href={`${props.base}/agents`} end onClick={props.onPick}>
          All agents
        </A>
      </div>
    </div>
  );
}

function AgentRow(props: { agent: Agent; base: string; running: ReadonlySet<string>; unread: number; onPick: () => void }) {
  const state = () => agentState(props.agent, props.running);
  return (
    <A class="rail-row rail-row--agent" href={`${props.base}/agents/${props.agent.urlKey}`} onClick={props.onPick}>
      <AgentAvatar agent={props.agent} size={24} ring={state().key === "running"} />
      <span class="rail-row-label">{props.agent.name}</span>
      <Show when={props.unread > 0}>
        <ChatUnreadBadge count={props.unread} from={props.agent.name} />
      </Show>
      <span class="rail-row-state" style={{ color: state().tone }}>
        {state().label}
      </span>
    </A>
  );
}
