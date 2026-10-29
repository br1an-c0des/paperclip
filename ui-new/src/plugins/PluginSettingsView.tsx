import type { PluginRecord } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { ArrowLeft } from "lucide-solid";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { buttonClass } from "@/ui/Button";
import { usePluginSlots } from "./contributions";
import { PluginConfigForm } from "./PluginConfigForm";
import { PluginLocalFolders } from "./PluginLocalFolders";
import { PluginSlotMount } from "./PluginSlot";
import { PluginStatus } from "./PluginStatus";
import type { JsonSchemaNode } from "./schema-form";
import "./plugins.css";
import "./plugin-settings.css";

/*
 * One plugin's settings in App settings → Plugins (`?plugin=<id>`; the old UI's
 * `/instance/settings/plugins/:pluginId` lands here), as ui/src/pages/PluginSettings.tsx has them:
 *
 * - Settings: the `settingsPage` slots the plugin draws itself; or, for a plugin that only declares
 *   `instanceConfigSchema`, a form generated from it (PluginConfigForm.tsx); or a pointer to
 *   Environments for a plugin that adds environment drivers.
 * - Folders: the server folders a plugin asks for (`localFolders`), per organization
 *   (PluginLocalFolders.tsx). Hidden under `enableManagedSandboxOnly`, where the managed environment
 *   owns the filesystem, as the old page does.
 * - Status: health, the worker, recent jobs and webhooks, logs and permissions (PluginStatus.tsx).
 */

export function PluginSettingsView(props: { plugin: PluginRecord; name: string; backHref: string }) {
  const company = useCompany();
  const all = usePluginSlots(() => ({ slotTypes: ["settingsPage"] }));
  const slots = createMemo(() => all.slots().filter((slot) => slot.pluginId === props.plugin.id));
  // The detail adds whether the worker can test a configuration.
  const detail = createQuery(() => ({
    queryKey: queryKeys.plugins.detail(props.plugin.id),
    queryFn: ({ signal }) => pluginsApi.get(props.plugin.id, signal),
    retry: false,
  }));
  const schema = createMemo(() => {
    const value = props.plugin.manifestJson?.instanceConfigSchema as JsonSchemaNode | undefined;
    return value?.properties && Object.keys(value.properties).length > 0 ? value : null;
  });
  const drivers = () => props.plugin.manifestJson?.environmentDrivers ?? [];
  const experimental = useExperimentalSettingsQuery();
  // Unknown counts as managed, so a failed read never shows host paths the policy hides.
  const hideHostPaths = () => experimental.data === undefined || experimental.data.enableManagedSandboxOnly === true;
  const folders = () => (hideHostPaths() ? [] : (props.plugin.manifestJson?.localFolders ?? []));

  return (
    <div class="plugin-settings">
      <A class={buttonClass({ size: "compact", ghost: true })} href={props.backHref}>
        <ArrowLeft size={14} aria-hidden="true" />
        All plugins
      </A>
      <Show when={props.plugin.manifestJson?.description}>{(text) => <p class="plugin-settings-about">{text()}</p>}</Show>

      <Show when={folders().length > 0}>
        <PluginLocalFolders pluginId={props.plugin.id} companyId={company().id} declarations={folders()} />
      </Show>
      <Switch
        fallback={
          <Show when={folders().length === 0}>
            <section class="card plugin-note">
              <p>{props.name} doesn't need any settings.</p>
            </section>
          </Show>
        }
      >
        <Match when={slots().length > 0}>
          <For each={slots()}>
            {(slot) => (
              <section class="card" aria-label={slot.displayName}>
                <PluginSlotMount slot={slot} context={{ companyId: company().id, companyPrefix: company().issuePrefix }} class="plugin-tab plugin-tab-card" missing="placeholder" />
              </section>
            )}
          </For>
        </Match>
        <Match when={all.query.isLoading && props.plugin.status === "ready"}>
          <p class="plugin-note" role="status">
            Loading…
          </p>
        </Match>
        <Match when={schema()}>
          {(current) => (
            <PluginConfigForm
              pluginId={props.plugin.id}
              companyId={company().id}
              schema={current()}
              ready={props.plugin.status === "ready"}
              supportsTest={detail.data?.supportsConfigTest === true}
            />
          )}
        </Match>
        <Match when={drivers().length > 0}>
          <section class="card plugin-note">
            <p>
              {props.name} adds environment runtimes. Set them up in{" "}
              <A href={`/${company().issuePrefix}/company/settings/environments`}>Company settings → Environments</A>.
            </p>
          </section>
        </Match>
      </Switch>

      <PluginStatus plugin={props.plugin} />
    </div>
  );
}
