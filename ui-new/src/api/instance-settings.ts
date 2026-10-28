import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceExperimentalSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceSettings,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The instance's experimental settings. ui-new reads them to follow the flags the server also
 * enforces, such as `enableIsolatedWorkspaces`, and App settings → General's Features card switches
 * the ones someone may still want to change (decisions 12 and 32); the UI-only flags have no switch.
 * The general settings say whether run logs hide the username in home-directory paths; App settings
 * (src/settings/app/) changes them too: that setting, AI feedback sharing and backup retention.
 * The whole settings carry the instance-wide default environment, which company settings'
 * Environments section shows and sets.
 */
export const instanceSettingsApi = {
  experimental: () => api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  /**
   * Instance admins only. The server merges the patch's keys and answers with every flag. Keys
   * Paperclip Cloud manages, or an operator hides, can't be changed (403).
   */
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental", patch),
  general: () => api.get<InstanceGeneralSettings>("/instance/settings/general"),
  /** Instance admins only. The server merges the patch's keys; `backupRetention` is replaced whole. */
  updateGeneral: (patch: PatchInstanceGeneralSettings) => api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  settings: () => api.get<InstanceSettings>("/instance/settings"),
  /** Board access. `defaultEnvironmentId` is the one key: null falls back to the local environment. */
  update: (patch: PatchInstanceSettings) => api.patch<InstanceSettings>("/instance/settings", patch),
};
