import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import type { PluginSettingsPage } from "./plugin-pages";
import { CardHead, CardNoteLine, SectionTitle } from "./shared";

/*
 * Settings pages from plugins (board 30's "From plugins"). The plugin draws its own page inside
 * this layout, which needs plugin hosting (M7). Until then a plugin's entry says what it is and
 * that its page arrives with plugin hosting; the overview lists every plugin page there is.
 */

const HOSTING_NOTE = "Plugins draw this page themselves. It appears here once plugin hosting arrives; until then it's in the classic UI.";

export function PluginPageSection(props: { page: PluginSettingsPage }) {
  return (
    <>
      <SectionTitle title={props.page.label}>A settings page the {props.page.pluginName} plugin adds.</SectionTitle>
      <section aria-label="Plugin page" class="ag-outline">
        <div class="ag-outline-head">
          <span class="ag-outline-tag">Plugin</span>
          {props.page.pluginName} {props.page.version}
        </div>
        <p class="cs-muted">{HOSTING_NOTE}</p>
      </section>
    </>
  );
}

export function PluginsOverview(props: { pages: PluginSettingsPage[]; loading: boolean; error: boolean; base: string }) {
  const company = useCompany();
  return (
    <>
      <SectionTitle title="From plugins">Settings pages that installed plugins add to the organization. Each one gets an entry in this list.</SectionTitle>
      <section class="card settings-card" aria-labelledby="cs-plugin-pages">
        <CardHead id="cs-plugin-pages" title="Plugin settings pages" note={HOSTING_NOTE} />
        <Show when={!props.error} fallback={<CardNoteLine alert>Couldn't load the plugins.</CardNoteLine>}>
          <For each={props.pages} fallback={<CardNoteLine>{props.loading ? "Loading…" : "No installed plugin adds a settings page."}</CardNoteLine>}>
            {(page) => (
              <div class="cs-lrow">
                <div class="cs-person-text cs-grow">
                  <A class="ps-link cs-strong" href={`${props.base}/${page.routePath}`}>
                    {page.label}
                  </A>
                  <span class="cs-muted">
                    {page.pluginName} {page.version}
                  </span>
                </div>
              </div>
            )}
          </For>
        </Show>
        <footer class="cfoot cs-muted">
          Plugins are installed and configured in app settings, under{" "}
          <A class="ps-link" href={`/${company().issuePrefix}/company/settings/instance/plugins`}>
            Plugins
          </A>
          .
        </footer>
      </section>
    </>
  );
}
