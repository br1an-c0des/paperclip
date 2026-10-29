import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createElement, type ReactNode } from "react";
import type { PluginOrganizationSwitcherProps } from "@paperclipai/plugin-sdk/ui";
import type { Company } from "@paperclipai/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { CompanyProvider } from "@/lib/company";
import { _resetPluginLoader, registerPluginReactComponent } from "./loader";
import * as runtime from "./runtime";
import { PluginOrganizationSwitcher } from "./ShellPlugins";

const company = { id: "company-1", name: "Test Shop", issuePrefix: "TES", logoUrl: null } as unknown as Company;
const switcherSlot = { type: "organizationSwitcher" as const, id: "org", displayName: "Org", exportName: "OrgSwitcher" };
const contribution = (key: string): PluginUiContribution => ({
  pluginId: key,
  pluginKey: key,
  displayName: key,
  version: "1",
  uiEntryFile: "index.js",
  slots: [switcherSlot],
  launchers: [],
});

let client: QueryClient;

function renderSwitcher() {
  const history = createMemoryHistory();
  history.set({ value: "/TES/dashboard" });
  return render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter
        history={history}
        root={() => (
          <CompanyProvider company={company}>
            <PluginOrganizationSwitcher>
              <button type="button">Built-in switcher</button>
            </PluginOrganizationSwitcher>
          </CompanyProvider>
        )}
      >
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

/** A plugin switcher: the company's name, its icon, and a toggle that reports the open state. */
function PluginSwitcher(props: PluginOrganizationSwitcherProps) {
  const switcher = props.organizationSwitcher;
  return createElement(
    "button",
    { type: "button", onClick: () => switcher.onOpenChange(!switcher.open) },
    switcher.renderIcon(switcher.currentCompany?.name ?? "", null, false) as ReactNode,
    `${switcher.currentCompany?.name}: ${switcher.open ? "open" : "closed"}`,
  );
}

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
});

describe("PluginOrganizationSwitcher", () => {
  it("keeps the built-in switcher without a plugin", () => {
    client.setQueryData(queryKeys.plugins.uiContributions, []);
    renderSwitcher();
    expect(screen.getByText("Built-in switcher")).toBeTruthy();
  });

  it("never picks a winner between two plugins", async () => {
    registerPluginReactComponent("a", "OrgSwitcher", PluginSwitcher);
    registerPluginReactComponent("b", "OrgSwitcher", PluginSwitcher);
    client.setQueryData(queryKeys.plugins.uiContributions, [contribution("a"), contribution("b")]);
    renderSwitcher();
    await Promise.resolve();
    expect(screen.getByText("Built-in switcher")).toBeTruthy();
    expect(screen.queryByText(/Test Shop:/)).toBeNull();
  });

  it("replaces the switcher with the one plugin that offers one, and holds its open state", async () => {
    registerPluginReactComponent("a", "OrgSwitcher", PluginSwitcher);
    client.setQueryData(queryKeys.plugins.uiContributions, [contribution("a")]);
    renderSwitcher();
    const button = await screen.findByText("Test Shop: closed");
    expect(button.querySelector(".disc-avatar")?.textContent).toBe("TS");
    await waitFor(() => expect(screen.queryByText("Built-in switcher")).toBeNull());
    fireEvent.click(button);
    await screen.findByText("Test Shop: open");
  });

  it("falls back to the built-in switcher when the plugin throws", async () => {
    registerPluginReactComponent("a", "OrgSwitcher", () => {
      throw new Error("boom");
    });
    client.setQueryData(queryKeys.plugins.uiContributions, [contribution("a")]);
    renderSwitcher();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Built-in switcher")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
