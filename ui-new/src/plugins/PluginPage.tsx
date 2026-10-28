import { A, Navigate, useParams } from "@solidjs/router";
import { Puzzle } from "lucide-solid";
import { createMemo, Match, Show, Switch, type JSX } from "solid-js";
import { useCompany } from "@/lib/company";
import { PageHeader } from "@/ui/PageHeader";
import { usePluginContributions } from "./contributions";
import { resolvePluginPage, routeSidebarPageTitle } from "./model";
import { PluginSlotMount } from "./PluginSlot";
import "./plugins.css";

/*
 * Full plugin pages (PLUGIN_SPEC.md §19.2, §24.4; ui/src/pages/PluginPage.tsx). The company's
 * catch-all route lands here: when a ready plugin's `page` slot claims the first segment
 * (`/:prefix/<routePath>/*`), or the address is `/:prefix/plugins/<pluginId>`, the plugin draws the
 * page under a compact header naming it. A page with a `routeSidebar` slot gets that sidebar beside
 * it (the old UI swapped it in for the main nav). Anything else gets `notFound`, so addresses this
 * UI doesn't have yet keep their "Not built yet" note.
 */

export function PluginPageRoute(props: { notFound: () => JSX.Element }) {
  const params = useParams<{ rest?: string }>();
  const company = useCompany();
  const contributions = usePluginContributions();
  const match = createMemo(() => resolvePluginPage(contributions.data, params.rest ?? ""));
  const context = () => ({ companyId: company().id, companyPrefix: company().issuePrefix });
  const splat = () => (params.rest ?? "").split("/").slice(1).join("/");

  return (
    <Switch fallback={props.notFound()}>
      <Match when={contributions.isLoading}>
        <p class="card plugin-note" role="status">
          Loading…
        </p>
      </Match>
      <Match when={match().kind === "conflict" && (match() as { routePath: string }).routePath}>
        {(routePath) => (
          <p class="card plugin-note plugin-note--alert" role="alert">
            More than one plugin claims <code class="mono">/{routePath()}</code>. Turn one of them off in App settings, or open the page at{" "}
            <code class="mono">/plugins/&lt;plugin id&gt;</code>.
          </p>
        )}
      </Match>
      <Match when={match().kind === "no-page" && (match() as { pluginId: string }).pluginId}>
        {(pluginId) => <Navigate href={`/${company().issuePrefix}/company/settings/instance/plugins?plugin=${encodeURIComponent(pluginId())}`} />}
      </Match>
      <Match when={match().kind === "page" && (match() as Extract<ReturnType<typeof match>, { kind: "page" }>)}>
        {(found) => (
          <div class="plugin-page">
            <PageHeader
              size="compact"
              mark={
                <span class="plugin-page-mark" aria-hidden="true">
                  <Puzzle size={17} />
                </span>
              }
              crumbs={<span>{found().slot.pluginDisplayName}</span>}
              title={found().routeSidebar ? routeSidebarPageTitle(found().slot, splat()) : found().slot.displayName}
              numbers={
                <span>
                  A page from the {found().slot.pluginDisplayName} plugin.{" "}
                  <A href={`/${company().issuePrefix}/company/settings/instance/plugins?plugin=${encodeURIComponent(found().slot.pluginId)}`}>Plugin settings</A>
                </span>
              }
            />
            <div class="plugin-page-body" classList={{ "plugin-page-body--sidebar": Boolean(found().routeSidebar) }}>
              <Show when={found().routeSidebar}>
                {(sidebar) => (
                  <aside class="card plugin-route-sidebar" aria-label={sidebar().displayName}>
                    <PluginSlotMount slot={sidebar()} context={context()} missing="placeholder" />
                  </aside>
                )}
              </Show>
              <PluginSlotMount slot={found().slot} context={context()} class="plugin-page-main" missing="placeholder" />
            </div>
          </div>
        )}
      </Match>
    </Switch>
  );
}
