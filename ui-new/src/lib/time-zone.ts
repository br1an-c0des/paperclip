import type { WorkspacePreference } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, untrack } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { workspacePreferencesApi } from "@/api/workspace-preferences";
import { useCompany } from "./company";
import { useSession } from "./session";

/*
 * The person's time zone (U143, upstream #20898). Chat agents read "nine in the morning" or "today"
 * in the zone saved in the person's workspace preferences (`timeZone`, an IANA name). The company
 * shell saves the browser's zone there once per page load, when it differs from the saved one, as
 * the old UI's useBrowserTimeZoneSync does. It's best-effort: a failed save isn't retried until the
 * next load, and nothing is shown either way.
 */

const MAX_LENGTH = 64;

/** True when the runtime knows the value as an IANA time zone (the server's `isValidIanaTimeZone`). */
export function isIanaTimeZone(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The browser's IANA time zone, or null when it doesn't report a usable one. */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isIanaTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** The zone to save: the browser's, when it's known and differs from the saved one; else null. */
export function timeZoneToSave(browser: string | null, saved: string | null | undefined): string | null {
  return browser && browser !== (saved ?? null) ? browser : null;
}

// One attempt per account and zone for this page load.
const attempted = new Set<string>();

/** Claims this load's one save of `zone` for the account; false when it was already tried. */
export function claimTimeZoneSave(userId: string, zone: string): boolean {
  const key = `${userId}\n${zone}`;
  if (attempted.has(key)) return false;
  attempted.add(key);
  return true;
}

export function resetTimeZoneSyncForTests() {
  attempted.clear();
}

/** Saves the browser's time zone to your workspace preferences, once per load, when it differs. */
export function useBrowserTimeZoneSync() {
  const company = useCompany();
  const session = useSession();
  const client = useQueryClient();
  const userId = () => session.youId();
  const preference = createQuery(() => ({
    queryKey: queryKeys.workspacePreferences.mine(userId()),
    queryFn: ({ signal }) => workspacePreferencesApi.get(signal),
    enabled: !!userId(),
    staleTime: Infinity,
    retry: false,
  }));

  createEffect(() => {
    const id = userId();
    const saved = preference.data;
    if (!id || !preference.isSuccess || !saved || saved.userId !== id) return;
    const zone = timeZoneToSave(browserTimeZone(), saved.timeZone);
    if (!zone || !claimTimeZoneSave(id, zone)) return;
    const companyId = untrack(() => company().id);
    workspacePreferencesApi
      .update(companyId, { timeZone: zone })
      .then((result) => {
        if (result.userId !== id) return;
        // Only the zone: a newer answer for another preference may already be cached.
        client.setQueryData<WorkspacePreference>(queryKeys.workspacePreferences.mine(id), (current) =>
          current && current.userId === id ? { ...current, timeZone: result.timeZone } : current,
        );
      })
      .catch(() => {
        // Best-effort: the agent falls back to asking, or says which zone it assumed.
      });
  });
}
