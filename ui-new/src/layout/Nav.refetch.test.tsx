import type { Agent, Company, Project } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { onCleanup, onMount } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import { queryKeys } from "@/api/queryKeys";
import { CommandsProvider } from "@/lib/commands";
import { CompanyProvider } from "@/lib/company";
import { Nav } from "./Nav";

/*
 * The nav's project rows against the real query layer: the projects list, your memberships and your
 * order sit in a QueryClient, and a refetch landing is `setQueryData` with fresh objects, as a fetch
 * brings them (solid-query keeps no structural sharing). Plugins' per-project items are counted as
 * they mount: each mount is a new React root that loads its plugin's config again, which is what
 * flashed (a plugin's item shows until its config says to hide it). The agent rows are checked the
 * same way against the agents list and the live runs: a row whose DOM node is rebuilt loses an open
 * "…" menu.
 */

const company = { id: "c1", name: "Test Shell Co", issuePrefix: "TST" } as Company;
const YOU = "user-1";

const plugins = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("@/plugins/NavPlugins", () => ({
  NavPlugins: () => null,
  NavProjectPlugins: (props: { project: { id: string; name: string } }) => {
    onMount(() => plugins.mounts++);
    onCleanup(() => plugins.unmounts++);
    return <span data-testid="plugin-item">{props.project.name}</span>;
  },
}));
vi.mock("@/plugins/ShellPlugins", () => ({
  GlobalToolbarPlugins: () => null,
  PluginOrganizationSwitcher: (props: { children: unknown }) => props.children,
}));
vi.mock("@/shell/ServerInfo", () => ({ ServerInfo: () => null }));
vi.mock("@/inbox/needs-you", () => ({ useNeedsYouCount: () => () => 0 }));
vi.mock("@/onboarding/can-create", () => ({ useCanCreateCompany: () => () => ({ allowed: false }) }));
vi.mock("@/chat/chat-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/chat-read")>()),
  useUnreadChats: () => ({ countFor: () => 0, count: () => 0, messages: () => 0 }),
}));
vi.mock("@/lib/company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company")>()),
  useCompaniesQuery: () => ({ data: [company] }),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => true, session: () => null, userId: () => YOU, youId: () => YOU }),
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
const membershipsKey = queryKeys.projectSettings.memberships(company.id);

function renderNav(client: QueryClient) {
  const history = createMemoryHistory();
  history.set({ value: "/TST/dashboard" });
  render(() => (
    <QueryClientProvider client={client}>
      <CompanyProvider company={company}>
        <CommandsProvider>
          <MemoryRouter
            history={history}
            root={(props) => (
              <>
                {props.children}
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
}

function seededClient() {
  // Nothing goes to the network: every read the nav makes is seeded and stays fresh.
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(projectsKey, [project("p1", "Alpha", 3), project("p2", "Bravo", 5), project("p3", "Charlie", 0)]);
  client.setQueryData(queryKeys.projectSettings.memberships(company.id), {
    projectMemberships: {},
    agentMemberships: {},
    starredProjectIds: ["p2"],
    starredAgentIds: [],
  });
  client.setQueryData(queryKeys.sidebarPreferences.projectOrder(company.id, YOU), { orderedIds: ["p3", "p1"], updatedAt: null });
  client.setQueryData(queryKeys.sidebarPreferences.companyOrder(YOU), { orderedIds: [], updatedAt: null });
  client.setQueryData(queryKeys.agents.list(company.id), []);
  client.setQueryData(queryKeys.liveRuns(company.id), []);
  client.setQueryData(queryKeys.instance.experimentalSettings, {});
  return client;
}

const label = (link: HTMLElement) => `${link.querySelector(".navi-label")?.textContent} ${link.querySelector(".navi-count")?.textContent}`;
const rowLinks = () => screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/TST/projects/"));

describe("Nav project rows", () => {
  beforeEach(() => {
    plugins.mounts = 0;
    plugins.unmounts = 0;
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps each row, and its plugin items, mounted when a refetch brings new objects", async () => {
    const client = seededClient();
    renderNav(client);
    const before = rowLinks();
    // Starred Bravo first, then your order: Charlie, Alpha.
    expect(before.map(label)).toEqual(["Bravo 5", "Charlie 0", "Alpha 3"]);
    expect(plugins.mounts).toBe(3);

    // The refetch lands: the same projects as new objects, one with a new task count.
    client.setQueryData(projectsKey, [project("p1", "Alpha", 4), project("p2", "Bravo", 5), project("p3", "Charlie", 0)]);
    await waitFor(() => expect(rowLinks().map(label)).toEqual(["Bravo 5", "Charlie 0", "Alpha 4"]));

    const after = rowLinks();
    after.forEach((link, index) => expect(link).toBe(before[index]));
    expect(plugins.mounts).toBe(3);
    expect(plugins.unmounts).toBe(0);
  });

  it("adds and removes only the rows whose projects came or went", async () => {
    const client = seededClient();
    renderNav(client);
    const [bravo, charlie] = rowLinks();
    client.setQueryData(projectsKey, [project("p2", "Bravo", 5), project("p3", "Charlie", 0), project("p4", "Delta", 1)]);
    await waitFor(() => expect(rowLinks().map(label)).toEqual(["Bravo 5", "Charlie 0", "Delta 1"]));

    const after = rowLinks();
    expect(after[0]).toBe(bravo);
    expect(after[1]).toBe(charlie);
    // Alpha's went, Delta's came.
    expect(plugins.unmounts).toBe(1);
    expect(plugins.mounts).toBe(4);
  });
});

const agentLabel = (link: HTMLElement) => `${link.querySelector(".navi-label")?.textContent} ${link.querySelector(".navi-state")?.textContent}`;
const agentLinks = (section: "starred" | "agents") =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/TST/agents/"))
    .filter((link) => link.closest(`[aria-labelledby="nav-${section}-h"]`));

describe("Nav agent rows", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function agentsClient() {
    const client = seededClient();
    client.setQueryData(agentsKey, [agent("a1", "Ann"), agent("a2", "Ben"), agent("a3", "Cal", "paused")]);
    client.setQueryData(membershipsKey, { projectMemberships: {}, agentMemberships: {}, starredProjectIds: ["p2"], starredAgentIds: ["a2"] });
    return client;
  }

  it("keeps each row's node when a refetch brings new objects, and updates its name and state", async () => {
    const client = agentsClient();
    renderNav(client);
    const starred = agentLinks("starred");
    const others = agentLinks("agents");
    expect(starred.map(agentLabel)).toEqual(["Ben idle"]);
    expect(others.map(agentLabel)).toEqual(["Ann idle", "Cal paused"]);

    // The refetch lands: the same agents as new objects, Ann renamed and Cal resumed; your
    // memberships and the live runs come back as new objects too.
    client.setQueryData(agentsKey, [agent("a1", "Anne"), agent("a2", "Ben", "paused"), agent("a3", "Cal")]);
    client.setQueryData(membershipsKey, { projectMemberships: {}, agentMemberships: {}, starredProjectIds: ["p2"], starredAgentIds: ["a2"] });
    client.setQueryData(queryKeys.liveRuns(company.id), []);
    await waitFor(() => expect(agentLinks("agents").map(agentLabel)).toEqual(["Anne idle", "Cal idle"]));
    expect(agentLinks("starred").map(agentLabel)).toEqual(["Ben paused"]);

    expect(agentLinks("starred")[0]).toBe(starred[0]);
    agentLinks("agents").forEach((link, index) => expect(link).toBe(others[index]));
  });

  it("mounts and unmounts only the rows whose agents came or went", async () => {
    const client = agentsClient();
    renderNav(client);
    const [ben] = agentLinks("starred");
    const [, cal] = agentLinks("agents");

    // Ann leaves (terminated agents drop out of the nav), Dee arrives.
    client.setQueryData(agentsKey, [agent("a1", "Ann", "terminated"), agent("a2", "Ben"), agent("a3", "Cal", "paused"), agent("a4", "Dee")]);
    await waitFor(() => expect(agentLinks("agents").map(agentLabel)).toEqual(["Cal paused", "Dee idle"]));

    expect(agentLinks("starred")[0]).toBe(ben);
    expect(agentLinks("agents")[0]).toBe(cal);
    expect(screen.queryByText("No agents yet.")).toBeNull();

    // Every agent leaves: the empty note takes the rows' place.
    client.setQueryData(agentsKey, []);
    await waitFor(() => expect(screen.getByText("No agents yet.")).toBeTruthy());
    expect(agentLinks("agents")).toEqual([]);
  });

  it("moves rows, without remounting them, when an agent starts running", async () => {
    const client = agentsClient();
    client.setQueryData(agentsKey, [agent("a1", "Ann"), agent("a2", "Ben"), agent("a3", "Cal", "paused"), agent("a4", "Dee")]);
    renderNav(client);
    const [ann, cal, dee] = agentLinks("agents");
    expect([ann, cal, dee].map(agentLabel)).toEqual(["Ann idle", "Cal paused", "Dee idle"]);

    // Dee's run starts, and the list refetches with new objects: running agents go first.
    client.setQueryData(queryKeys.liveRuns(company.id), [liveRun("a4")]);
    client.setQueryData(agentsKey, [agent("a1", "Ann"), agent("a2", "Ben"), agent("a3", "Cal", "paused"), agent("a4", "Dee")]);
    await waitFor(() => expect(agentLinks("agents").map(agentLabel)).toEqual(["Dee running", "Ann idle", "Cal paused"]));

    const [first, second, third] = agentLinks("agents");
    expect(first).toBe(dee);
    expect(second).toBe(ann);
    expect(third).toBe(cal);
  });
});
