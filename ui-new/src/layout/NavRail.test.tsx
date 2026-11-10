import type { Agent, Company, Project } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import { queryKeys } from "@/api/queryKeys";
import { CommandsProvider, useCommands } from "@/lib/commands";
import { CompanyProvider } from "@/lib/company";
import { NavRail } from "./NavRail";

/*
 * The icon rail against the real query layer, as Nav.refetch.test.tsx does the full nav: the
 * projects, agents, memberships, order and live runs sit in a QueryClient, and a refetch landing is
 * `setQueryData` with fresh objects.
 */

const company = { id: "c1", name: "Test Shell Co", issuePrefix: "TST" } as Company;
const other = { id: "c2", name: "Northline Studio", issuePrefix: "NOR" } as Company;
const YOU = "user-1";

vi.mock("@/plugins/NavPlugins", () => ({ NavPlugins: () => null, NavProjectPlugins: () => null }));
vi.mock("@/plugins/ShellPlugins", () => ({
  GlobalToolbarPlugins: () => null,
  PluginOrganizationSwitcher: (props: { children: unknown }) => props.children,
}));
vi.mock("@/shell/ServerInfo", () => ({ ServerInfo: () => null }));
vi.mock("@/inbox/needs-you", () => ({ useNeedsYouCount: () => () => 6 }));
vi.mock("@/onboarding/can-create", () => ({ useCanCreateCompany: () => () => ({ allowed: true }) }));
vi.mock("@/chat/chat-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/chat-read")>()),
  useUnreadChats: () => ({ countFor: (id: string) => (id === "a1" ? 2 : 0), count: () => 1, messages: () => 2 }),
}));
vi.mock("@/lib/company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company")>()),
  useCompaniesQuery: () => ({ data: [company, other] }),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => false, session: () => null, userId: () => YOU, youId: () => YOU }),
  useYouName: () => () => "Board Owner",
  useSignOut: () => async () => {},
}));

const project = (id: string, name: string, taskCount: number) =>
  ({ id, companyId: company.id, name, urlKey: name.toLowerCase().replace(/\s+/g, "-"), taskCount, archivedAt: null }) as unknown as Project;
const agent = (id: string, name: string, status: Agent["status"] = "idle") =>
  ({ id, companyId: company.id, name, urlKey: name.toLowerCase(), status }) as unknown as Agent;
const liveRun = (agentId: string) => ({ id: `run-${agentId}`, agentId, status: "running" }) as unknown as LiveRun;

const projectsKey = queryKeys.projects.list(company.id);
const agentsKey = queryKeys.agents.list(company.id);

function seededClient(options: { statusCards?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(projectsKey, [project("p1", "Alpha", 3), project("p2", "Bravo", 5), project("p3", "Charlie", 0)]);
  client.setQueryData(queryKeys.projectSettings.memberships(company.id), {
    projectMemberships: {},
    agentMemberships: {},
    starredProjectIds: ["p2"],
    starredAgentIds: ["a2"],
  });
  client.setQueryData(queryKeys.sidebarPreferences.projectOrder(company.id, YOU), { orderedIds: ["p3", "p1"], updatedAt: null });
  client.setQueryData(queryKeys.sidebarPreferences.companyOrder(YOU), { orderedIds: [], updatedAt: null });
  client.setQueryData(agentsKey, [agent("a1", "Ann"), agent("a2", "Ben"), agent("a3", "Cal", "paused"), agent("a4", "Dee")]);
  client.setQueryData(queryKeys.liveRuns(company.id), [liveRun("a4")]);
  client.setQueryData(queryKeys.instance.experimentalSettings, { enableStatusCards: options.statusCards ?? false });
  return client;
}

function Spy() {
  const commands = useCommands();
  return <span data-testid="spy" data-palette={String(commands.paletteOpen())} data-new-project={String(commands.newProject())} />;
}

function renderRail(client: QueryClient, path = "/TST/dashboard") {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <QueryClientProvider client={client}>
      <CompanyProvider company={company}>
        <CommandsProvider>
          <MemoryRouter
            history={history}
            root={(props) => (
              <>
                {props.children}
                <NavRail />
                <Spy />
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hover = (element: Element) => fireEvent.pointerEnter(element.closest(".rail-w")!, { pointerType: "mouse" });
const unhover = (element: Element) => fireEvent.pointerLeave(element.closest(".rail-w")!, { pointerType: "mouse" });
const icon = (name: string | RegExp) => screen.getByRole("button", { name });
const flyout = (name: string) => screen.queryByRole("dialog", { name });
const rowLabels = (dialog: HTMLElement) => [...dialog.querySelectorAll(".rail-row")].map((row) => row.querySelector(".rail-row-label")?.textContent);

describe("NavRail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the company, Search, Inbox, Projects, Agents and You; Status only with status cards on", () => {
    renderRail(seededClient());
    expect(screen.getByRole("link", { name: "Test Shell Co: dashboard" }).getAttribute("href")).toBe("/TST/dashboard");
    expect(icon("Search and commands")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inbox, 6 waiting" }).getAttribute("href")).toBe("/TST/inbox");
    expect(screen.queryByRole("link", { name: "Status" })).toBeNull();
    expect(icon("Projects")).toBeTruthy();
    // Dee runs; Ann has two unread replies.
    expect(icon("Agents, 1 running, 2 unread messages").classList.contains("rail-i--ringed")).toBe(true);
    expect(icon("Board Owner: account and appearance")).toBeTruthy();
    // No plugin sections, Recent tasks or Apps.
    expect(screen.queryByText("Apps")).toBeNull();
    cleanup();

    renderRail(seededClient({ statusCards: true }));
    expect(screen.getByRole("link", { name: "Status" }).getAttribute("href")).toBe("/TST/status");
  });

  it("raises the icon that owns the page", () => {
    renderRail(seededClient(), "/TST/dashboard");
    const companyLink = screen.getByRole("link", { name: "Test Shell Co: dashboard" });
    expect(companyLink.classList.contains("sel")).toBe(true);
    expect(companyLink.getAttribute("aria-current")).toBe("page");
    expect(icon("Projects").classList.contains("sel")).toBe(false);
    cleanup();

    renderRail(seededClient(), "/TST/projects/bravo/board");
    expect(icon("Projects").classList.contains("sel")).toBe(true);
    expect(screen.getByRole("link", { name: "Test Shell Co: dashboard" }).classList.contains("sel")).toBe(false);
    cleanup();

    renderRail(seededClient(), "/TST/agents/ann/chat");
    expect(icon(/^Agents/).classList.contains("sel")).toBe(true);
    cleanup();

    // The roster is an organization page: the company is raised, not Agents.
    renderRail(seededClient(), "/TST/agents");
    expect(icon(/^Agents/).classList.contains("sel")).toBe(false);
    expect(screen.getByRole("link", { name: "Test Shell Co: dashboard" }).classList.contains("sel")).toBe(true);
    cleanup();

    renderRail(seededClient(), "/TST/inbox");
    const inbox = screen.getByRole("link", { name: "Inbox, 6 waiting" });
    expect(inbox.classList.contains("sel")).toBe(true);
    expect(inbox.getAttribute("aria-current")).toBe("page");
  });

  it("opens Projects on hover after a moment, not on a pass, and closes once the pointer leaves", async () => {
    renderRail(seededClient());
    const projects = icon("Projects");
    hover(projects);
    await wait(100);
    unhover(projects);
    await wait(300);
    expect(flyout("Projects")).toBeNull();

    hover(projects);
    await wait(350);
    const dialog = flyout("Projects")!;
    expect(dialog).toBeTruthy();
    expect(projects.getAttribute("aria-expanded")).toBe("true");
    // Starred first, then your order.
    expect(rowLabels(dialog)).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(within(dialog).getByText("Starred")).toBeTruthy();

    // Into the flyout (part of the slot): it stays; out of both: it closes after a moment.
    unhover(projects);
    fireEvent.pointerEnter(projects.closest(".rail-w")!, { pointerType: "mouse" });
    await wait(300);
    expect(flyout("Projects")).toBeTruthy();
    unhover(projects);
    await wait(300);
    expect(flyout("Projects")).toBeNull();

    // Open again, then pass over Agents on the way out: Projects still closes, Agents doesn't open.
    hover(projects);
    await wait(350);
    unhover(projects);
    const agents = icon(/^Agents/);
    hover(agents);
    await wait(100);
    unhover(agents);
    await wait(350);
    expect(flyout("Projects")).toBeNull();
    expect(flyout("Agents")).toBeNull();
  });

  it("opens Agents on a click, one flyout at a time, and links its rows", async () => {
    renderRail(seededClient());
    fireEvent.click(icon("Projects"), { detail: 1 });
    expect(flyout("Projects")).toBeTruthy();
    fireEvent.click(icon(/^Agents/), { detail: 1 });
    expect(flyout("Projects")).toBeNull();
    const dialog = flyout("Agents")!;
    // Starred Ben first, then running Dee, then by name.
    expect(rowLabels(dialog)).toEqual(["Ben", "Dee", "Ann", "Cal"]);
    expect(within(dialog).getByText("1 running")).toBeTruthy();
    expect([...dialog.querySelectorAll(".rail-row")].map((row) => row.getAttribute("href"))).toEqual(["/TST/agents/ben", "/TST/agents/dee", "/TST/agents/ann", "/TST/agents/cal"]);
    expect(within(dialog).getByRole("img", { name: "2 unread messages from Ann" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "All agents" }).getAttribute("href")).toBe("/TST/agents");
    // A second click closes it.
    fireEvent.click(icon(/^Agents/), { detail: 1 });
    expect(flyout("Agents")).toBeNull();
  });

  it("links project rows to their task lists, with All projects, All tasks and New project", () => {
    renderRail(seededClient());
    fireEvent.click(icon("Projects"), { detail: 1 });
    const dialog = flyout("Projects")!;
    expect([...dialog.querySelectorAll(".rail-row")].map((row) => row.getAttribute("href"))).toEqual([
      "/TST/projects/bravo/issues",
      "/TST/projects/charlie/issues",
      "/TST/projects/alpha/issues",
    ]);
    expect(within(dialog).getByRole("link", { name: "All projects" }).getAttribute("href")).toBe("/TST/projects");
    expect(within(dialog).getByRole("link", { name: "All tasks" }).getAttribute("href")).toBe("/TST/issues");
    fireEvent.click(within(dialog).getByRole("button", { name: "New project" }));
    expect(screen.getByTestId("spy").dataset.newProject).toBe("true");
    expect(flyout("Projects")).toBeNull();
  });

  it("opens from the keyboard onto the first row, moves with the arrows, and Escape gives focus back", async () => {
    renderRail(seededClient());
    const projects = icon("Projects");
    projects.focus();
    // Enter and Space click a button with no pointer (detail 0).
    fireEvent.click(projects, { detail: 0 });
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Bravo"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Charlie");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(flyout("Projects")).toBeNull();
    expect(document.activeElement).toBe(projects);
    // ↓ on the icon opens it too.
    fireEvent.keyDown(projects, { key: "ArrowDown" });
    expect(flyout("Projects")).toBeTruthy();
  });

  it("keeps each flyout row's node when a refetch brings new objects", async () => {
    const client = seededClient();
    renderRail(client);
    fireEvent.click(icon("Projects"), { detail: 1 });
    const before = [...flyout("Projects")!.querySelectorAll(".rail-row")];
    client.setQueryData(projectsKey, [project("p1", "Alpha", 4), project("p2", "Bravo", 5), project("p3", "Charlie", 0)]);
    await waitFor(() => expect(flyout("Projects")!.querySelector('[href="/TST/projects/alpha/issues"] .rail-row-count')?.textContent).toBe("4"));
    const after = [...flyout("Projects")!.querySelectorAll(".rail-row")];
    after.forEach((row, index) => expect(row).toBe(before[index]));

    fireEvent.click(icon(/^Agents/), { detail: 1 });
    const agentsBefore = [...flyout("Agents")!.querySelectorAll(".rail-row")];
    client.setQueryData(agentsKey, [agent("a1", "Anne"), agent("a2", "Ben"), agent("a3", "Cal", "paused"), agent("a4", "Dee")]);
    await waitFor(() => expect(rowLabels(flyout("Agents")!)).toEqual(["Ben", "Dee", "Anne", "Cal"]));
    [...flyout("Agents")!.querySelectorAll(".rail-row")].forEach((row, index) => expect(row).toBe(agentsBefore[index]));
  });

  it("opens the company card on hover with the other companies, All companies and Create organization", async () => {
    renderRail(seededClient());
    const link = screen.getByRole("link", { name: "Test Shell Co: dashboard" });
    hover(link);
    await wait(350);
    const card = flyout("Test Shell Co")!;
    expect(card).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Northline Studio/ }).getAttribute("href")).toBe("/NOR");
    expect(within(card).queryByRole("link", { name: /^T\s*Test Shell Co$/ })).toBeNull();
    expect(within(card).getByRole("link", { name: "All companies" }).getAttribute("href")).toBe("/companies");
    expect(within(card).getByRole("link", { name: "Create organization" }).getAttribute("href")).toBe("/onboarding");
    // Escape closes it and leaves focus on the disc, without opening it again.
    within(card).getByRole("link", { name: "All companies" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(flyout("Test Shell Co")).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("opens the palette from Search", () => {
    renderRail(seededClient());
    fireEvent.click(icon("Search and commands"));
    expect(screen.getByTestId("spy").dataset.palette).toBe("true");
  });
});
