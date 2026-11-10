import { createMemo } from "solid-js";
import { useCompany } from "@/lib/company";
import { usePluginSettingsPages } from "./plugin-pages";
import { companySettingsEntries } from "./sections";

/*
 * Company settings' sections, the one list both the page (CompanySettingsPage.tsx) and the settings
 * sidebar (layout/SettingsNav.tsx) draw: the organization's sections (sections.ts), then the
 * settings pages installed plugins add (plugin-pages.ts). Both callers share the plugin
 * contributions query's cache.
 */
export function useCompanySettingsSections() {
  const company = useCompany();
  const plugins = usePluginSettingsPages();
  const base = () => `/${company().issuePrefix}/company/settings`;
  const entries = createMemo(() => companySettingsEntries(base(), plugins.pages()));
  return { base, plugins, entries };
}
