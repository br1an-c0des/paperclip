import type { PluginConfig, PluginLauncherDeclaration, PluginLauncherRenderContextSnapshot, PluginRecord, PluginUiSlotDeclaration } from "@paperclipai/shared";
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

/** `GET /plugins/:id/health`: the plugin's health checks (ui/src/api/plugins.ts). */
export type PluginHealth = {
  pluginId: string;
  status: string;
  healthy: boolean;
  checks: { name: string; passed: boolean; message?: string }[];
  lastError?: string;
};

/** `GET /plugins/:id/dashboard`: its worker, recent job runs and webhook deliveries, and health. */
export type PluginDashboard = {
  pluginId: string;
  worker: {
    status: string;
    pid: number | null;
    uptime: number | null;
    consecutiveCrashes: number;
    totalCrashes: number;
    pendingRequests: number;
    lastCrashAt: number | null;
    nextRestartAt: number | null;
  } | null;
  recentJobRuns: { id: string; jobId: string; jobKey?: string; trigger: string; status: string; durationMs: number | null; error: string | null; createdAt: string }[];
  recentWebhookDeliveries: { id: string; webhookKey: string; status: string; durationMs: number | null; error: string | null; createdAt: string }[];
  health: PluginHealth;
  checkedAt: string;
};

export type PluginLogEntry = { id: string; pluginId: string; level: string; message: string; meta: Record<string, unknown> | null; createdAt: string };

/** `GET /plugins/:id`: the record, and whether its worker can test a configuration. */
export type PluginDetail = PluginRecord & { supportsConfigTest?: boolean };

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
  get: (pluginId: string, signal?: AbortSignal) => api.get<PluginDetail>(`/plugins/${encodeURIComponent(pluginId)}`, { signal }),
  health: (pluginId: string, signal?: AbortSignal) => api.get<PluginHealth>(`/plugins/${encodeURIComponent(pluginId)}/health`, { signal }),
  dashboard: (pluginId: string, signal?: AbortSignal) => api.get<PluginDashboard>(`/plugins/${encodeURIComponent(pluginId)}/dashboard`, { signal }),
  logs: (pluginId: string, limit = 50, signal?: AbortSignal) =>
    api.get<PluginLogEntry[]>(`/plugins/${encodeURIComponent(pluginId)}/logs?limit=${limit}`, { signal }),
  /** The plugin's configuration in a company (`null` before it's saved). The server checks it against `instanceConfigSchema`. */
  config: (pluginId: string, companyId: string, signal?: AbortSignal) =>
    api.get<PluginConfig | null>(`/plugins/${encodeURIComponent(pluginId)}/config?companyId=${encodeURIComponent(companyId)}`, { signal }),
  saveConfig: (pluginId: string, companyId: string, configJson: Record<string, unknown>) =>
    api.post<PluginConfig>(`/plugins/${encodeURIComponent(pluginId)}/config`, { companyId, configJson }),
  /** The worker's `validateConfig`, without saving. */
  testConfig: (pluginId: string, companyId: string, configJson: Record<string, unknown>) =>
    api.post<{ valid: boolean; message?: string }>(`/plugins/${encodeURIComponent(pluginId)}/config/test`, { companyId, configJson }),
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
