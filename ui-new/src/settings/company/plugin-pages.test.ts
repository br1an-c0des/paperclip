import { describe, expect, it } from "vitest";
import { pluginSettingsPages } from "./plugin-pages";

describe("pluginSettingsPages", () => {
  it("keeps company settings pages with a route, in order", () => {
    const pages = pluginSettingsPages([
      {
        pluginId: "p1",
        pluginKey: "linear",
        displayName: "Linear",
        version: "1.2.0",
        slots: [
          { type: "companySettingsPage", id: "sync", displayName: "Linear sync", exportName: "Sync", routePath: "linear-sync" },
          { type: "page", id: "board", displayName: "Board", exportName: "Board", routePath: "linear" },
          { type: "companySettingsPage", id: "noroute", displayName: "No route", exportName: "X" },
        ],
      },
      {
        pluginId: "p2",
        pluginKey: "acme",
        displayName: "Acme",
        version: "0.1.0",
        slots: [{ type: "companySettingsPage", id: "perm", displayName: "Permissions", exportName: "P", routePath: "permissions", order: 1 }],
      },
    ] as never);
    expect(pages).toEqual([
      { pluginId: "p2", pluginName: "Acme", version: "0.1.0", slotId: "perm", label: "Permissions", routePath: "permissions" },
      { pluginId: "p1", pluginName: "Linear", version: "1.2.0", slotId: "sync", label: "Linear sync", routePath: "linear-sync" },
    ]);
  });

  it("is empty without plugins", () => {
    expect(pluginSettingsPages(undefined)).toEqual([]);
  });
});
