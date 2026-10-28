import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createElement } from "react";
import type { JSX } from "solid-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { _resetPluginLoader, registerPluginReactComponent } from "./loader";
import { PluginSlotOutlet } from "./PluginSlot";
import * as runtime from "./runtime";

const contribution: PluginUiContribution = {
  pluginId: "fixture",
  pluginKey: "fixture.sidebar",
  displayName: "Fixture",
  version: "1",
  uiEntryFile: "index.js",
  slots: [
    { type: "sidebar", id: "nav", displayName: "Nav", exportName: "SidebarItem" },
    { type: "sidebarPanel", id: "panel", displayName: "Panel", exportName: "SidebarPanel" },
  ],
  launchers: [],
};
const context = { companyId: "company-1", companyPrefix: "TES" };

let client: QueryClient;

function renderWithHost(ui: () => JSX.Element) {
  const history = createMemoryHistory();
  history.set({ value: "/TES/dashboard" });
  return render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history} root={() => ui()}>
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

// The React runtime pulls in the icon library, whose first transform is slow under Vitest.
beforeAll(() => runtime.loadReactRuntime(), 60_000);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  client.clear();
  _resetPluginLoader();
  vi.unstubAllGlobals();
});

describe("PluginSlotOutlet", () => {
  it("renders nothing and never loads React when no plugin adds to it", async () => {
    const load = vi.spyOn(runtime, "loadReactRuntime");
    client.setQueryData(queryKeys.plugins.uiContributions, [{ ...contribution, slots: [{ type: "page", id: "p", displayName: "P", exportName: "P", routePath: "p" }] }]);
    const { container } = renderWithHost(() => <PluginSlotOutlet slotTypes={["sidebar"]} context={context} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps a failing plugin component inside its own slot", async () => {
    registerPluginReactComponent("fixture.sidebar", "SidebarItem", () => {
      throw new Error("boom");
    });
    registerPluginReactComponent("fixture.sidebar", "SidebarPanel", (props: { context: { companyPrefix: string } }) =>
      createElement("span", null, `Fixture panel for ${props.context.companyPrefix}`),
    );
    client.setQueryData(queryKeys.plugins.uiContributions, [contribution]);
    renderWithHost(() => <PluginSlotOutlet slotTypes={["sidebar", "sidebarPanel"]} context={context} />);
    await waitFor(() => expect(screen.getByText("Fixture panel for TES")).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Fixture: failed to render"));
  });

  it("shows a plugin whose UI bundle won't load as a note in its slot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" })));
    client.setQueryData(queryKeys.plugins.uiContributions, [{ ...contribution, slots: [contribution.slots[0]!] }]);
    renderWithHost(() => <PluginSlotOutlet slotTypes={["sidebar"]} context={context} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Fixture: couldn't load (Couldn't fetch the plugin's UI bundle (500 Server Error).)"));
  });

  it("says so when the plugin list can't load, unless asked to stay quiet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderWithHost(() => (
      <>
        <PluginSlotOutlet slotTypes={["sidebar"]} context={context} />
        <PluginSlotOutlet slotTypes={["sidebarPanel"]} context={context} errorBehavior="hidden" />
      </>
    ));
    await waitFor(() => expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual(["Plugin extensions unavailable: Failed to fetch"]));
  });
});
