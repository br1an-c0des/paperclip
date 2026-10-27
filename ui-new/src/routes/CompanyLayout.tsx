import { A, useNavigate, useParams, type RouteSectionProps } from "@solidjs/router";
import { createEffect, Match, Switch, type ParentProps } from "solid-js";
import { Nav } from "@/layout/Nav";
import { Shell } from "@/layout/Shell";
import { CommandsProvider, useCommands } from "@/lib/commands";
import { CompanyProvider, findCompanyByPrefix, rememberCompany, useCompaniesQuery, useCompany } from "@/lib/company";
import { LiveEventsProvider } from "@/lib/live-events";
import { useLiveToasts } from "@/lib/live-toasts";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { RunModal } from "@/runs/RunModal";
import { CommandPalette } from "@/shell/CommandPalette";
import { ShortcutsDialog } from "@/shell/ShortcutsDialog";
import { NewTaskDialog } from "@/tasks/NewTaskDialog";
import { GlobalTaskModal } from "@/tasks/TaskModal";
import { buttonClass } from "@/ui/Button";
import { Splash } from "./Splash";

/*
 * `/:companyPrefix/*`: resolves the company from the URL, opens its live-events socket, and draws
 * the shell: the nav, and the dialogs any page can open (new task, command palette, shortcuts, the
 * task modal for pages without a list, and the run modal).
 */

/** The parts of the shell that need the company and the commands: shortcuts, toasts, dialogs. */
function CompanyShell(props: ParentProps) {
  const company = useCompany();
  const commands = useCommands();
  const navigate = useNavigate();

  useLiveToasts();
  useGlobalShortcuts((action) => {
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
    }
  });

  return (
    <Shell nav={<Nav />} title={company().name}>
      {props.children}
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
