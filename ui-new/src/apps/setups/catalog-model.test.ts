import type { AggregatorAppsResponse, ToolConnection } from "@paperclipai/shared";
import { AGGREGATOR_APP_CATALOG, aggregatorAppIdentity, type AggregatorAppCatalogEntry } from "@paperclipai/shared/aggregator-app-catalog";
import { describe, expect, it } from "vitest";
import {
  catalogRows,
  connectStart,
  gatewaySetupHref,
  gatewaysByProvider,
  gatewayStatus,
  nativeOverlaps,
  routesFor,
  routesText,
  usableGateway,
  visibleCatalogRows,
} from "./catalog-model";

const route = (provider: "composio" | "arcade" | "executor", toolkit: string) => ({ provider, toolkit, logoUrl: `https://logo/${toolkit}`, docsUrl: "" });
const entry = (slug: string, name: string, routes: ReturnType<typeof route>[], aliases: string[] = []): AggregatorAppCatalogEntry => ({ slug, name, aliases, routes });

const catalog = [
  entry("asana", "Asana", [route("composio", "asana"), route("arcade", "Asana")]),
  entry("linear", "Linear", [route("composio", "linear")]),
  entry("zendesk", "Zendesk", [route("arcade", "Zendesk")], ["zendesk_support"]),
  entry("custom", "Custom", [route("executor", "custom")]),
];

const observed: AggregatorAppsResponse = {
  provider: "composio",
  apps: [
    {
      connectionId: "gw-1",
      toolkit: "asana",
      status: "connected",
      accounts: [{ id: "acc-1", alias: "Work Asana", status: "ACTIVE", isDefault: true }],
      checkedAt: new Date().toISOString(),
      provider: "composio",
      appSlug: "asana",
      appName: "Asana",
      freshness: "fresh",
    },
  ],
  discovery: { availability: "available", message: null },
  sync: { status: "ready", coverage: "supported_catalog", checked: 1, total: 1, failed: 0, lastCompletedAt: null, error: null },
};

const connection = (over: Partial<ToolConnection>): ToolConnection =>
  ({ id: "c", name: "Composio", status: "active", enabled: true, healthStatus: "ok", transport: "mcp_remote", config: { sourceTemplateKey: "composio" }, ...over }) as ToolConnection;

describe("catalog rows", () => {
  it("leaves out Executor-only routes, marks apps Paperclip connects itself, and attaches seen accounts", () => {
    const rows = catalogRows(catalog, [{ slug: "linear", name: "Linear" }], [observed], aggregatorAppIdentity);
    expect(rows.map((row) => [row.slug, row.nativeSlug])).toEqual([
      ["asana", null],
      ["linear", "linear"],
      ["zendesk", null],
    ]);
    expect(rows[0]!.accounts.map((item) => item.account.alias)).toEqual(["Work Asana"]);
    expect(rows[0]!.logoUrl).toBe("https://logo/asana");
  });

  it("matches native apps by the catalog's identity rule", () => {
    const rows = catalogRows([entry("google-sheets", "Google Sheets", [route("composio", "googlesheets")], ["googlesheets"])], [{ slug: "google-sheets", name: "Google Sheets" }], [], aggregatorAppIdentity);
    expect(rows.map((row) => row.nativeSlug)).toEqual(["google-sheets"]);
  });

  it("hides apps the gallery has under Paperclip and All, shows them under their provider, and puts their accounts on the gallery tile", () => {
    const rows = catalogRows(catalog, [{ slug: "asana", name: "Asana" }], [observed], aggregatorAppIdentity);
    expect(visibleCatalogRows(rows, "all", "").map((row) => row.slug)).toEqual(["linear", "zendesk"]);
    expect(visibleCatalogRows(rows, "composio", "").map((row) => row.slug)).toEqual(["asana", "linear"]);
    const overlaps = nativeOverlaps(rows);
    expect([...overlaps.keys()]).toEqual(["asana"]);
    expect(overlaps.get("asana")!.accounts).toHaveLength(1);
  });

  it("shows nothing under Paperclip's source until a search, then the matches; providers show their own", () => {
    const rows = catalogRows(catalog, [], [observed], aggregatorAppIdentity);
    expect(visibleCatalogRows(rows, "paperclip", "")).toEqual([]);
    expect(visibleCatalogRows(rows, "paperclip", "zen").map((row) => row.slug)).toEqual(["zendesk"]);
    // Aliases and account names match too.
    expect(visibleCatalogRows(rows, "all", "support").map((row) => row.slug)).toEqual(["zendesk"]);
    expect(visibleCatalogRows(rows, "all", "work asana").map((row) => row.slug)).toEqual(["asana"]);
    expect(visibleCatalogRows(rows, "arcade", "").map((row) => row.slug)).toEqual(["asana", "zendesk"]);
    expect(visibleCatalogRows(rows, "composio", "").map((row) => row.slug)).toEqual(["asana", "linear"]);
  });

  it("puts apps with accounts first", () => {
    const rows = catalogRows(catalog, [], [observed], aggregatorAppIdentity);
    const zendeskWithAccount = { ...rows.find((row) => row.slug === "zendesk")!, accounts: [] };
    expect(visibleCatalogRows([zendeskWithAccount, ...rows.filter((row) => row.slug !== "zendesk")], "all", "")[0]!.slug).toBe("asana");
  });

  it("describes and narrows routes by source", () => {
    const [asana] = catalogRows(catalog, [], [], aggregatorAppIdentity);
    expect(routesText(asana!)).toBe("Through Composio or Arcade.");
    expect(routesFor(asana!, "arcade").map((item) => item.provider)).toEqual(["arcade"]);
    expect(routesFor(asana!, "all")).toHaveLength(2);
  });

  it("builds from the real shared catalog", () => {
    const rows = catalogRows(AGGREGATOR_APP_CATALOG, [], [], aggregatorAppIdentity);
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.every((row) => row.routes.every((item) => item.provider === "composio" || item.provider === "arcade"))).toBe(true);
  });
});

describe("gateways", () => {
  it("groups gateways by provider, leaving out archived ones", () => {
    const groups = gatewaysByProvider([
      connection({ id: "a" }),
      connection({ id: "b", config: { sourceTemplateKey: "arcade" } }),
      connection({ id: "c", status: "archived" }),
      connection({ id: "d", config: { sourceTemplateKey: "notion" } }),
    ]);
    expect(groups.composio.map((item) => item.id)).toEqual(["a"]);
    expect(groups.arcade.map((item) => item.id)).toEqual(["b"]);
  });

  it("says how a provider's gateways stand", () => {
    expect(usableGateway(connection({}))).toBe(true);
    expect(usableGateway(connection({ healthStatus: "failed" }))).toBe(false);
    expect(gatewayStatus([connection({})])).toBe("Already connected");
    expect(gatewayStatus([connection({ status: "draft" })])).toBe("Setup incomplete");
    expect(gatewayStatus([connection({ enabled: false })])).toBe("Needs attention");
    expect(gatewayStatus([])).toBe("Set up a gateway first");
  });

  it("goes straight to gateway setup only when the one provider has none", () => {
    const [asana, linear] = catalogRows(catalog, [], [], aggregatorAppIdentity);
    const none = { composio: [], arcade: [] };
    expect(connectStart(linear!.routes, none)).toEqual({ kind: "setup", route: linear!.routes[0] });
    expect(connectStart(asana!.routes, none)).toEqual({ kind: "dialog" });
    expect(connectStart(linear!.routes, { composio: [connection({})], arcade: [] })).toEqual({ kind: "dialog" });
    expect(gatewaySetupHref("/TES/apps", linear!.routes[0]!)).toBe("/TES/apps/connect?source=composio&targetToolkit=linear");
    expect(gatewaySetupHref("/TES/apps", linear!.routes[0]!, connection({ id: "d1", status: "draft" }))).toBe("/TES/apps/connect?source=composio&targetToolkit=linear&resume=d1");
  });
});
