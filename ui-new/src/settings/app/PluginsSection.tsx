import type { PluginRecord } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { useSearchParams } from "@solidjs/router";
import { CircleAlert, Download, MoreHorizontal, RefreshCw, Settings2, Trash2 } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { PluginSettingsView } from "@/plugins/PluginSettingsView";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { bundledRows, discName, isExperimentalPlugin, parseInstallTarget, PLUGIN_STATUS, pluginErrorSummary, pluginName, pluginOn } from "./app-settings-model";
import { failure, ListRow, SectionTitle, StatePill } from "./shared";

/*
 * Plugins (board 30's outline): the installed plugins with their status, turned on and off
 * (`POST /api/plugins/:id/enable|disable`), updated from npm and removed; the plugins bundled with
 * this checkout, installed from their folder; and install by npm name or folder path.
 *
 * Each plugin's settings open from its row at `?plugin=<id>` (src/plugins/PluginSettingsView.tsx):
 * its own settings page or the form generated from its schema, its health, runtime and logs. Local
 * folders stay in the classic UI for now.
 */

export function PluginsSection() {
  const client = useQueryClient();
  const installed = createQuery(() => ({ queryKey: queryKeys.instanceSettings.plugins, queryFn: pluginsApi.list }));
  const bundled = createQuery(() => ({ queryKey: queryKeys.instanceSettings.bundledPlugins, queryFn: pluginsApi.bundled }));
  const plugins = createMemo(() => [...(installed.data ?? [])].sort((a, b) => pluginName(a).localeCompare(pluginName(b))));
  const bundledByPackage = createMemo(() => new Map((bundled.data ?? []).map((plugin) => [plugin.packageName, plugin])));
  const [pending, setPending] = createSignal<string | null>(null);
  const [install, setInstall] = createSignal("");
  const [installProblem, setInstallProblem] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal<PluginRecord | null>(null);
  const [details, setDetails] = createSignal<PluginRecord | null>(null);
  const [search, setSearch] = useSearchParams<{ plugin?: string }>();
  const company = useCompany();
  const open = createMemo(() => (search.plugin ? installed.data?.find((plugin) => plugin.id === search.plugin || plugin.pluginKey === search.plugin) : undefined));
  const sectionHref = () => `/${company().issuePrefix}/company/settings/instance/plugins`;

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.instanceSettings.plugins });

  const act = async (key: string, work: () => Promise<unknown>, done: string | null, fallback: string) => {
    setPending(key);
    try {
      await work();
      await refresh();
      if (done) pushToast({ tone: "success", title: done });
      return true;
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "Try again.") });
      return false;
    } finally {
      setPending(null);
    }
  };

  const installFrom = (key: string, params: { packageName: string; version?: string; isLocalPath?: boolean }) =>
    act(key, () => pluginsApi.install(params), `Installed ${params.packageName.split(/[\\/]/).filter(Boolean).at(-1) ?? params.packageName}`, "Couldn't install the plugin");

  const submitInstall = async () => {
    const parsed = parseInstallTarget(install());
    if (!parsed.ok) return setInstallProblem(parsed.problem);
    setInstallProblem(null);
    if (await installFrom("__install__", parsed.target)) setInstall("");
  };

  return (
    <Show
      when={!search.plugin}
      fallback={
        <Show
          when={open()}
          fallback={
            <>
              <SectionTitle title="Plugins">{installed.isLoading ? "Loading…" : "There's no installed plugin with this address."}</SectionTitle>
              <Button size="compact" onClick={() => setSearch({ plugin: undefined })}>
                All plugins
              </Button>
            </>
          }
        >
          {(plugin) => (
            <>
              <SectionTitle title={pluginName(plugin())}>
                <span class="mono">
                  {plugin().packageName} · {plugin().manifestJson?.version ?? plugin().version}
                </span>{" "}
                <StatePill label={PLUGIN_STATUS[plugin().status].label} tone={PLUGIN_STATUS[plugin().status].tone} />
              </SectionTitle>
              <PluginSettingsView plugin={plugin()} name={pluginName(plugin())} backHref={sectionHref()} />
            </>
          )}
        </Show>
      }
    >
      <SectionTitle title="Plugins">Extensions that add pages, settings, tools and environments to this instance.</SectionTitle>

      <SettingsCard
        title="Installed"
        description="Turning a plugin off stops it and hides what it adds; its settings are kept."
        footer={
          <form
            class="as-install"
            onSubmit={(event) => {
              event.preventDefault();
              void submitInstall();
            }}
          >
            <TextInput
              class="mono as-install-field"
              value={install()}
              placeholder="npm package name, or a folder path"
              aria-label="Plugin to install"
              invalid={Boolean(installProblem())}
              onInput={(event) => {
                setInstall(event.currentTarget.value);
                setInstallProblem(null);
              }}
            />
            <Button type="submit" icon={<Download size={15} />} disabled={pending() !== null || !install().trim()}>
              {pending() === "__install__" ? "Installing…" : "Install"}
            </Button>
            <Show when={installProblem()}>
              <span class="field-error as-install-problem" role="alert">
                {installProblem()}
              </span>
            </Show>
          </form>
        }
      >
        <Show when={installed.error}>
          <p class="as-empty-line as-bad" role="alert">
            {failure(installed.error, "Couldn't load the plugins.")}
          </p>
        </Show>
        <For each={plugins()} fallback={<Show when={!installed.isLoading && !installed.error}><p class="as-empty-line">No plugins installed yet.</p></Show>}>
          {(plugin) => {
            const status = () => PLUGIN_STATUS[plugin.status];
            const name = () => pluginName(plugin);
            const bundledInfo = () => bundledByPackage().get(plugin.packageName);
            return (
              <ListRow
                mark={<InitialsDisc name={discName(name())} seed={plugin.pluginKey} size={32} />}
                title={name()}
                mono={`${plugin.packageName} · ${plugin.manifestJson?.version ?? plugin.version}`}
                meta={
                  <>
                    <Show when={bundledInfo()}>{(info) => <span class="as-chip">{info().tag === "first-party" ? "First-party" : "Example"}</span>}</Show>
                    <Show
                      when={isExperimentalPlugin({
                        packageName: plugin.packageName,
                        packagePath: plugin.packagePath,
                        manifestJson: plugin.manifestJson,
                        bundledExperimental: bundledInfo()?.experimental,
                      })}
                    >
                      <span class="as-chip">Experimental</span>
                    </Show>
                    {plugin.manifestJson?.description || "No description."}
                  </>
                }
                extra={
                  <Show when={plugin.status === "error"}>
                    <button type="button" class="as-error-line" onClick={() => setDetails(plugin)}>
                      <CircleAlert size={14} aria-hidden="true" />
                      {pluginErrorSummary(plugin.lastError)}
                    </button>
                  </Show>
                }
              >
                <Button size="compact" ghost icon={<Settings2 size={14} aria-hidden="true" />} onClick={() => setSearch({ plugin: plugin.id })}>
                  Settings
                </Button>
                <StatePill label={status().label} tone={status().tone} />
                <Switch
                  checked={pluginOn(plugin.status)}
                  disabled={pending() === plugin.id}
                  onChange={(on) =>
                    void act(
                      plugin.id,
                      () => (on ? pluginsApi.enable(plugin.id) : pluginsApi.disable(plugin.id)),
                      on ? `Turned on ${name()}` : `Turned off ${name()}`,
                      `Couldn't turn ${name()} ${on ? "on" : "off"}`,
                    )
                  }
                  label={`${name()} on`}
                  labelHidden
                />
                <Menu placement="bottom-end">
                  <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`More actions for ${name()}`}>
                    <MoreHorizontal size={16} />
                  </Menu.Trigger>
                  <Menu.Content label={`${name()} actions`} width={240}>
                    <Show when={!plugin.packagePath}>
                      <Menu.Item
                        icon={<RefreshCw size={15} />}
                        disabled={pending() !== null}
                        description="Install the latest version from npm"
                        onSelect={() => void act(plugin.id, () => pluginsApi.upgrade(plugin.id), `Updated ${name()}`, `Couldn't update ${name()}`)}
                      >
                        Update
                      </Menu.Item>
                    </Show>
                    <Show when={plugin.status === "error"}>
                      <Menu.Item icon={<CircleAlert size={15} />} onSelect={() => setDetails(plugin)}>
                        Error details
                      </Menu.Item>
                    </Show>
                    <Menu.Item icon={<Trash2 size={15} />} danger onSelect={() => setRemoving(plugin)}>
                      Remove…
                    </Menu.Item>
                  </Menu.Content>
                </Menu>
              </ListRow>
            );
          }}
        </For>
      </SettingsCard>

      <Show when={bundled.data?.length}>
        <SettingsCard title="Bundled with Paperclip" description="Plugins that ship with this checkout. They install from their folder on the server.">
          <For each={bundledRows(bundled.data ?? [], installed.data ?? [])}>
            {(row) => (
              <ListRow
                mark={<InitialsDisc name={discName(row.plugin.displayName)} seed={row.plugin.pluginKey} size={32} />}
                title={row.plugin.displayName}
                mono={row.plugin.packageName}
                meta={
                  <>
                    <span class="as-chip">{row.plugin.tag === "first-party" ? "First-party" : "Example"}</span>
                    <Show when={isExperimentalPlugin({ packageName: row.plugin.packageName, packagePath: row.plugin.localPath, bundledExperimental: row.plugin.experimental })}>
                      <span class="as-chip">Experimental</span>
                    </Show>
                    {row.plugin.description}
                  </>
                }
              >
                <Show
                  when={row.installed}
                  fallback={
                    <Button
                      size="compact"
                      disabled={pending() !== null}
                      onClick={() => void installFrom(row.plugin.packageName, { packageName: row.plugin.localPath, isLocalPath: true })}
                    >
                      {pending() === row.plugin.packageName ? (row.plugin.hasBuiltEntrypoints ? "Installing…" : "Building…") : "Install"}
                    </Button>
                  }
                >
                  {(record) => <StatePill label={PLUGIN_STATUS[record().status].label} tone={PLUGIN_STATUS[record().status].tone} />}
                </Show>
              </ListRow>
            )}
          </For>
        </SettingsCard>
      </Show>

      <Dialog
        open={removing() !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing() ? pluginName(removing()!) : "plugin"}?`}
        description="It stops, and the pages, tools and environments it adds go away. Its stored data is kept, so installing it again brings it back."
        width={480}
        hideClose
        footer={
          <>
            <Button ghost onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending() !== null}
              onClick={async () => {
                const plugin = removing();
                if (plugin && (await act(plugin.id, () => pluginsApi.uninstall(plugin.id), `Removed ${pluginName(plugin)}`, `Couldn't remove ${pluginName(plugin)}`))) {
                  setRemoving(null);
                }
              }}
            >
              Remove
            </Button>
          </>
        }
      />

      <Dialog
        open={details() !== null}
        onOpenChange={(open) => !open && setDetails(null)}
        title={`${details() ? pluginName(details()!) : "Plugin"} hit an error`}
        width={640}
      >
        <pre class="as-pre">{details()?.lastError ?? "No message was stored."}</pre>
      </Dialog>
    </Show>
  );
}
