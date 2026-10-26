import type { InstanceExperimentalSettingsWithManaged, InstanceGeneralSettings } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The instance's experimental settings. ui-new has no switches of its own (decision 12): it reads
 * these only to follow the flags the server also enforces, such as `enableIsolatedWorkspaces`. The
 * general settings say whether run logs hide the username in home-directory paths.
 */
export const instanceSettingsApi = {
  experimental: () => api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  general: () => api.get<InstanceGeneralSettings>("/instance/settings/general"),
};
