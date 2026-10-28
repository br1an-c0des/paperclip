import type {
  PluginLauncherDeclaration,
  PluginLauncherPlacementZone,
  PluginUiSlotDeclaration,
  PluginUiSlotEntityType,
  PluginUiSlotType,
} from "@paperclipai/shared";
import type { PluginHostContext } from "@paperclipai/plugin-sdk/ui";
import type { PluginUiContribution } from "@/api/plugins";

/*
 * Plugin hosting's pure rules (decision G), ported from ui/src/plugins/slots.tsx, launchers.tsx,
 * bridge.ts and pages/PluginPage.tsx: which slots and launchers a mount point shows, which plugin
 * owns a page address, the host context a plugin component receives, and how plugin links resolve
 * into the current company. No React and no Solid here, so it's cheap to import anywhere.
 */

/** Where a slot or launcher renders: the company, and the entity a detail tab or toolbar is about. */
export type PluginSlotContext = {
  companyId?: string | null;
  companyPrefix?: string | null;
  projectId?: string | null;
  entityId?: string | null;
  entityType?: PluginUiSlotEntityType | null;
  /** The parent entity for nested slots (a comment's task). */
  parentEntityId?: string | null;
  /** The project's address key, which old-UI plugins read for links. */
  projectRef?: string | null;
};

export type ResolvedPluginSlot = PluginUiSlotDeclaration & {
  pluginId: string;
  pluginKey: string;
  pluginDisplayName: string;
  pluginVersion: string;
};

export type ResolvedPluginLauncher = PluginLauncherDeclaration & {
  pluginId: string;
  pluginKey: string;
  pluginDisplayName: string;
  pluginVersion: string;
  uiEntryFile: string;
};

export type SlotFilters = {
  slotTypes: readonly PluginUiSlotType[];
  /** The entity a detail tab, toolbar or menu item is about; entity-scoped slots need it. */
  entityType?: PluginUiSlotEntityType | null;
  /** Only agent tabs that opted into the task side panel. */
  taskSidePanel?: boolean;
};

const ENTITY_SCOPED = new Set<string>([
  "detailTab",
  "taskDetailView",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "projectSidebarItem",
  "toolbarButton",
]);

/** Slot types and launcher zones that only render for an entity they list in `entityTypes`. */
export function requiresEntityType(type: string) {
  return ENTITY_SCOPED.has(type);
}

function byOrderThenName<T extends { order?: number; pluginDisplayName: string; displayName: string }>(a: T, b: T) {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.pluginDisplayName.localeCompare(b.pluginDisplayName) || a.displayName.localeCompare(b.displayName);
}

/** Every ready plugin's slots of the requested types, in their declared order, then by name. */
export function resolveSlots(contributions: readonly PluginUiContribution[] | undefined, filters: SlotFilters): ResolvedPluginSlot[] {
  const types = new Set<string>(filters.slotTypes);
  const rows: ResolvedPluginSlot[] = [];
  for (const contribution of contributions ?? []) {
    for (const slot of contribution.slots) {
      if (!types.has(slot.type)) continue;
      if (filters.taskSidePanel && !slot.taskSidePanel) continue;
      if (requiresEntityType(slot.type)) {
        if (!filters.entityType || !slot.entityTypes?.includes(filters.entityType)) continue;
      }
      rows.push({
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      });
    }
  }
  return rows.sort(byOrderThenName);
}

/** Every ready plugin's launchers for the requested zones, sorted like slots. */
export function resolveLaunchers(
  contributions: readonly PluginUiContribution[] | undefined,
  filters: { placementZones: readonly PluginLauncherPlacementZone[]; entityType?: PluginUiSlotEntityType | null },
): ResolvedPluginLauncher[] {
  const zones = new Set<string>(filters.placementZones);
  const rows: ResolvedPluginLauncher[] = [];
  for (const contribution of contributions ?? []) {
    for (const launcher of contribution.launchers) {
      if (!zones.has(launcher.placementZone)) continue;
      if (requiresEntityType(launcher.placementZone)) {
        if (!filters.entityType || !launcher.entityTypes?.includes(filters.entityType)) continue;
      }
      rows.push({
        ...launcher,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
        uiEntryFile: contribution.uiEntryFile,
      });
    }
  }
  return rows.sort(byOrderThenName);
}

/** The value of a plugin detail tab in an address: `plugin:<pluginKey>:<slotId>`. */
export function pluginTabValue(slot: Pick<ResolvedPluginSlot, "pluginKey" | "id">) {
  return `plugin:${slot.pluginKey}:${slot.id}`;
}

export function isPluginTab(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("plugin:");
}

/**
 * The `routeSidebar` slot that pairs with the one `page` slot for a route, or null when there's no
 * unambiguous pair.
 */
export function resolveRouteSidebarSlot(slots: readonly ResolvedPluginSlot[], routePath: string | null): ResolvedPluginSlot | null {
  if (!routePath) return null;
  const pages = slots.filter((slot) => slot.type === "page" && slot.routePath === routePath);
  if (pages.length !== 1) return null;
  const sidebars = slots.filter((slot) => slot.type === "routeSidebar" && slot.routePath === routePath && slot.pluginId === pages[0]!.pluginId);
  return sidebars.length === 1 ? sidebars[0]! : null;
}

export type PluginPageMatch =
  | { kind: "page"; slot: ResolvedPluginSlot; routeSidebar: ResolvedPluginSlot | null; routePath: string | null }
  /** Two plugins claim the same route. */
  | { kind: "conflict"; routePath: string }
  /** `/plugins/:pluginId` for a plugin without a page: its settings are the useful place. */
  | { kind: "no-page"; pluginId: string }
  | { kind: "none" };

/**
 * Which plugin page an address inside a company opens, given what follows the company prefix:
 * `<routePath>/*` for a page that declares a route (the old UI's `/:companyPrefix/:pluginRoutePath/*`),
 * or `plugins/<pluginId>` for a plugin's page by id.
 */
export function resolvePluginPage(contributions: readonly PluginUiContribution[] | undefined, rest: string): PluginPageMatch {
  const segments = rest.split("/").filter(Boolean).map(decodeSegment);
  const [first, second] = segments;
  if (!first) return { kind: "none" };
  const all = resolveSlots(contributions, { slotTypes: ["page", "routeSidebar"] });
  if (first === "plugins" && second) {
    const page = all.find((slot) => slot.type === "page" && (slot.pluginId === second || slot.pluginKey === second));
    if (page) return { kind: "page", slot: page, routeSidebar: null, routePath: null };
    const known = (contributions ?? []).some((c) => c.pluginId === second || c.pluginKey === second);
    return known ? { kind: "no-page", pluginId: second } : { kind: "none" };
  }
  const pages = all.filter((slot) => slot.type === "page" && slot.routePath === first);
  if (pages.length > 1) return { kind: "conflict", routePath: first };
  if (pages.length === 0) return { kind: "none" };
  return { kind: "page", slot: pages[0]!, routeSidebar: resolveRouteSidebarSlot(all, first), routePath: first };
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The context a plugin component receives (`useHostContext()` and its `context` prop). */
export function hostContextFor(context: PluginSlotContext, userId: string | null): PluginHostContext & { projectRef?: string | null } {
  return {
    companyId: context.companyId ?? null,
    companyPrefix: context.companyPrefix ?? null,
    projectId: context.projectId ?? (context.entityType === "project" ? (context.entityId ?? null) : null),
    entityId: context.entityId ?? null,
    entityType: context.entityType ?? null,
    parentEntityId: context.parentEntityId ?? null,
    userId,
    renderEnvironment: null,
    ...(context.projectRef ? { projectRef: context.projectRef } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Navigation from plugin links (ui/src/plugins/bridge.ts, ui/src/lib/company-routes.ts)

/** First path segments that live outside a company and never take its prefix. */
const GLOBAL_ROOTS = new Set([
  "auth",
  "invite",
  "board-claim",
  "cli-auth",
  "mcp-connect",
  "dot-connect",
  "mcp-device",
  "assistant-connections",
  "oauth-handoff",
  "chat-identity",
  "onboarding",
  "docs",
  "instance",
  "companies",
  "style-guide",
  "settings",
]);

export function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const match = path.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return { pathname: match?.[1] ?? path, search: match?.[2] ?? "", hash: match?.[3] ?? "" };
}

/** A same-origin path for `href`, or null for another site. */
export function sameOriginPath(href: string, origin = typeof window === "undefined" ? "" : window.location.origin): string | null {
  if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("//")) return href;
  if (!origin) return null;
  try {
    const url = new URL(href, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/**
 * Puts a plugin's Paperclip path into the current company: `/wiki` becomes `/PAP/wiki`. Paths
 * already in a company, global pages and other sites are left alone.
 */
export function resolveHostNavigationHref(to: string, companyPrefix: string | null | undefined, origin?: string): string {
  const local = sameOriginPath(to, origin);
  if (local === null) return to;
  const { pathname, search, hash } = splitPath(local);
  if (!pathname.startsWith("/") || !companyPrefix) return local;
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first || GLOBAL_ROOTS.has(first.toLowerCase())) return local;
  const prefix = companyPrefix.trim().toUpperCase();
  if (first.toUpperCase() === prefix) return local;
  return `/${prefix}${pathname}${search}${hash}`;
}

/** Where a `navigate` or `deepLink` launcher goes: a bare segment is relative to the company. */
export function launcherNavigationTarget(target: string, companyPrefix: string | null | undefined): string {
  if (/^https?:\/\//.test(target) || /^[/#.?]/.test(target)) return target;
  const prefix = companyPrefix?.trim();
  return prefix ? `/${prefix}/${target}` : target;
}

/**
 * A sidebar launcher that opens a plugin page with its own route sidebar is named after that
 * sidebar, as the old UI does.
 */
export function launcherDisplayName(launcher: ResolvedPluginLauncher, contribution: PluginUiContribution | undefined): string {
  if (launcher.placementZone !== "sidebar" || !contribution) return launcher.displayName;
  if (launcher.action.type !== "navigate" && launcher.action.type !== "deepLink") return launcher.displayName;
  if (/^https?:\/\//.test(launcher.action.target)) return launcher.displayName;
  const segment = launcher.action.target.split(/[?#]/, 1)[0]?.split("/").filter(Boolean).at(-1)?.toLowerCase();
  if (!segment) return launcher.displayName;
  const sidebar = contribution.slots.find((slot) => slot.type === "routeSidebar" && slot.routePath?.toLowerCase() === segment);
  return sidebar?.displayName ?? launcher.displayName;
}

/** Launchers that open a plugin component in a host modal, drawer or popover. */
export function opensComponent(launcher: Pick<PluginLauncherDeclaration, "action">) {
  return launcher.action.type === "openModal" || launcher.action.type === "openDrawer" || launcher.action.type === "openPopover";
}

/**
 * The page title for a plugin page with a route sidebar: the page's own sub-path when it names one
 * (`/wiki/page/Some-note` is "Some note"), else the slot's name. Ported from PluginPage.tsx.
 */
export function routeSidebarPageTitle(slot: Pick<ResolvedPluginSlot, "displayName" | "pluginDisplayName">, routeSplat: string | undefined): string {
  const segments = (routeSplat ?? "").split("/").filter(Boolean).map(decodeSegment);
  const title = segments.length === 0 ? null : segments[0] === "page" && segments.length > 1 ? titleFromPath(segments.slice(1).join("/"), true) : titleFromPath(segments[0]!, false);
  return title ?? slot.displayName ?? slot.pluginDisplayName;
}

function titleFromPath(path: string, preserveCase: boolean): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const basename = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  const name = (basename.split("::").at(-1) ?? basename).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  if (!name) return null;
  return preserveCase ? name : name.replace(/\b\w/g, (char) => char.toUpperCase());
}
