import type { PluginUiSlotDeclaration } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";

/*
 * Settings pages that plugins add (board 30's "From plugins"): each ready plugin's
 * `companySettingsPage` slots, from `GET /api/plugins/ui-contributions`, as the old UI's
 * CompanySettingsPluginPage reads them. A page lives at `/company/settings/<routePath>`.
 *
 * Drawing a plugin's page needs plugin hosting (decision G, M7). Until then the section names the
 * plugin and says so. This reads the contributions directly rather than through an api/ module,
 * since the plugin API module comes with plugin hosting.
 */

type PluginUiContribution = {
  pluginId: string;
  pluginKey: string;
  displayName: string;
  version: string;
  slots: PluginUiSlotDeclaration[];
};

export type PluginSettingsPage = {
  pluginId: string;
  pluginName: string;
  version: string;
  slotId: string;
  label: string;
  routePath: string;
};

/** The company settings pages plugins declare, in their order, then by name. */
export function pluginSettingsPages(contributions: readonly PluginUiContribution[] | undefined): PluginSettingsPage[] {
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
  const query = createQuery(() => ({
    queryKey: queryKeys.companySettings.pluginPages,
    queryFn: ({ signal }) => api.get<PluginUiContribution[]>("/plugins/ui-contributions", { signal }),
    staleTime: 60_000,
    retry: false,
  }));
  return { query, pages: () => pluginSettingsPages(query.data) };
}
