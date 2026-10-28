import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceSettings,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The instance's experimental settings. ui-new has no switches of its own (decision 12): it reads
 * these only to follow the flags the server also enforces, such as `enableIsolatedWorkspaces`. The
 * general settings say whether run logs hide the username in home-directory paths; App settings
 * (src/settings/app/) changes them too: that setting, AI feedback sharing and backup retention.
 * The whole settings carry the instance-wide default environment, which company settings'
 * Environments section shows and sets.
 */
export const instanceSettingsApi = {
  experimental: () => api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  general: () => api.get<InstanceGeneralSettings>("/instance/settings/general"),
  /** Instance admins only. The server merges the patch's keys; `backupRetention` is replaced whole. */
  updateGeneral: (patch: PatchInstanceGeneralSettings) => api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  settings: () => api.get<InstanceSettings>("/instance/settings"),
  /** Board access. `defaultEnvironmentId` is the one key: null falls back to the local environment. */
  update: (patch: PatchInstanceSettings) => api.patch<InstanceSettings>("/instance/settings", patch),
};
