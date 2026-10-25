import { A, useNavigate, useParams, type RouteSectionProps } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { Building2, ChevronDown, LogOut, Moon, Palette, Sun } from "lucide-solid";
import { createEffect, For, Match, Show, Switch } from "solid-js";
import { authApi } from "@/api/auth";
import { Shell } from "@/layout/Shell";
import { CompanyProvider, findCompanyByPrefix, rememberCompany, useCompaniesQuery, useCompany } from "@/lib/company";
import { LiveEventsProvider } from "@/lib/live-events";
import { useSession } from "@/lib/session";
import { theme, toggleTheme } from "@/lib/theme";
import { InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Grain } from "@/ui/Grain";
import { Menu } from "@/ui/Menu";
import { Splash } from "./Splash";
import "@/ui/nav.css";
import "./CompanyLayout.css";

/*
 * `/:companyPrefix/*`: resolves the company from the URL, opens its live-events socket, and draws
 * the shell. The nav here is a stand-in with only company switching, the theme and sign-out; the
 * designed left nav (board 1) is M1.
 */

function CompanySwitcher() {
  const company = useCompany();
  const companies = useCompaniesQuery();
  const navigate = useNavigate();
  return (
    <Menu>
      <Menu.Trigger class="company-switch" aria-label={`Company: ${company().name}. Switch company`}>
        <span class="company-switch-mark grained" aria-hidden="true">
          <InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={28} />
          <Grain />
        </span>
        <span class="company-switch-name disp">{company().name}</span>
        <ChevronDown size={14} aria-hidden="true" class="company-switch-caret" />
      </Menu.Trigger>
      <Menu.Content label="Companies" width={260}>
        <Menu.Group label="Companies">
          <For each={companies.data ?? []}>
            {(item) => (
              <Menu.Item
                onSelect={() => navigate(`/${item.issuePrefix}`)}
                icon={<InitialsDisc name={item.name.slice(0, 1)} seed={item.id} size={22} />}
                hint={item.id === company().id ? "Current" : item.issuePrefix}
              >
                {item.name}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item onSelect={() => navigate("/companies")} icon={<Building2 size={16} />}>
          All companies
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

function YouMenu() {
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const name = () => session.session()?.user.name ?? session.session()?.user.email ?? "You";
  const signOut = async () => {
    await authApi.signOut();
    client.clear();
    navigate("/auth", { replace: true });
  };
  return (
    <div class="nav-you">
      <InitialsDisc name={name()} you size={30} />
      <span class="nav-you-name">{session.isAuthenticatedMode() ? name() : "Local board"}</span>
      <Menu placement="top-end">
        <Menu.Trigger class={buttonClass({ variant: "icon", ghost: true })} aria-label="Account and appearance">
          <Palette size={16} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label="Account and appearance" width={240}>
          <Menu.Item
            onSelect={toggleTheme}
            icon={theme() === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          >
            {theme() === "dark" ? "Use light theme" : "Use dark theme"}
          </Menu.Item>
          <Menu.Item onSelect={() => navigate("/style-guide")} icon={<Palette size={16} />}>
            Style guide
          </Menu.Item>
          <Show when={session.isAuthenticatedMode()}>
            <Menu.Separator />
            <Menu.Item onSelect={() => void signOut()} icon={<LogOut size={16} />}>
              Sign out
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>
    </div>
  );
}

function StandInNav() {
  const company = useCompany();
  return (
    <>
      <CompanySwitcher />
      <div class="nav-group">
        <A class="navi" href={`/${company().issuePrefix}`} end>
          Home
        </A>
      </div>
      <p class="nav-note cap">The full navigation arrives with the shell (M1).</p>
      <YouMenu />
    </>
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
              <Shell nav={<StandInNav />} title={current().name}>
                {props.children}
              </Shell>
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
