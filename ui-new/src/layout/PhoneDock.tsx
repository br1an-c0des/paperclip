import { useLocation, useNavigate } from "@solidjs/router";
import { ChevronUp, Plus } from "lucide-solid";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { activeAgents } from "@/api/agents";
import { agentState, runningAgentIds } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useNeedsYouCount } from "@/inbox/needs-you";
import { useAgentsQuery, useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { dockHiddenAfterScroll, dockPlace, tapTasks, tasksScope, type SheetView } from "./dock-model";
import { AgentsIcon, InboxIcon, TasksIcon } from "./dock-icons";
import { TasksSheet } from "./TasksSheet";
import "./PhoneDock.css";

/*
 * The phone's navigation (design/mobile.md, N1, "Floating dock"): one pill at the foot of the
 * screen with Inbox (and its count), Tasks and Agents, and a 56px New task button beside it. Only
 * the current place shows its label; the others are icons with their name for screen readers. The
 * dock slides away while you scroll down and comes back when you scroll up, or when it has focus.
 *
 * Tapping Tasks again while in Tasks opens the switcher sheet (TasksSheet.tsx): projects, the
 * company dropdown and You. The sheet sits under the dock, so Tasks also closes it.
 */

export function PhoneDock() {
  const company = useCompany();
  const commands = useCommands();
  const location = useLocation();
  const navigate = useNavigate();
  const needsYou = useNeedsYouCount();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const projects = useProjectsQuery();

  const base = () => `/${company().issuePrefix}`;
  const place = () => dockPlace(location.pathname, company().issuePrefix);
  const scope = () => tasksScope(location.pathname, company().issuePrefix);
  const scopeProject = createMemo(() => {
    const current = scope();
    if (current?.kind !== "project") return undefined;
    return projects.data?.find((project) => project.urlKey === current.key || project.id === current.key);
  });

  const inboxCount = () => needsYou() ?? 0;
  const running = createMemo(() => {
    const ids = runningAgentIds(liveRuns.data);
    return activeAgents(agents.data).filter((agent) => agentState(agent, ids).key === "running").length;
  });

  // Tasks takes you back to the task list you last had open in this company.
  const [lastTasks, setLastTasks] = createSignal<string | null>(null);
  const tasksHref = () => {
    const last = lastTasks();
    return last && last.toLowerCase().startsWith(`${base().toLowerCase()}/`) ? last : `${base()}/issues`;
  };

  const [sheet, setSheet] = createSignal<SheetView>("closed");
  const [scrollHidden, setScrollHidden] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const hidden = () => scrollHidden() && sheet() === "closed" && !focused();

  createEffect(
    on(
      () => location.pathname + location.search,
      () => {
        if (scope()) setLastTasks(location.pathname + location.search);
      },
    ),
  );
  // Moving to another page closes the sheet and brings the dock back.
  createEffect(
    on(
      () => location.pathname,
      () => {
        setSheet("closed");
        setScrollHidden(false);
      },
      { defer: true },
    ),
  );

  onMount(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setScrollHidden((was) => dockHiddenAfterScroll(lastY, y, was));
        lastY = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    });
  });

  // The page under an open sheet doesn't scroll.
  createEffect(() => {
    if (sheet() === "closed") return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    onCleanup(() => {
      root.style.overflow = previous;
    });
  });

  let tasksButton: HTMLButtonElement | undefined;
  const closeSheet = (returnFocus = true) => {
    setSheet("closed");
    if (returnFocus) tasksButton?.focus({ preventScroll: true });
  };

  // Tasks is a link from elsewhere (to tasksHref) and this button once you're in Tasks.
  const onTasks = () => {
    const next = tapTasks(place(), sheet());
    if (next.navigate) navigate(tasksHref());
    else setSheet(next.sheet);
  };

  const newTask = () => {
    setSheet("closed");
    commands.openNewTask(scopeProject() ? { projectId: scopeProject()!.id } : {});
  };

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) setFocused(false);
  };

  return (
    <div
      class="pdock"
      data-hidden={hidden() ? "" : undefined}
      data-sheet={sheet() !== "closed" ? "" : undefined}
      // Keyboard focus keeps the dock in view; a tap focuses its buttons too, but shouldn't pin it.
      onFocusIn={(event) => setFocused(event.target instanceof Element && event.target.matches(":focus-visible"))}
      onFocusOut={onFocusOut}
    >
      <Show when={sheet() !== "closed"}>
        <TasksSheet
          id="pdock-sheet"
          view={sheet() as Exclude<SheetView, "closed">}
          onView={setSheet}
          onClose={closeSheet}
          scope={scope()}
        />
      </Show>
      <div class="pdock-bar">
        <nav class="pdock-pill" aria-label="Main">
          <a
            class="pdock-item"
            href={`${base()}/inbox`}
            aria-current={place() === "inbox" ? "page" : undefined}
            aria-label={inboxCount() > 0 ? `Inbox, ${inboxCount()} need you` : "Inbox"}
          >
            <InboxIcon />
            <Show when={place() === "inbox"}>
              <span class="pdock-label">Inbox</span>
            </Show>
            <Show when={inboxCount() > 0}>
              <span class="pdock-badge" aria-hidden="true">
                {inboxCount() > 99 ? "99+" : inboxCount()}
              </span>
            </Show>
          </a>
          <Show
            when={place() === "tasks"}
            fallback={
              <a class="pdock-item" href={tasksHref()} aria-label="Tasks">
                <TasksIcon />
              </a>
            }
          >
            <button
              ref={tasksButton}
              type="button"
              class="pdock-item"
              aria-current="page"
              aria-haspopup="dialog"
              aria-expanded={sheet() !== "closed"}
              aria-controls={sheet() !== "closed" ? "pdock-sheet" : undefined}
              onClick={onTasks}
            >
              <Show
                when={sheet() !== "closed"}
                fallback={
                  <>
                    <TasksIcon />
                    <span class="pdock-label">Tasks</span>
                  </>
                }
              >
                <Show when={scopeProject()} fallback={<TasksIcon />}>
                  {(project) => <InitialsDisc name={project().name.slice(0, 1)} seed={project().id} size={22} />}
                </Show>
                <span class="pdock-label pdock-label--scope">{scopeProject()?.name ?? (scope() ? "All tasks" : "Tasks")}</span>
                <ChevronUp size={12} stroke-width={2.4} aria-hidden="true" class="pdock-caret" />
              </Show>
            </button>
          </Show>
          <a
            class="pdock-item"
            href={`${base()}/agents`}
            aria-current={place() === "agents" ? "page" : undefined}
            aria-label={running() > 0 ? `Agents, ${running()} running` : "Agents"}
          >
            <AgentsIcon />
            <Show when={place() === "agents"}>
              <span class="pdock-label">Agents</span>
            </Show>
            <Show when={running() > 0}>
              <span class="pdock-live live" aria-hidden="true" />
            </Show>
          </a>
        </nav>
        <button type="button" class="pdock-new" aria-label="New task" aria-keyshortcuts="C" onClick={newTask}>
          <Plus size={22} stroke-width={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
