import { Navigate, useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, Match, on, Switch } from "solid-js";
import { useCompany } from "@/lib/company";
import { RailLayout, SectionRail, type RailEntry } from "@/ui/PageHeader";
import { OrgHeader } from "@/org/OrgHeader";
import { BudgetsSection } from "./BudgetsSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { EnvironmentsSection } from "./EnvironmentsSection";
import { GeneralSection } from "./GeneralSection";
import { MembersSection } from "./MembersSection";
import { usePluginSettingsPages } from "./plugin-pages";
import { PluginPageSection, PluginsOverview } from "./PluginSection";
import { SecretsSection } from "./SecretsSection";
import { parseSettingsPath, sectionHref, SECTIONS } from "./sections";
import { CardNoteLine, SectionTitle } from "./shared";
import { TransferSection } from "./TransferSection";
import "@/projects/settings/ProjectSettings.css";
import "@/agents/Agent.css";
import "./CompanySettings.css";

/*
 * Company settings (boards 21–25 and board 30's outline): the organization's header and tabs, then
 * one page with a section rail and a URL per section under `/:prefix/company/settings`. The old
 * UI's addresses land on the matching section (sections.ts), and `/company/export` and
 * `/company/import` on Import and export.
 *
 * "From plugins" lists the settings pages installed plugins add, at the old UI's address
 * (`/company/settings/<routePath>`); the pages themselves come with plugin hosting. App (instance)
 * settings are a page of their own.
 */

/** The overview of plugin pages; the segment no plugin is expected to claim. */
const PLUGINS_PATH = "plugins";

export function CompanySettingsPage() {
  const company = useCompany();
  const params = useParams<{ rest?: string }>();
  const location = useLocation();
  const base = () => `/${company().issuePrefix}/company/settings`;
  const plugins = usePluginSettingsPages();
  const route = createMemo(() => parseSettingsPath(params.rest, location.search));
  const pluginPage = createMemo(() => {
    const current = route();
    return current.kind === "plugin" ? plugins.pages().find((page) => page.routePath === current.routePath) : undefined;
  });

  const entries = createMemo<RailEntry[]>(() => [
    { heading: "Organization" },
    ...SECTIONS.map((section) => ({ label: section.label, href: `${base()}${section.path}`, end: section.path === "" })),
    { heading: "From plugins" },
    ...plugins.pages().map((page) => ({ label: page.label, href: `${base()}/${page.routePath}`, tag: "plugin" })),
    ...(plugins.pages().length === 0 ? [{ label: "Plugin pages", href: `${base()}/${PLUGINS_PATH}`, tag: "none" }] : []),
  ]);

  // An old address or an Invite people link names a card: bring it into view once it's drawn.
  createEffect(
    on([() => location.hash, () => location.pathname], ([hash]) => {
      if (!hash) return;
      const id = decodeURIComponent(hash.slice(1));
      let tries = 0;
      const scroll = () => {
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        else if (tries++ < 20) window.setTimeout(scroll, 100);
      };
      requestAnimationFrame(scroll);
    }),
  );

  return (
    <div class="org-page cs-page">
      <OrgHeader />
      <RailLayout rail={<SectionRail label="Organization settings" entries={entries()} />}>
        <Switch>
          <Match when={route().kind === "redirect" && route()}>
            {(found) => {
              const target = found() as { key: Parameters<typeof sectionHref>[1]; anchor?: string };
              return <Navigate href={sectionHref(base(), target.key, target.anchor)} />;
            }}
          </Match>
          <Match when={route().kind === "instance"}>
            <SectionTitle title="App settings">This address belongs to app settings, which apply to every organization on this Paperclip instance.</SectionTitle>
            <CardNoteLine>Open app settings from the settings button next to your name in the sidebar.</CardNoteLine>
          </Match>
          <Match when={route().kind === "plugin" && (route() as { routePath: string }).routePath === PLUGINS_PATH}>
            <PluginsOverview pages={plugins.pages()} loading={plugins.query.isLoading} error={plugins.query.isError} base={base()} />
          </Match>
          <Match when={pluginPage()}>{(page) => <PluginPageSection page={page()} />}</Match>
          <Match when={route().kind === "plugin" && (plugins.query.isLoading || plugins.query.isError)}>
            <CardNoteLine>{plugins.query.isError ? "Couldn't load the plugins' settings pages." : "Loading…"}</CardNoteLine>
          </Match>
          <Match when={route().kind === "plugin"}>
            <Navigate href={base()} />
          </Match>
          <Match when={route().kind === "section" && (route() as { key: string }).key}>
            {(key) => (
              <Switch>
                <Match when={key() === "general"}>
                  <GeneralSection />
                </Match>
                <Match when={key() === "members"}>
                  <MembersSection />
                </Match>
                <Match when={key() === "connections"}>
                  <ConnectionsSection />
                </Match>
                <Match when={key() === "secrets"}>
                  <SecretsSection />
                </Match>
                <Match when={key() === "budgets"}>
                  <BudgetsSection />
                </Match>
                <Match when={key() === "environments"}>
                  <EnvironmentsSection />
                </Match>
                <Match when={key() === "transfer"}>
                  <TransferSection />
                </Match>
              </Switch>
            )}
          </Match>
        </Switch>
      </RailLayout>
    </div>
  );
}

/** The old UI's `/company/export/*` and `/company/import` pages. */
export function CompanyTransferRedirect(props: { kind: "export" | "import" }) {
  const company = useCompany();
  return <Navigate href={sectionHref(`/${company().issuePrefix}/company/settings`, "transfer", props.kind)} />;
}


