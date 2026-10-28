import type { PluginLauncherDeclaration, PluginLauncherRenderContextSnapshot, PluginRecord, PluginUiSlotDeclaration } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The instance's plugins (ui/src/api/plugins.ts), as App settings manages them: the installed list,
 * the plugins bundled with this checkout, install from npm or a local folder, enable, disable,
 * upgrade and uninstall. Instance admins only.
 *
 * Plugin hosting (src/plugins/, decision G) adds what plugin UI needs: the UI contributions of the
 * ready plugins, and the bridge requests a plugin component's `usePluginData` and
 * `usePluginAction` make to its worker.
 */

/**
 * A ready plugin's UI (`GET /plugins/ui-contributions`): its slots, its launchers (from the manifest's
 * `ui.launchers` and the older top-level `launchers`), and its UI bundle's entry file, served at
 * `/_plugins/:pluginId/ui/:uiEntryFile`.
 */
export type PluginUiContribution = {
  pluginId: string;
  pluginKey: string;
  displayName: string;
  version: string;
  updatedAt?: string;
  uiEntryFile: string;
  slots: PluginUiSlotDeclaration[];
  launchers: PluginLauncherDeclaration[];
};

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
  uiContributions: (signal?: AbortSignal) => api.get<PluginUiContribution[]>("/plugins/ui-contributions", { signal }),
  /** `usePluginData(key, params)`: the worker's `getData` handler. Errors carry `{ code, message, details }`. */
  bridgeGetData: (
    pluginId: string,
    key: string,
    params: Record<string, unknown> | undefined,
    companyId: string | null,
    renderEnvironment: PluginLauncherRenderContextSnapshot | null,
  ) =>
    api.post<{ data: unknown }>(`/plugins/${encodeURIComponent(pluginId)}/data/${encodeURIComponent(key)}`, {
      companyId: companyId ?? undefined,
      params,
      renderEnvironment: renderEnvironment ?? undefined,
    }),
  /** `usePluginAction(key)` and `performAction` launchers: the worker's `performAction` handler. */
  bridgePerformAction: (
    pluginId: string,
    key: string,
    params: Record<string, unknown> | undefined,
    companyId: string | null,
    renderEnvironment: PluginLauncherRenderContextSnapshot | null = null,
  ) =>
    api.post<{ data: unknown }>(`/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(key)}`, {
      companyId: companyId ?? undefined,
      params,
      renderEnvironment: renderEnvironment ?? undefined,
    }),
  /**
   * Whether a task side panel is available for a running agent: the plugin's own route,
   * `/plugins/:pluginId/api<availabilityPath>` with `:entityId` filled in (useTaskPluginPanels.ts).
   */
  panelAvailability: (pluginId: string, availabilityPath: string, entityId: string, signal?: AbortSignal) =>
    api.get<{ available: boolean }>(`/plugins/${encodeURIComponent(pluginId)}/api${availabilityPath.replace(":entityId", encodeURIComponent(entityId))}`, { signal }),
};
