import type { Company } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnprefixedCompanyRedirect } from "@/activity/redirects";
import { CompanyProvider } from "@/lib/company";
import { AppsRedirect } from "./Legacy";

const companies = [{ id: "c1", name: "Test Co", issuePrefix: "TES" }] as Company[];

vi.mock("@/lib/company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company")>()),
  useCompaniesQuery: () => ({ data: companies, isLoading: false }),
  lastCompanyPrefix: () => "TES",
}));

/** Opens `path` with App.tsx's Apps routes, and returns the history to read where it landed. */
function open(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <CompanyProvider company={companies[0]!}>
      <MemoryRouter history={history}>
        <Route path={["/apps/*", "/connections/*"]} component={UnprefixedCompanyRedirect} />
        <Route path="/:companyPrefix">
          <Route path="/connections/*rest" component={() => <p>Connections</p>} />
          <Route path="/apps/*" component={AppsRedirect} />
        </Route>
      </MemoryRouter>
    </CompanyProvider>
  ));
  return history;
}

describe("Apps' old addresses", () => {
  afterEach(cleanup);

  it("open the same page under Connections, keeping the path, query and fragment", async () => {
    const history = open("/TES/apps/ai?x=1#y");
    await waitFor(() => expect(history.get()).toBe("/TES/connections/ai?x=1#y"));
  });

  it("open Connections itself from the bare address", async () => {
    const history = open("/TES/apps");
    await waitFor(() => expect(history.get()).toBe("/TES/connections"));
  });

  it("keep an OAuth return's query", async () => {
    const history = open("/TES/apps/c1/permissions?oauth=failed&code=github_installation_required");
    await waitFor(() => expect(history.get()).toBe("/TES/connections/c1/permissions?oauth=failed&code=github_installation_required"));
  });

  it("open Tailscale from the old connector page and its sign-in return (U156)", async () => {
    const history = open("/TES/apps/tailscale?tailscale_connection=n1&tailscale_error=cancelled");
    await waitFor(() => expect(history.get()).toBe("/TES/connections/tailscale?tailscale_connection=n1&tailscale_error=cancelled"));
    const bare = open("/apps/tailscale");
    await waitFor(() => expect(bare.get()).toBe("/TES/connections/tailscale"));
  });

  it("open in the last company when they have no prefix", async () => {
    const history = open("/apps/chat/connect?provider=slack&resume=e1#top");
    await waitFor(() => expect(history.get()).toBe("/TES/connections/chat/connect?provider=slack&resume=e1#top"));
    const bare = open("/connections/review");
    await waitFor(() => expect(bare.get()).toBe("/TES/connections/review"));
  });
});
