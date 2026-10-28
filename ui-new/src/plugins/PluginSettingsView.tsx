import type { PluginRecord } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { ArrowLeft } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { buttonClass } from "@/ui/Button";
import { usePluginSlots } from "./contributions";
import { PluginSlotMount } from "./PluginSlot";
import "./plugins.css";

/*
 * One plugin's settings in App settings → Plugins (`?plugin=<id>`; the old UI's
 * `/instance/settings/plugins/:pluginId` lands here): the `settingsPage` slots the plugin draws
 * itself (ui/src/pages/PluginSettings.tsx). The old page's generated form for plugins that only
 * declare a config schema, its local folders, logs and health dashboard aren't ported yet.
 */

export function PluginSettingsView(props: { plugin: PluginRecord; name: string; backHref: string }) {
  const company = useCompany();
  const all = usePluginSlots(() => ({ slotTypes: ["settingsPage"] }));
  const slots = createMemo(() => all.slots().filter((slot) => slot.pluginId === props.plugin.id));
  const schema = () => {
    const properties = (props.plugin.manifestJson?.instanceConfigSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    return properties && Object.keys(properties).length > 0;
  };
  return (
    <div class="plugin-settings">
      <A class={buttonClass({ size: "compact", ghost: true })} href={props.backHref}>
        <ArrowLeft size={14} aria-hidden="true" />
        All plugins
      </A>
      <Show
        when={slots().length > 0}
        fallback={
          <section class="card plugin-note">
            <Show
              when={props.plugin.status === "ready"}
              fallback={<p>{props.name} isn't running, so its settings page can't open. Turn it on first.</p>}
            >
              <Show when={!all.query.isLoading} fallback={<p role="status">Loading…</p>}>
                <p>
                  {props.name} has no settings page of its own.
                  <Show when={schema()}> Its settings form, generated from its configuration schema, is still in the classic UI.</Show>
                </p>
              </Show>
            </Show>
          </section>
        }
      >
        <For each={slots()}>
          {(slot) => (
            <section class="card" aria-label={slot.displayName}>
              <PluginSlotMount slot={slot} context={{ companyId: company().id, companyPrefix: company().issuePrefix }} class="plugin-tab plugin-tab-card" missing="placeholder" />
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
