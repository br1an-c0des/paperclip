import { describe, expect, it } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import {
  hostContextFor,
  launcherDisplayName,
  launcherNavigationTarget,
  pluginTabValue,
  resolveHostNavigationHref,
  resolveLaunchers,
  resolvePluginPage,
  resolveRouteSidebarSlot,
  resolveSlots,
  routeSidebarPageTitle,
} from "./model";

const wiki: PluginUiContribution = {
  pluginId: "p-wiki",
  pluginKey: "acme.wiki",
  displayName: "Wiki",
  version: "1.0.0",
  uiEntryFile: "index.js",
  slots: [
    { type: "page", id: "page", displayName: "Wiki", exportName: "WikiPage", routePath: "wiki" },
    { type: "routeSidebar", id: "sidebar", displayName: "Wiki pages", exportName: "WikiSidebar", routePath: "wiki" },
    { type: "sidebar", id: "nav", displayName: "Wiki link", exportName: "WikiLink", order: 2 },
    { type: "detailTab", id: "agent-notes", displayName: "Notes", exportName: "AgentNotes", entityTypes: ["agent"] },
    { type: "detailTab", id: "agent-live", displayName: "Live", exportName: "AgentLive", entityTypes: ["agent"], taskSidePanel: { availabilityPath: "/live/:entityId" } },
  ],
  launchers: [{ id: "open", displayName: "Open wiki", placementZone: "sidebar", action: { type: "navigate", target: "wiki" } }],
};

const board: PluginUiContribution = {
  pluginId: "p-board",
  pluginKey: "acme.board",
  displayName: "Board",
  version: "0.2.0",
  uiEntryFile: "index.js",
  slots: [
    { type: "sidebar", id: "nav", displayName: "Board link", exportName: "BoardLink", order: 1 },
    { type: "detailTab", id: "project-board", displayName: "Board", exportName: "ProjectBoard", entityTypes: ["project"] },
    { type: "toolbarButton", id: "tool", displayName: "Tool", exportName: "Tool", entityTypes: ["issue"] },
  ],
  launchers: [{ id: "modal", displayName: "Quick add", placementZone: "toolbarButton", entityTypes: ["project"], action: { type: "openModal", target: "QuickAdd" } }],
};

describe("resolveSlots", () => {
  it("keeps the requested types, in declared order, then by plugin and slot name", () => {
    const slots = resolveSlots([wiki, board], { slotTypes: ["sidebar"] });
    expect(slots.map((slot) => `${slot.pluginKey}:${slot.id}`)).toEqual(["acme.board:nav", "acme.wiki:nav"]);
    expect(slots[0]).toMatchObject({ pluginId: "p-board", pluginDisplayName: "Board", pluginVersion: "0.2.0" });
  });

  it("needs a matching entity type for entity-scoped slots", () => {
    expect(resolveSlots([wiki, board], { slotTypes: ["detailTab"] })).toEqual([]);
    expect(resolveSlots([wiki, board], { slotTypes: ["detailTab"], entityType: "project" }).map((slot) => slot.id)).toEqual(["project-board"]);
    expect(resolveSlots([wiki, board], { slotTypes: ["toolbarButton"], entityType: "project" })).toEqual([]);
  });

  it("keeps only agent tabs that opted into the task side panel when asked", () => {
    expect(resolveSlots([wiki], { slotTypes: ["detailTab"], entityType: "agent" }).map((slot) => slot.id)).toEqual(["agent-live", "agent-notes"]);
    expect(resolveSlots([wiki], { slotTypes: ["detailTab"], entityType: "agent", taskSidePanel: true }).map((slot) => slot.id)).toEqual(["agent-live"]);
  });

  it("names a detail tab as the old UI's addresses do", () => {
    expect(pluginTabValue({ pluginKey: "acme.wiki", id: "agent-notes" })).toBe("plugin:acme.wiki:agent-notes");
  });
});

describe("resolveLaunchers", () => {
  it("filters by zone and entity", () => {
    expect(resolveLaunchers([wiki, board], { placementZones: ["sidebar"] }).map((launcher) => launcher.id)).toEqual(["open"]);
    expect(resolveLaunchers([wiki, board], { placementZones: ["toolbarButton"] })).toEqual([]);
    expect(resolveLaunchers([wiki, board], { placementZones: ["toolbarButton"], entityType: "project" })[0]).toMatchObject({ id: "modal", uiEntryFile: "index.js" });
  });

  it("names a sidebar launcher after the route sidebar of the page it opens", () => {
    const [launcher] = resolveLaunchers([wiki], { placementZones: ["sidebar"] });
    expect(launcherDisplayName(launcher!, wiki)).toBe("Wiki pages");
  });

  it("puts bare launcher targets in the company", () => {
    expect(launcherNavigationTarget("wiki", "TES")).toBe("/TES/wiki");
    expect(launcherNavigationTarget("/TES/wiki", "TES")).toBe("/TES/wiki");
    expect(launcherNavigationTarget("https://example.com", "TES")).toBe("https://example.com");
  });
});

describe("resolvePluginPage", () => {
  it("finds the page that owns a route, with its route sidebar", () => {
    const match = resolvePluginPage([wiki, board], "wiki/page/Some-note");
    expect(match.kind).toBe("page");
    if (match.kind !== "page") return;
    expect(match.slot.exportName).toBe("WikiPage");
    expect(match.routeSidebar?.exportName).toBe("WikiSidebar");
  });

  it("opens a plugin's page by id, and sends a plugin without one to its settings", () => {
    expect(resolvePluginPage([wiki], "plugins/p-wiki")).toMatchObject({ kind: "page", routeSidebar: null });
    expect(resolvePluginPage([wiki, board], "plugins/p-board")).toEqual({ kind: "no-page", pluginId: "p-board" });
    expect(resolvePluginPage([wiki], "plugins/unknown")).toEqual({ kind: "none" });
  });

  it("reports two plugins claiming one route, and leaves other addresses alone", () => {
    const twin = { ...wiki, pluginId: "p-twin", pluginKey: "other.wiki" };
    expect(resolvePluginPage([wiki, twin], "wiki")).toEqual({ kind: "conflict", routePath: "wiki" });
    expect(resolvePluginPage([wiki], "goals")).toEqual({ kind: "none" });
    expect(resolvePluginPage(undefined, "wiki")).toEqual({ kind: "none" });
  });

  it("pairs a route sidebar only with one page of the same plugin", () => {
    const slots = resolveSlots([wiki, { ...board, slots: [{ type: "routeSidebar", id: "x", displayName: "X", exportName: "X", routePath: "wiki" }] }], {
      slotTypes: ["page", "routeSidebar"],
    });
    expect(resolveRouteSidebarSlot(slots, "wiki")?.pluginId).toBe("p-wiki");
    expect(resolveRouteSidebarSlot(slots, null)).toBeNull();
  });

  it("titles a route-sidebar page from its sub-path", () => {
    const slot = { displayName: "Wiki", pluginDisplayName: "Wiki" };
    expect(routeSidebarPageTitle(slot, "page/notes/Some-note.md")).toBe("Some note");
    expect(routeSidebarPageTitle(slot, "recent-changes")).toBe("Recent Changes");
    expect(routeSidebarPageTitle(slot, "")).toBe("Wiki");
  });
});

describe("host context and navigation", () => {
  it("gives a project tab its project as the project", () => {
    expect(hostContextFor({ companyId: "c1", companyPrefix: "TES", entityId: "p1", entityType: "project", projectRef: "bench" }, "u1")).toEqual({
      companyId: "c1",
      companyPrefix: "TES",
      projectId: "p1",
      entityId: "p1",
      entityType: "project",
      parentEntityId: null,
      userId: "u1",
      renderEnvironment: null,
      projectRef: "bench",
    });
  });

  it("resolves plugin paths into the active company", () => {
    const origin = "http://localhost:5177";
    expect(resolveHostNavigationHref("/wiki", "tes", origin)).toBe("/TES/wiki");
    expect(resolveHostNavigationHref("/wiki?x=1#a", "TES", origin)).toBe("/TES/wiki?x=1#a");
    expect(resolveHostNavigationHref("/TES/wiki", "TES", origin)).toBe("/TES/wiki");
    expect(resolveHostNavigationHref("/auth", "TES", origin)).toBe("/auth");
    expect(resolveHostNavigationHref("http://localhost:5177/wiki", "TES", origin)).toBe("/TES/wiki");
    expect(resolveHostNavigationHref("https://example.com/x", "TES", origin)).toBe("https://example.com/x");
    expect(resolveHostNavigationHref("/wiki", null, origin)).toBe("/wiki");
  });
});
