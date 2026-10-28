import { A } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { usePluginSlots } from "@/plugins/contributions";
import { PluginSlotMount } from "@/plugins/PluginSlot";
import type { PluginSettingsPage } from "./plugin-pages";
import { CardHead, CardNoteLine, SectionTitle } from "./shared";

/*
 * Settings pages from plugins (board 30's "From plugins"). The plugin draws its own page inside
 * this layout, under a title naming it (plugin hosting, src/plugins/); the overview lists every
 * plugin page there is.
 */

export function PluginPageSection(props: { page: PluginSettingsPage }) {
  const company = useCompany();
  const plugins = usePluginSlots(() => ({ slotTypes: ["companySettingsPage"] }));
  const slot = createMemo(() => plugins.slots().find((candidate) => candidate.pluginId === props.page.pluginId && candidate.id === props.page.slotId));
  return (
    <>
      <SectionTitle title={props.page.label}>
        A settings page the {props.page.pluginName} plugin adds ({props.page.version}).
      </SectionTitle>
      <section aria-label={props.page.label} class="card settings-card">
        <Show when={slot()} fallback={<CardNoteLine>Loading…</CardNoteLine>}>
          {(found) => <PluginSlotMount slot={found()} context={{ companyId: company().id, companyPrefix: company().issuePrefix }} class="plugin-tab plugin-tab-card" missing="placeholder" />}
        </Show>
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
        <CardHead id="cs-plugin-pages" title="Plugin settings pages" note="Each plugin draws its own page." />
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
