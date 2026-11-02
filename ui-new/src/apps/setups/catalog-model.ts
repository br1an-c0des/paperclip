import type { AggregatorAppSnapshot, AggregatorAppsResponse, AppDefinition, ToolConnection } from "@paperclipai/shared";
import type { AggregatorAppCatalogEntry, AggregatorAppRoute } from "@paperclipai/shared/aggregator-app-catalog";
import { connectionState } from "../apps-model";
import { aggregatorOf, type AggregatorId } from "./setups-model";

/*
 * View model for the Composio and Arcade rows in Browse's gallery (the old UI's Browse catalog
 * sources, AggregatorConnectDialog and AggregatorAppManager):
 *
 * - The public catalog of apps each provider can connect (the shared package's
 *   `aggregator-app-catalog`, about 1,600 apps) becomes one row per app, unless Paperclip connects
 *   the app itself; then the gallery's own app wins.
 * - A row lists the accounts the company's Composio and Arcade gateways have seen for it upstream.
 *   These are observations: they don't give agents access, the gateway's actions do.
 * - Connecting one goes through a saved gateway: Composio connects the app in place (start, sign in
 *   to the app in Composio, then confirm); Arcade sends you to Arcade. With no gateway yet, Connect
 *   sets one up first (`/apps/connect?source=composio|arcade`).
 *
 * Executor routes appear in the catalog only from observed accounts, and ui-new has no Executor
 * gateway setup, so they're left out.
 */

export type CatalogSource = "paperclip" | "composio" | "arcade" | "all";

export const CATALOG_SOURCES: { value: CatalogSource; label: string }[] = [
  { value: "paperclip", label: "Paperclip" },
  { value: "composio", label: "Composio" },
  { value: "arcade", label: "Arcade" },
  { value: "all", label: "All" },
];

export const PROVIDER_NAMES: Record<AggregatorId, string> = { composio: "Composio", arcade: "Arcade" };

export type CatalogRoute = AggregatorAppRoute & { provider: AggregatorId };

export type ObservedAccount = { snapshot: AggregatorAppSnapshot; account: AggregatorAppSnapshot["accounts"][number]; connectionId: string };

export type CatalogRow = {
  slug: string;
  name: string;
  aliases: string[];
  routes: CatalogRoute[];
  logoUrl: string | null;
  accounts: ObservedAccount[];
  /** The gallery app Paperclip connects itself that this is the same service as, if any. */
  nativeSlug: string | null;
};

/**
 * One row per catalog app, with its Composio and Arcade routes and the accounts seen for it. A row
 * for an app Paperclip also connects itself names that app (`nativeSlug`): Paperclip's own source
 * shows the gallery's tile instead, with the accounts seen through a gateway on it. `identity` is
 * the catalog's own matching rule (`aggregatorAppIdentity`), so "Google Sheets", "googlesheets" and
 * "google_sheets" meet.
 */
export function catalogRows(
  catalog: readonly AggregatorAppCatalogEntry[],
  native: readonly Pick<AppDefinition, "slug" | "name">[],
  observed: readonly AggregatorAppsResponse[],
  identity: (value: string) => string,
): CatalogRow[] {
  const nativeIds = new Map<string, string>();
  for (const app of native) for (const value of [app.name, app.slug]) nativeIds.set(identity(value), app.slug);
  const accountsBySlug = observedAccounts(observed);
  const rows: CatalogRow[] = [];
  for (const entry of catalog) {
    const nativeSlug = [entry.name, entry.slug, ...entry.aliases].map((alias) => nativeIds.get(identity(alias))).find(Boolean) ?? null;
    const routes = entry.routes.filter((route): route is CatalogRoute => route.provider === "composio" || route.provider === "arcade");
    if (routes.length === 0) continue;
    rows.push({
      slug: entry.slug,
      name: entry.name,
      aliases: entry.aliases,
      routes,
      logoUrl: routes.find((route) => route.logoUrl)?.logoUrl ?? null,
      accounts: accountsBySlug.get(entry.slug) ?? [],
      nativeSlug,
    });
  }
  return rows;
}

/** The accounts each gateway has seen upstream, by catalog app. */
export function observedAccounts(observed: readonly AggregatorAppsResponse[]): Map<string, ObservedAccount[]> {
  const bySlug = new Map<string, ObservedAccount[]>();
  for (const response of observed) {
    for (const snapshot of response.apps) {
      if (snapshot.provider !== "composio" && snapshot.provider !== "arcade") continue;
      for (const account of snapshot.accounts) {
        const list = bySlug.get(snapshot.appSlug) ?? [];
        list.push({ snapshot, account, connectionId: snapshot.connectionId });
        bySlug.set(snapshot.appSlug, list);
      }
    }
  }
  return bySlug;
}

/**
 * The rows a source and a search show. Paperclip's own source shows catalog rows only when
 * searching; it and All leave out the apps the gallery has itself.
 */
export function visibleCatalogRows(rows: readonly CatalogRow[], source: CatalogSource, query: string): CatalogRow[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (source === "paperclip" && terms.length === 0) return [];
  const scoped =
    source === "composio" || source === "arcade" ? rows.filter((row) => row.routes.some((route) => route.provider === source)) : rows.filter((row) => !row.nativeSlug);
  const matching = terms.length === 0 ? scoped : scoped.filter((row) => {
    const text = normalize([row.name, row.slug, ...row.aliases, ...row.accounts.map((item) => item.account.alias ?? "")].join(" "));
    return terms.every((term) => text.includes(term));
  });
  // Apps with accounts first, then by name.
  return matching.sort((a, b) => Number(b.accounts.length > 0) - Number(a.accounts.length > 0) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** The accounts seen through a gateway for each gallery app Paperclip also connects itself. */
export function nativeOverlaps(rows: readonly CatalogRow[]): Map<string, CatalogRow> {
  const result = new Map<string, CatalogRow>();
  for (const row of rows) {
    if (!row.nativeSlug || row.accounts.length === 0) continue;
    const existing = result.get(row.nativeSlug);
    result.set(row.nativeSlug, existing ? { ...existing, accounts: [...existing.accounts, ...row.accounts] } : row);
  }
  return result;
}

/** Whether Paperclip's own gallery shows under a source. */
export function showsNative(source: CatalogSource) {
  return source === "paperclip" || source === "all";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** How a row describes its routes: "Through Composio or Arcade." */
export function routesText(row: Pick<CatalogRow, "routes">) {
  return `Through ${row.routes.map((route) => PROVIDER_NAMES[route.provider]).join(" or ")}.`;
}

// ---------------------------------------------------------------------------------------------
// Gateways

/** The company's Composio and Arcade gateways (not archived). */
export function gatewaysByProvider(connections: readonly ToolConnection[]): Record<AggregatorId, ToolConnection[]> {
  const result: Record<AggregatorId, ToolConnection[]> = { composio: [], arcade: [] };
  for (const connection of connections) {
    const id = aggregatorOf(connection);
    if (id && connection.status !== "archived") result[id].push(connection);
  }
  return result;
}

/** A gateway agents can use right now: set up, on, and healthy. */
export function usableGateway(connection: ToolConnection) {
  return connection.status === "active" && connectionState(connection).kind === "connected";
}

/** How a provider's gateways stand, for the provider choice. */
export function gatewayStatus(gateways: readonly ToolConnection[]) {
  if (gateways.some(usableGateway)) return "Already connected";
  if (gateways.some((connection) => connection.status === "draft")) return "Setup incomplete";
  if (gateways.length > 0) return "Needs attention";
  return "Set up a gateway first";
}

/** Where a gateway is set up: a new one, or finishing a draft, for this app. */
export function gatewaySetupHref(base: string, route: Pick<CatalogRoute, "provider" | "toolkit">, resume?: ToolConnection | null) {
  const params = new URLSearchParams({ source: route.provider, targetToolkit: route.toolkit });
  if (resume?.status === "draft") params.set("resume", resume.id);
  return `${base}/connect?${params}`;
}

/**
 * What Connect on a row does first: straight to gateway setup when the only provider it can use has
 * no gateway, else the dialog (to pick a provider or an account).
 */
export function connectStart(routes: readonly CatalogRoute[], gateways: Record<AggregatorId, ToolConnection[]>): { kind: "setup"; route: CatalogRoute } | { kind: "dialog" } {
  if (routes.length === 1 && gateways[routes[0]!.provider].length === 0) return { kind: "setup", route: routes[0]! };
  return { kind: "dialog" };
}

/** The routes a row offers under a source: just that provider's when one is chosen. */
export function routesFor(row: Pick<CatalogRow, "routes">, source: CatalogSource): CatalogRoute[] {
  return source === "composio" || source === "arcade" ? row.routes.filter((route) => route.provider === source) : row.routes;
}
