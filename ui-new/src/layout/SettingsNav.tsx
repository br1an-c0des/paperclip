import { A, useLocation } from "@solidjs/router";
import {
  ArrowLeft,
  ArrowLeftRight,
  Building2,
  Cable,
  Cpu,
  KeyRound,
  Puzzle,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  Wallet,
} from "lucide-solid";
import { createEffect, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { useCompany } from "@/lib/company";
import { useAppSettingsSections } from "@/settings/app/app-sections";
import { useCompanySettingsSections } from "@/settings/company/company-sections";
import type { SettingsEntry } from "@/settings/SettingsBody";
import { InitialsDisc } from "@/ui/Avatar";
import { Nav } from "./Nav";
import { backToAppHref, nextAppPath, settingsArea, type SettingsArea } from "./settings-nav-model";
import "@/ui/nav.css";
import "./SettingsNav.css";

/*
 * The settings sidebar: in App settings and Company settings it takes the left nav's place, in the
 * same shell slot, so it keeps the nav's width, its resize handle and its hiding (Shell.tsx). It has
 * no icon rail: it shows at full width even while the main nav is folded to the rail, and there
 * `[` and Shift+`[` hide and show it instead (routes/CompanyLayout.tsx).
 * `ShellNav` picks it or the main nav from the address (settings-nav-model.ts), for CompanyLayout.
 *
 * At the top, Back to app returns to the last page you had open outside settings
 * (`useRememberAppPath`, kept in memory), or the dashboard. Under it the area's title and mark,
 * then its sections as the nav's `.navi` rows, under their headings: the router raises the current
 * section with the --sel pill and marks it `aria-current="page"`. The rows come from the same list
 * the page uses (settings/app/app-sections.ts, settings/company/company-sections.ts), so permission
 * and `PAPERCLIP_HIDDEN_SETTINGS` gates and plugins' settings pages show here exactly as there.
 *
 * Phones have no nav at all (the dock instead), so they never see this; the settings pages keep
 * their own section rail there (settings/SettingsBody.tsx).
 */

const [appPath, setAppPath] = createSignal<string | null>(null);

/** Remembers each page you open outside settings, for Back to app. Call once, from the shell. */
export function useRememberAppPath() {
  const location = useLocation();
  const company = useCompany();
  createEffect(() => {
    const place = { pathname: location.pathname, search: location.search, hash: location.hash };
    const prefix = company().issuePrefix;
    setAppPath((previous) => nextAppPath(previous, place, prefix));
  });
}

const ICONS: Record<string, () => JSX.Element> = {
  // App settings
  account: () => <UserRound size={16} aria-hidden="true" />,
  organizations: () => <Building2 size={16} aria-hidden="true" />,
  admins: () => <ShieldCheck size={16} aria-hidden="true" />,
  harnesses: () => <Cpu size={16} aria-hidden="true" />,
  // Both
  general: () => <SlidersHorizontal size={16} aria-hidden="true" />,
  plugins: () => <Puzzle size={16} aria-hidden="true" />,
  // Company settings
  members: () => <Users size={16} aria-hidden="true" />,
  connections: () => <Cable size={16} aria-hidden="true" />,
  secrets: () => <KeyRound size={16} aria-hidden="true" />,
  budgets: () => <Wallet size={16} aria-hidden="true" />,
  environments: () => <Server size={16} aria-hidden="true" />,
  transfer: () => <ArrowLeftRight size={16} aria-hidden="true" />,
};

function entryIcon(key: string) {
  return (ICONS[key] ?? (key.startsWith("plugin:") ? ICONS.plugins : ICONS.general))!();
}

/** What goes in the shell's nav slot: the settings sidebar in a settings area, else the main nav. */
export function ShellNav() {
  const location = useLocation();
  const company = useCompany();
  const area = () => settingsArea(location.pathname, company().issuePrefix);
  return (
    <Show when={area()} fallback={<Nav />}>
      {(current) => <SettingsNav area={current()} />}
    </Show>
  );
}

export function SettingsNav(props: { area: SettingsArea }) {
  const company = useCompany();
  return (
    <>
      <div class="snav-zone snav-zone--top">
        <A class="navi snav-back" href={backToAppHref(appPath(), company().issuePrefix)}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to app
        </A>
      </div>
      <Switch>
        <Match when={props.area === "app"}>
          <AppSettingsNav />
        </Match>
        <Match when={props.area === "company"}>
          <CompanySettingsNav />
        </Match>
      </Switch>
    </>
  );
}

function AppSettingsNav() {
  const sections = useAppSettingsSections();
  return (
    <>
      <SettingsTitle
        mark={
          <span class="snav-mark" aria-hidden="true">
            <Settings2 size={17} />
          </span>
        }
        title="App settings"
        note="This Paperclip instance"
      />
      <Show when={!sections.access.isLoading} fallback={<p class="snav-empty">Loading…</p>}>
        <SettingsRows entries={sections.entries()} />
        <Show when={sections.isAdmin()}>
          <div class="snav-zone snav-zone--bottom">
            <p class="snav-note">
              <span class="snav-note-title">No Experimental page</span>
              The switches still worth changing are under General → Features.
            </p>
          </div>
        </Show>
      </Show>
    </>
  );
}

function CompanySettingsNav() {
  const company = useCompany();
  const sections = useCompanySettingsSections();
  return (
    <>
      <SettingsTitle
        mark={<InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={32} />}
        title="Company settings"
        note={company().name}
      />
      <SettingsRows entries={sections.entries()} />
    </>
  );
}

function SettingsTitle(props: { mark: JSX.Element; title: string; note: string }) {
  return (
    <div class="snav-title">
      {props.mark}
      <span class="snav-title-text">
        <span class="snav-title-name disp">{props.title}</span>
        <span class="snav-title-note" title={props.note}>
          {props.note}
        </span>
      </span>
    </div>
  );
}

function SettingsRows(props: { entries: SettingsEntry[] }) {
  return (
    <div class="snav-zone snav-zone--sections">
      <For each={props.entries}>
        {(entry) =>
          "heading" in entry ? (
            <h2 class="snav-head">{entry.heading}</h2>
          ) : (
            <A class="navi" href={entry.href} end={entry.end}>
              {entryIcon(entry.key)}
              <span class="snav-label">{entry.label}</span>
              <Show when={entry.tag}>
                <span class="snav-tag">{entry.tag}</span>
              </Show>
            </A>
          )
        }
      </For>
    </div>
  );
}
