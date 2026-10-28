import type { PluginLauncherPlacementZone, PluginUiSlotEntityType } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { useSession } from "@/lib/session";
import { resolveLaunchers, resolveSlots, type ResolvedPluginLauncher, type ResolvedPluginSlot, type SlotFilters } from "./model";

/*
 * The ready plugins' UI contributions (`GET /api/plugins/ui-contributions`), shared by every mount
 * point, and the slots and launchers each one shows. The live events refresh the list when a plugin
 * is installed, turned on or off, upgraded or removed (lib/live-events.tsx), and each mount point
 * follows.
 *
 * A refetch returns new objects for the same slots. Each list keeps the previous object for a slot
 * that hasn't changed, so the mounted plugin component (a React root) stays mounted and keeps its
 * state instead of remounting on every refresh.
 */

export function usePluginContributions(enabled: () => boolean = () => true) {
  return createQuery(() => ({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: ({ signal }) => pluginsApi.uiContributions(signal),
    staleTime: 60_000,
    retry: false,
    enabled: enabled(),
  }));
}

/** Keeps each entry's previous object while its content is unchanged. */
function stableList<T>(keyOf: (item: T) => string) {
  let previous = new Map<string, { json: string; item: T }>();
  return (items: T[]): T[] => {
    const next = new Map<string, { json: string; item: T }>();
    const out = items.map((item) => {
      const key = keyOf(item);
      const json = JSON.stringify(item);
      const kept = previous.get(key);
      const entry = kept && kept.json === json ? kept : { json, item };
      next.set(key, entry);
      return entry.item;
    });
    previous = next;
    return out;
  };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, index) => item === b[index]);

export function usePluginSlots(filters: () => SlotFilters, enabled?: () => boolean) {
  const query = usePluginContributions(enabled);
  const stable = stableList<ResolvedPluginSlot>((slot) => `${slot.pluginId}:${slot.id}:${slot.type}`);
  const slots = createMemo(() => stable(resolveSlots(query.data, filters())), [], { equals: sameList });
  return { query, slots };
}

export function usePluginLaunchers(
  filters: () => { placementZones: readonly PluginLauncherPlacementZone[]; entityType?: PluginUiSlotEntityType | null },
  enabled?: () => boolean,
) {
  const query = usePluginContributions(enabled);
  const stable = stableList<ResolvedPluginLauncher>((launcher) => `${launcher.pluginId}:${launcher.id}`);
  const launchers = createMemo(() => stable(resolveLaunchers(query.data, filters())), [], { equals: sameList });
  return { query, launchers };
}

/** The signed-in user's id for the host context, or null without a session (tests, local_trusted). */
export function useHostUserId(): () => string | null {
  try {
    const session = useSession();
    return () => session.userId();
  } catch {
    return () => null;
  }
}
