import type { Company } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyProvider } from "@/lib/company";
import { ShellNav, useRememberAppPath } from "./SettingsNav";

const company = { id: "c1", name: "Test Shell Co", issuePrefix: "TST" } as Company;
const access = { isInstanceAdmin: true };
const hidden: string[] = [];
const pluginSlots: { type: string; id: string; displayName: string; exportName: string; routePath?: string }[] = [];

vi.mock("./Nav", () => ({ Nav: () => <p>Main nav</p> }));

vi.mock("@/lib/session", () => ({
  useSession: () => ({ health: () => ({ hiddenSettings: hidden }), youId: () => "user-1" }),
}));

vi.mock("@/api/access", () => ({
  accessApi: { currentBoardAccess: async () => ({ ...access, companyIds: ["c1"], userId: "user-1" }) },
}));

vi.mock("@/plugins/contributions", () => ({
  usePluginContributions: () => ({
    data: [{ pluginId: "p1", pluginKey: "linear", displayName: "Linear", version: "1.0.0", slots: pluginSlots }],
    isLoading: false,
    isError: false,
  }),
}));

function renderNav(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyProvider company={company}>
        <MemoryRouter
          history={history}
          root={(props) => {
            useRememberAppPath();
            return (
              <>
                <ShellNav />
                {props.children}
              </>
            );
          }}
        >
          <Route path="*" component={() => null} />
        </MemoryRouter>
      </CompanyProvider>
    </QueryClientProvider>
  ));
  return history;
}

const back = () => screen.getByRole("link", { name: "Back to app" });

describe("ShellNav", () => {
  afterEach(() => {
    cleanup();
    access.isInstanceAdmin = true;
    hidden.length = 0;
    pluginSlots.length = 0;
  });

  it("shows the main nav outside settings, and the settings sidebar inside", async () => {
    const history = renderNav("/TST/issues");
    expect(screen.getByText("Main nav")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Back to app" })).toBeNull();

    history.set({ value: "/TST/company/settings/members" });
    await waitFor(() => expect(screen.queryByText("Main nav")).toBeNull());
    expect(screen.getByText("Company settings")).toBeTruthy();
    expect(screen.getByText("Test Shell Co")).toBeTruthy();

    history.set({ value: "/TST/dashboard" });
    await waitFor(() => expect(screen.getByText("Main nav")).toBeTruthy());
  });

  it("goes back to the page you left, whichever settings sections you visit", async () => {
    const history = renderNav("/TST/projects/web?task=TST-4");
    history.set({ value: "/TST/company/settings" });
    await waitFor(() => expect(back().getAttribute("href")).toBe("/TST/projects/web?task=TST-4"));

    history.set({ value: "/TST/company/settings/secrets" });
    history.set({ value: "/TST/company/settings/instance/general" });
    await waitFor(() => expect(screen.getByText("App settings")).toBeTruthy());
    history.set({ value: "/TST/company/settings/budgets" });
    await waitFor(() => expect(screen.getByText("Company settings")).toBeTruthy());
    expect(back().getAttribute("href")).toBe("/TST/projects/web?task=TST-4");
  });

  it("raises the current Company settings section and lists plugins' settings pages", async () => {
    pluginSlots.push({ type: "companySettingsPage", id: "sync", displayName: "Linear sync", exportName: "Sync", routePath: "linear-sync" });
    renderNav("/TST/company/settings/members");
    const members = screen.getByRole("link", { name: "Members" });
    expect(members.getAttribute("aria-current")).toBe("page");
    expect(members.classList.contains("active")).toBe(true);
    // General sits at the area's root, so it isn't raised under another section.
    expect(screen.getByRole("link", { name: "General" }).classList.contains("active")).toBe(false);
    expect(screen.getByRole("link", { name: /Linear sync/ }).getAttribute("href")).toBe("/TST/company/settings/linear-sync");
    expect(screen.getByText("From plugins")).toBeTruthy();
  });

  it("gives an instance admin App settings' instance sections under their heading", async () => {
    renderNav("/TST/company/settings/instance/admins");
    await waitFor(() => expect(screen.getByRole("link", { name: "Admins" }).getAttribute("aria-current")).toBe("page"));
    expect(screen.getByText("This instance")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/TST/company/settings/instance/account");
  });

  it("gives everyone else Account only, and leaves out what the operator hides", async () => {
    access.isInstanceAdmin = false;
    renderNav("/TST/company/settings/instance/account");
    await waitFor(() => expect(screen.getByRole("link", { name: "Account" })).toBeTruthy());
    expect(screen.queryByText("This instance")).toBeNull();
    expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    cleanup();

    access.isInstanceAdmin = true;
    hidden.push("instance.plugins");
    renderNav("/TST/company/settings/instance/general");
    await waitFor(() => expect(screen.getByRole("link", { name: "General" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Plugins" })).toBeNull();
  });
});
