import type { PluginRecord } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The instance's plugins (ui/src/api/plugins.ts), as App settings manages them: the installed list,
 * the plugins bundled with this checkout, install from npm or a local folder, enable, disable,
 * upgrade and uninstall. Instance admins only.
 *
 * A plugin's own settings page, panels and full pages are drawn by the plugin, which needs plugin
 * hosting (build plan, decision G, M7); their bridge requests aren't ported yet.
 */

/** A plugin that ships with this checkout (`GET /plugins/examples`). */
export type BundledPlugin = {
  packageName: string;
  pluginKey: string;
  displayName: string;
  description: string;
  localPath: string;
  tag: "example" | "first-party";
  experimental: boolean;
  hasBuiltEntrypoints: boolean;
};

export const pluginsApi = {
  list: () => api.get<PluginRecord[]>("/plugins"),
  bundled: () => api.get<BundledPlugin[]>("/plugins/examples"),
  install: (params: { packageName: string; version?: string; isLocalPath?: boolean }) => api.post<PluginRecord>("/plugins/install", params),
  enable: (pluginId: string) => api.post<{ ok: boolean }>(`/plugins/${encodeURIComponent(pluginId)}/enable`, {}),
  disable: (pluginId: string) => api.post<{ ok: boolean }>(`/plugins/${encodeURIComponent(pluginId)}/disable`, {}),
  /** Upgrades to the latest version on npm. */
  upgrade: (pluginId: string) => api.post<{ ok: boolean }>(`/plugins/${encodeURIComponent(pluginId)}/upgrade`, {}),
  uninstall: (pluginId: string) => api.delete<{ ok: boolean }>(`/plugins/${encodeURIComponent(pluginId)}`),
};
