import { Navigate, useLocation, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Settings2, ShieldCheck } from "lucide-solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { findCompanyByPrefix, lastCompanyPrefix, useCompaniesQuery, useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { PageHeader, RailLayout, SectionRail } from "@/ui/PageHeader";
import { Splash } from "@/routes/Splash";
import { AccountSection } from "./AccountSection";
import { AdminsSection } from "./AdminsSection";
import { APP_SETTINGS_PATH, appSettingsRoute, defaultSection, legacySettingsSuffix, visibleSections, type AppSectionKey } from "./app-settings-model";
import { GeneralSection } from "./GeneralSection";
import { HarnessesSection } from "./HarnessesSection";
import { OrganizationsSection } from "./OrganizationsSection";
import { PluginsSection } from "./PluginsSection";
import "./AppSettings.css";

/*
 * App settings (boards 28–30): your account and this instance, as one page with a section rail.
 * It lives at the old UI's address for instance settings, `/:companyPrefix/company/settings/instance`,
 * with a URL per section (`/account`, `/general`, `/organizations`, `/admins`, `/harnesses`,
 * `/plugins`). The old section addresses (`/profile`, `/access`, `/adapters`, `/experimental`,
 * `/plugins/:id`, `/environments`) and the unprefixed `/instance/settings/*` and `/settings/*`
 * redirect here (app-settings-model.ts).
 *
 * Only instance admins see the instance sections; everyone has Account. An operator can hide
 * sections with `PAPERCLIP_HIDDEN_SETTINGS`, as in the old UI. There's no Experimental page: the
 * new UI settles each switch (decision 12, board 30).
 */

export function AppSettingsPage() {
  const params = useParams<{ rest?: string }>();
  const location = useLocation();
  const company = useCompany();
  const session = useSession();
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess }));

  const isAdmin = () => access.data?.isInstanceAdmin === true;
  const sections = createMemo(() => visibleSections(isAdmin(), session.health()?.hiddenSettings));
  const shown = createMemo(() => new Set(sections().flatMap((entry) => ("heading" in entry ? [] : [entry.key]))));
  const base = () => `/${company().issuePrefix}${APP_SETTINGS_PATH}`;
  const route = () => appSettingsRoute(params.rest ?? "");
  const current = (): AppSectionKey | null => {
    const value = route();
    return value.kind === "section" && shown().has(value.section) ? value.section : null;
  };
  const fallback = () => defaultSection(sections());
  const keepQuery = () => `${location.search}${location.hash}`;

  return (
    <>
      <PageHeader
        size="compact"
        mark={
          <span class="as-mark" aria-hidden="true">
            <Settings2 size={17} />
          </span>
        }
        title="App settings"
        numbers={<span>Your account and this Paperclip instance. Organization settings live under each organization.</span>}
        aside={
          <Show when={isAdmin()}>
            <span class="as-admin-pill">
              <ShieldCheck size={13} aria-hidden="true" />
              You are an instance admin
            </span>
          </Show>
        }
      />
      <Show when={!access.isLoading} fallback={<Splash title="Loading settings" quiet />}>
        <Switch
          fallback={
            <Show
              when={fallback()}
              fallback={
                <section class="card as-empty">
                  <p>There are no settings here for you. An instance admin manages this instance.</p>
                </section>
              }
            >
              {(section) => <Navigate href={`${base()}/${section()}`} />}
            </Show>
          }
        >
          <Match when={route().kind === "redirect" && (route() as { to: string }).to}>
            {(to) => <Navigate href={`/${company().issuePrefix}${to()}${keepQuery()}`} />}
          </Match>
          <Match when={current()}>
            {(section) => (
              <RailLayout
                rail={
                  <div class="as-rail-col">
                    <SectionRail
                      label="App settings"
                      entries={sections().map((entry) => ("heading" in entry ? entry : { label: entry.label, href: `${base()}/${entry.key}` }))}
                    />
                    <Show when={isAdmin()}>
                      <div class="as-rail-note">
                        <span class="as-rail-note-title">No Experimental page</span>
                        The new UI settles each experimental switch instead of offering it as a toggle.
                      </div>
                    </Show>
                  </div>
                }
              >
                <Switch>
                  <Match when={section() === "account"}>
                    <AccountSection isAdmin={isAdmin()} />
                  </Match>
                  <Match when={section() === "general"}>
                    <GeneralSection />
                  </Match>
                  <Match when={section() === "organizations"}>
                    <OrganizationsSection accessibleIds={access.data?.companyIds ?? []} />
                  </Match>
                  <Match when={section() === "admins"}>
                    <AdminsSection youId={access.data?.userId ?? session.youId()} />
                  </Match>
                  <Match when={section() === "harnesses"}>
                    <HarnessesSection />
                  </Match>
                  <Match when={section() === "plugins"}>
                    <PluginsSection />
                  </Match>
                </Switch>
              </RailLayout>
            )}
          </Match>
        </Switch>
      </Show>
    </>
  );
}

/**
 * The old UI's addresses inside a company, `/:companyPrefix/instance/settings/*` and
 * `/:companyPrefix/settings/*`, open App settings.
 */
export function CompanySettingsRedirect(props: { kind: "instance" | "settings" }) {
  const params = useParams<{ rest?: string }>();
  const location = useLocation();
  const company = useCompany();
  return (
    <Navigate
      href={`/${company().issuePrefix}${APP_SETTINGS_PATH}${legacySettingsSuffix(props.kind, params.rest ?? "")}${location.search}${location.hash}`}
    />
  );
}

/**
 * The old UI's unprefixed addresses, `/instance`, `/instance/settings/*` and `/settings/*`, open App
 * settings in the last company you had open. `rest` is what follows `settings`.
 */
export function UnprefixedSettingsRedirect() {
  const params = useParams<{ rest?: string }>();
  const location = useLocation();
  const companies = useCompaniesQuery();
  const target = () => {
    const list = companies.data;
    if (!list?.length) return null;
    return findCompanyByPrefix(list, lastCompanyPrefix() ?? undefined) ?? list[0]!;
  };
  const suffix = () => `${legacySettingsSuffix("settings", params.rest ?? "")}${location.search}${location.hash}`;
  return (
    <Show when={!companies.isLoading} fallback={<Splash title="Loading companies" quiet />}>
      <Navigate href={target() ? `/${target()!.issuePrefix}${APP_SETTINGS_PATH}${suffix()}` : "/companies"} />
    </Show>
  );
}
