import type { PluginUiContribution } from "@/api/plugins";
import { usePluginContributions } from "@/plugins/contributions";

/*
 * Settings pages that plugins add (board 30's "From plugins"): each ready plugin's
 * `companySettingsPage` slots, from `GET /api/plugins/ui-contributions`, as the old UI's
 * CompanySettingsPluginPage reads them. A page lives at `/company/settings/<routePath>`.
 *
 * The plugin draws the page itself, through plugin hosting (src/plugins/, decision G).
 */

export type PluginSettingsPage = {
  pluginId: string;
  pluginName: string;
  version: string;
  slotId: string;
  label: string;
  routePath: string;
};

/** The company settings pages plugins declare, in their order, then by name. */
export function pluginSettingsPages(contributions: readonly Pick<PluginUiContribution, "pluginId" | "displayName" | "version" | "slots">[] | undefined): PluginSettingsPage[] {
  const pages: (PluginSettingsPage & { order: number })[] = [];
  for (const contribution of contributions ?? []) {
    for (const slot of contribution.slots) {
      if (slot.type !== "companySettingsPage" || !slot.routePath) continue;
      pages.push({
        pluginId: contribution.pluginId,
        pluginName: contribution.displayName,
        version: contribution.version,
        slotId: slot.id,
        label: slot.displayName,
        routePath: slot.routePath,
        order: slot.order ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }
  return pages
    .sort((a, b) => a.order - b.order || a.pluginName.localeCompare(b.pluginName) || a.label.localeCompare(b.label))
    .map(({ order: _order, ...page }) => page);
}

export function usePluginSettingsPages() {
  const query = usePluginContributions();
  return { query, pages: () => pluginSettingsPages(query.data) };
}
