import type { Company } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandsProvider, useCommands } from "@/lib/commands";
import { CompanyProvider } from "@/lib/company";
import { Nav } from "./Nav";

const companies = [
  { id: "c1", name: "Test Shell Company With A Very Long Name", issuePrefix: "TST" },
  { id: "c2", name: "Northline Studio", issuePrefix: "NOR" },
] as Company[];

const projects = [
  { id: "p1", name: "Trading bench", urlKey: "trading-bench", taskCount: 16, archivedAt: null },
  { id: "p2", name: "Web", urlKey: "web", taskCount: 2, archivedAt: null },
];

const starredIds: string[] = [];

vi.mock("@/inbox/needs-you", () => ({ useNeedsYouCount: () => () => 0 }));

vi.mock("@/lib/company-data", () => ({
  useExperimentalSettingsQuery: () => ({ data: { enableStatusCards: false } }),
  useAgentsQuery: () => ({ data: [] }),
  useLiveRunsQuery: () => ({ data: [] }),
  useProjectsQuery: () => ({ data: projects }),
}));

vi.mock("@/lib/company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company")>()),
  useCompaniesQuery: () => ({ data: companies }),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => false, session: () => null, youId: () => "local-board", health: () => undefined }),
  useYouName: () => () => "Board Owner",
  useSignOut: () => async () => {},
}));

vi.mock("@/layout/nav-prefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nav-prefs")>()),
  useProjectStars: () => ({
    memberships: { data: { starredProjectIds: starredIds, projectMemberships: {} }, isLoading: false },
    starred: (id: string) => starredIds.includes(id),
    toggle: () => {},
    leave: async () => {},
  }),
  useProjectOrder: () => ({ ordered: <T,>(items: T[]) => items, settled: () => true, move: () => {} }),
  useCompanyOrder: () => ({ ordered: <T,>(items: T[]) => items }),
  useRecentTasks: () => () => [],
}));

vi.mock("@/agents/AgentStar", () => ({
  useAgentStars: () => ({ memberships: { data: undefined }, starred: () => false, toggle: () => {} }),
  useAgentPinOrder: () => ({ order: () => [], save: () => {} }),
}));
vi.mock("@/onboarding/can-create", () => ({ useCanCreateCompany: () => () => ({ allowed: true }) }));
vi.mock("@/org/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/org/actions")>()),
  useAgentActions: () => ({ busy: () => null, wake: async () => {}, pause: async () => {}, resume: async () => {} }),
}));
vi.mock("@/chat/chat-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/chat-read")>()),
  useUnreadChats: () => ({ countFor: () => 0, count: () => 0, messages: () => 0 }),
}));
vi.mock("@/shell/ServerInfo", () => ({ ServerInfo: () => null }));
vi.mock("@/plugins/NavPlugins", () => ({ NavPlugins: () => null, NavProjectPlugins: () => null }));
vi.mock("@/plugins/ShellPlugins", () => ({
  GlobalToolbarPlugins: () => null,
  PluginOrganizationSwitcher: (props: { children: JSX.Element }) => <div data-testid="org-switcher">{props.children}</div>,
}));

function Spy() {
  const commands = useCommands();
  return <span data-testid="spy" data-palette={String(commands.paletteOpen())} data-new-task={String(commands.newTask() !== null)} />;
}

function renderNav(path: string) {
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
                <Spy />
                <Nav />
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

const companyLink = () => screen.getByRole("link", { name: /Test Shell Company/ });

describe("Nav", () => {
  afterEach(() => {
    cleanup();
    starredIds.length = 0;
  });

  it("has a company row linking to the dashboard instead of Org dashboard", () => {
    renderNav("/TST/dashboard");
    expect(screen.queryByRole("link", { name: "Org dashboard" })).toBeNull();
    const link = companyLink();
    expect(link.getAttribute("href")).toBe("/TST/dashboard");
    expect(link.classList.contains("active")).toBe(true);
    expect(link.getAttribute("aria-current")).toBe("page");
    // The plugin switcher wraps the whole row, so a plugin can replace it.
    expect(screen.getByTestId("org-switcher").contains(link)).toBe(true);
    expect(screen.getByTestId("org-switcher").contains(screen.getByRole("button", { name: "Switch company" }))).toBe(true);
  });

  it("raises the company row on every organization page, without aria-current", () => {
    renderNav("/TST/agents");
    expect(companyLink().classList.contains("active")).toBe(true);
    expect(companyLink().hasAttribute("aria-current")).toBe(false);
    cleanup();
    renderNav("/TST/inbox");
    expect(companyLink().classList.contains("active")).toBe(false);
    cleanup();
    renderNav("/TST/agents/quill");
    expect(companyLink().classList.contains("active")).toBe(false);
  });

  it("opens the company menu from the switch button only", async () => {
    const history = renderNav("/TST/inbox");
    fireEvent.click(companyLink());
    await waitFor(() => expect(history.get()).toBe("/TST/dashboard"));
    expect(screen.queryByRole("menu", { name: "Companies" })).toBeNull();

    const button = screen.getByRole("button", { name: "Switch company" });
    fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });
    fireEvent.click(button);
    expect(await screen.findByRole("menuitem", { name: /Northline Studio/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /All companies/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Create organization/ })).toBeTruthy();
  });

  it("opens the palette from the search field and a new task from Task", () => {
    renderNav("/TST/inbox");
    const search = screen.getByRole("button", { name: "Search and commands" });
    expect(search.textContent).toContain("Search…");
    fireEvent.click(search);
    expect(screen.getByTestId("spy").dataset.palette).toBe("true");
    const task = screen.getByRole("button", { name: "New task" });
    expect(task.getAttribute("aria-keyshortcuts")).toBe("C");
    expect(task.textContent).toContain("Task");
    fireEvent.click(task);
    expect(screen.getByTestId("spy").dataset.newTask).toBe("true");
  });

  it("has no settings button beside you", () => {
    renderNav("/TST/inbox");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Board Owner: account and appearance" })).toBeTruthy();
  });

  it("links projects to their task list and keeps them raised on all their pages", () => {
    starredIds.push("p2");
    renderNav("/TST/projects/trading-bench");
    const bench = screen.getByRole("link", { name: /Trading bench/ });
    expect(bench.getAttribute("href")).toBe("/TST/projects/trading-bench/issues");
    expect(bench.classList.contains("active")).toBe(true);
    expect(bench.hasAttribute("aria-current")).toBe(false);
    // A starred project shares the row, and the link.
    const web = screen.getByRole("link", { name: /Web/ });
    expect(web.getAttribute("href")).toBe("/TST/projects/web/issues");
    expect(web.classList.contains("active")).toBe(false);
    cleanup();

    for (const page of ["/TST/projects/trading-bench/issues", "/TST/projects/trading-bench/board", "/TST/projects/trading-bench/settings", "/TST/projects/p1/issues"]) {
      renderNav(page);
      expect(screen.getByRole("link", { name: /Trading bench/ }).classList.contains("active"), page).toBe(true);
      cleanup();
    }

    renderNav("/TST/projects/trading-bench-2/issues");
    expect(screen.getByRole("link", { name: /Trading bench/ }).classList.contains("active")).toBe(false);
  });
});
