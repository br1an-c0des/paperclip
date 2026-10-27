import type { Company } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandsProvider } from "@/lib/commands";
import { CompanyProvider } from "@/lib/company";
import { PhoneDock } from "./PhoneDock";

const companies = [
  { id: "c1", name: "Test Shell Co", issuePrefix: "TST" },
  { id: "c2", name: "Northline Studio", issuePrefix: "NOR" },
] as Company[];

vi.mock("@/lib/company-data", () => ({
  useSidebarBadgesQuery: () => ({ data: { inbox: 3 } }),
  useAgentsQuery: () => ({ data: [{ id: "a1", name: "Quill", status: "idle", urlKey: "quill" }] }),
  useLiveRunsQuery: () => ({ data: [] }),
  useProjectsQuery: () => ({
    data: [
      { id: "p1", name: "Trading bench", urlKey: "trading-bench", taskCount: 16, archivedAt: null },
      { id: "p2", name: "Old work", urlKey: "old-work", taskCount: 2, archivedAt: "2026-01-01" },
    ],
  }),
}));

vi.mock("@/lib/company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company")>()),
  useCompaniesQuery: () => ({ data: companies }),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => true, session: () => ({ user: { email: "board@example.test" } }) }),
  useYouName: () => () => "Board Owner",
  useSignOut: () => async () => {},
}));

vi.mock("@/api/companies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/companies")>()),
  companiesApi: { stats: async () => ({ c1: { agentCount: 1, issueCount: 34 }, c2: { agentCount: 3, issueCount: 9 } }) },
}));

function renderDock(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <CompanyProvider company={companies[0]!}>
        <CommandsProvider>
          <MemoryRouter
            history={history}
            root={(props) => (
              <>
                {props.children}
                <PhoneDock />
              </>
            )}
          >
            <Route path="*" component={() => null} />
          </MemoryRouter>
        </CommandsProvider>
      </CompanyProvider>
    </QueryClientProvider>
  ));
  return history;
}

describe("PhoneDock", () => {
  afterEach(cleanup);

  it("is a labelled nav that marks the current place and names the others", () => {
    renderDock("/TST/inbox");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const inbox = screen.getByRole("link", { name: "Inbox, 3 need you" });
    expect(nav.contains(inbox)).toBe(true);
    expect(inbox.getAttribute("aria-current")).toBe("page");
    expect(inbox.textContent).toContain("Inbox");

    const tasks = screen.getByRole("link", { name: "Tasks" });
    expect(tasks.getAttribute("href")).toBe("/TST/issues");
    expect(tasks.hasAttribute("aria-current")).toBe(false);
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/TST/agents");
    expect(screen.getByRole("button", { name: "New task" })).toBeTruthy();
  });

  it("opens the switcher from Tasks and closes it again", async () => {
    renderDock("/TST/projects/trading-bench");
    const tasks = screen.getByRole("button", { name: /Tasks/ });
    expect(tasks.getAttribute("aria-current")).toBe("page");
    expect(tasks.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(tasks);
    const sheet = screen.getByRole("dialog", { name: "Switch project" });
    expect(tasks.getAttribute("aria-expanded")).toBe("true");
    expect(tasks.textContent).toContain("Trading bench");
    const current = screen.getByRole("link", { name: /Trading bench/ });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Old work")).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: /All tasks/ }).textContent).toContain("34"));

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(tasks);

    fireEvent.click(tasks);
    fireEvent.click(tasks);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches companies from the company name, and opens You from the avatar", async () => {
    renderDock("/TST/issues");
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));
    fireEvent.click(screen.getByRole("button", { name: "Test Shell Co, switch company" }));

    screen.getByRole("dialog", { name: "Switch company" });
    const other = screen.getByRole("link", { name: /Northline Studio/ });
    expect(other.getAttribute("href")).toBe("/NOR/issues");
    await waitFor(() => expect(other.textContent).toContain("3 agents · 9 tasks"));
    expect(screen.getByRole("link", { name: /Test Shell Co/ }).getAttribute("aria-current")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "You: profile, theme and notifications" }));
    screen.getByRole("dialog", { name: "You" });
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
    screen.getByRole("dialog", { name: "Switch project" });
  });

  it("closes the sheet when a link in it changes the page", async () => {
    const history = renderDock("/TST/issues");
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));
    fireEvent.click(screen.getByRole("link", { name: /Trading bench/ }));
    await waitFor(() => expect(history.get()).toBe("/TST/projects/trading-bench"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
