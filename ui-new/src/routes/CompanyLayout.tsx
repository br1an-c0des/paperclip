import { A, useLocation, useNavigate, useParams, useSearchParams, type RouteSectionProps } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { ChevronLeft, Monitor } from "lucide-solid";
import { createEffect, createSignal, Match, Show, Switch, type ParentProps } from "solid-js";
import { inboxApi } from "@/api/inbox";
import { queryKeys } from "@/api/queryKeys";
import { isCompact } from "@/layout/breakpoints";
import { desktopArea, detailParent, isDetailPage } from "@/layout/dock-model";
import { navHidden, setNavHidden, useOpenTask, useRecordRecentTasks } from "@/layout/nav-prefs";
import { Nav } from "@/layout/Nav";
import { PhoneDock } from "@/layout/PhoneDock";
import { Shell } from "@/layout/Shell";
import { CommandsProvider, useCommands } from "@/lib/commands";
import { CompanyProvider, findCompanyByPrefix, rememberCompany, useCompaniesQuery, useCompany } from "@/lib/company";
import { LiveEventsProvider } from "@/lib/live-events";
import { useLiveToasts } from "@/lib/live-toasts";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { RunModal } from "@/runs/RunModal";
import { AppShellOverlays } from "@/plugins/ShellPlugins";
import { Announcements } from "@/shell/Announcements";
import { CommandPalette } from "@/shell/CommandPalette";
import { DevBanners } from "@/shell/DevBanners";
import { PhoneTopBar } from "@/shell/pwa";
import { ShortcutsDialog } from "@/shell/ShortcutsDialog";
import { NewTaskDialog } from "@/tasks/NewTaskDialog";
import { GlobalTaskModal } from "@/tasks/TaskModal";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { Splash } from "./Splash";
import "./CompanyLayout.css";

/*
 * `/:companyPrefix/*`: resolves the company from the URL, opens its live-events socket, and draws
 * the shell: the nav (the dock on a phone), and the dialogs any page can open (new task, command
 * palette, shortcuts, the task modal for pages without a list, and the run modal). Around every
 * page: the development banners at the top of main, Paperclip's announcement card, and plugins'
 * app-shell overlays.
 *
 * On a phone: detail pages (a task, an agent, a run, an approval) hide the dock and show Back
 * instead (design/mobile.md, M2, M9 and M11); screens outside the phone's scope (settings, Apps,
 * Skills, Activity) open under an "On desktop" note; the installed app gets Refresh, Share and Open
 * in browser at the top (shell/pwa.tsx).
 *
 * The task the page has open (its page, or a list's panel) is recorded in the nav's recent tasks,
 * and the task keys act on it: `y` archives it from your inbox, `g c` goes to its comment box, `]`
 * closes the panel and opens it again.
 */

/** The parts of the shell that need the company and the commands: shortcuts, toasts, dialogs. */
function CompanyShell(props: ParentProps) {
  const company = useCompany();
  const commands = useCommands();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const [search, setSearch] = useSearchParams<{ task?: string; section?: string }>();
  const openTask = useOpenTask();
  useRecordRecentTasks(openTask);

  const fullTaskPage = () => !search.task && isDetailPage(location.pathname, company().issuePrefix) && /\/issues\//.test(location.pathname);
  // `]` remembers the panel it closed on this page, to open it again.
  const [closedPanel, setClosedPanel] = createSignal<{ path: string; task: string; section?: string } | null>(null);
  const togglePanel = () => {
    if (search.task) {
      setClosedPanel({ path: location.pathname, task: search.task, section: search.section });
      setSearch({ task: undefined, section: undefined });
      return;
    }
    const closed = closedPanel();
    if (closed && closed.path === location.pathname) setSearch({ task: closed.task, section: closed.section });
  };

  const archiveOpenTask = () => {
    const task = openTask();
    if (!task) return;
    const refresh = () => {
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.inbox.attention(company().id) });
    };
    const label = task.identifier ? `${task.identifier} ${task.title}` : task.title;
    inboxApi
      .archive(task.id)
      .then(() => {
        refresh();
        pushToast({
          dedupeKey: `inbox-archive-${task.id}`,
          title: "Archived from your inbox",
          body: label,
          tone: "info",
          ttlMs: 8000,
          action: { label: "Undo", onClick: () => void inboxApi.unarchive(task.id).then(refresh) },
        });
        if (fullTaskPage()) navigate(`/${company().issuePrefix}/inbox`);
        else setSearch({ task: undefined, section: undefined });
      })
      .catch((error: Error) => pushToast({ tone: "error", title: "Couldn't archive it from your inbox", body: error.message }));
  };

  const focusComposer = () => {
    if (search.section !== "activity") setSearch({ section: "activity" }, { replace: true });
    // The thread mounts its composer once Activity shows; wait for it a moment.
    let tries = 0;
    const attempt = () => {
      const field = document.querySelector<HTMLTextAreaElement>("main .cmp-text");
      if (field) return field.focus();
      if (++tries < 40) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };

  useLiveToasts();
  useGlobalShortcuts(
    (action) => {
      const base = `/${company().issuePrefix}`;
      switch (action) {
        case "palette":
          // Cmd/Ctrl+K works from fields too, but not over the new-task dialog.
          if (!commands.newTask()) commands.setPaletteOpen(!commands.paletteOpen());
          return;
        case "search":
          return commands.setPaletteOpen(true);
        case "new-task":
          return commands.openNewTask();
        case "cheatsheet":
          return commands.setShortcutsOpen(true);
        case "go-inbox":
          return navigate(`${base}/inbox`);
        case "go-dashboard":
          return navigate(`${base}/dashboard`);
        case "toggle-nav":
          if (!isCompact()) setNavHidden(!navHidden());
          return;
        case "toggle-panel":
          return togglePanel();
        case "archive-task":
          return archiveOpenTask();
        case "focus-composer":
          return focusComposer();
      }
    },
    () => ({
      taskOpen: !!openTask(),
      panelToggle: !!search.task || closedPanel()?.path === location.pathname,
    }),
  );

  const detail = () => isCompact() && isDetailPage(location.pathname, company().issuePrefix);
  const desktopOnly = () => (isCompact() ? desktopArea(location.pathname, company().issuePrefix) : null);
  const back = () => {
    if (window.history.length > 1) window.history.back();
    else navigate(detailParent(location.pathname, company().issuePrefix));
  };

  return (
    <Shell nav={<Nav />} dock={<Show when={!detail()}><PhoneDock /></Show>} navHidden={navHidden()} onShowNav={() => setNavHidden(false)} noDock={detail()}>
      <PhoneTopBar
        showLead={detail()}
        lead={
          <button type="button" class={`${buttonClass({ variant: "quiet", size: "compact" })} phone-back`} onClick={back}>
            <ChevronLeft size={16} aria-hidden="true" />
            Back
          </button>
        }
      />
      <DevBanners />
      <Show when={desktopOnly()}>
        {(area) => (
          <p class="card on-desktop" role="note">
            <Monitor size={16} aria-hidden="true" />
            <span>
              <b>On desktop.</b> {area()} {area().endsWith("s") ? "are" : "is"} made for a bigger screen; you can look around here, but changes are easier on desktop.
            </span>
          </p>
        )}
      </Show>
      {props.children}
      <Announcements />
      <AppShellOverlays />
      <CommandPalette />
      <ShortcutsDialog />
      <NewTaskDialog />
      <GlobalTaskModal />
      <RunModal />
    </Shell>
  );
}

export function CompanyLayout(props: RouteSectionProps) {
  const params = useParams<{ companyPrefix: string }>();
  const companies = useCompaniesQuery();
  const company = () => findCompanyByPrefix(companies.data, params.companyPrefix);

  createEffect(() => {
    const current = company();
    if (current) rememberCompany(current.issuePrefix);
  });

  return (
    <Switch>
      <Match when={companies.isLoading}>
        <Splash title="Loading" quiet />
      </Match>
      <Match when={companies.error}>
        {(error) => <Splash title="Couldn't load companies">{(error() as Error).message}</Splash>}
      </Match>
      <Match when={company()}>
        {(current) => (
          <CompanyProvider company={current()}>
            <LiveEventsProvider companyId={current().id}>
              <CommandsProvider>
                <CompanyShell>{props.children}</CompanyShell>
              </CommandsProvider>
            </LiveEventsProvider>
          </CompanyProvider>
        )}
      </Match>
      <Match when={!company()}>
        <Splash
          title="No such company"
          actions={
            <A class={buttonClass({ variant: "primary", size: "compact" })} href="/companies">
              See your companies
            </A>
          }
        >
          There's no company with the prefix "{params.companyPrefix}", or you can't open it.
        </Splash>
      </Match>
    </Switch>
  );
}
