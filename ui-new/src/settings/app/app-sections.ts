import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import type { SettingsEntry } from "../SettingsBody";
import { APP_SETTINGS_PATH, visibleSections, type AppSection } from "./app-settings-model";

/*
 * App settings' sections for this person, the one list both the page (AppSettingsPage.tsx) and the
 * settings sidebar (layout/SettingsNav.tsx) draw: `visibleSections` from your board access (instance
 * sections only for instance admins) and the operator's `PAPERCLIP_HIDDEN_SETTINGS`. Both callers
 * share the access query's cache, so it's fetched once.
 */

/** The rows for a section list: headings as they are, sections with their address under `base`. */
export function appSettingsEntries(base: string, sections: readonly ({ heading: string } | AppSection)[]): SettingsEntry[] {
  return sections.map((entry) => ("heading" in entry ? { heading: entry.heading } : { key: entry.key, label: entry.label, href: `${base}/${entry.key}` }));
}

export function useAppSettingsSections() {
  const company = useCompany();
  const session = useSession();
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess }));
  const isAdmin = () => access.data?.isInstanceAdmin === true;
  const sections = createMemo(() => visibleSections(isAdmin(), session.health()?.hiddenSettings));
  const base = () => `/${company().issuePrefix}${APP_SETTINGS_PATH}`;
  const entries = createMemo(() => appSettingsEntries(base(), sections()));
  return { access, isAdmin, sections, base, entries };
}
