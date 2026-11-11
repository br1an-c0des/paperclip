import type { Company, Project } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyProvider } from "@/lib/company";
import type { ProjectTask } from "./dashboard-model";
import { ProjectPhoneHeader } from "./ProjectPhoneHeader";

const company = { id: "c1", name: "Test Co", issuePrefix: "TES" } as Company;

const switcher = vi.hoisted(() => ({ open: vi.fn((..._args: unknown[]) => true) }));
vi.mock("@/layout/PhoneDock", () => ({
  openTasksSwitcher: (...args: unknown[]) => switcher.open(...args),
  tasksSwitcherOpener: () => null,
}));

vi.mock("@/layout/nav-prefs", () => ({
  useProjectStars: () => ({ starred: () => false, toggle: vi.fn() }),
}));

vi.mock("@/lib/company-data", () => ({
  useAgentsQuery: () => ({
    data: [
      { id: "a1", name: "Quant Researcher", status: "running", urlKey: "quant-researcher" },
      { id: "a2", name: "ML Engineer", status: "idle", urlKey: "ml-engineer" },
    ],
  }),
  useLiveRunsQuery: () => ({ data: [{ id: "r1", agentId: "a1", issueId: "t1", status: "running" }] }),
}));

const artifacts = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/api/artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/artifacts")>()),
  artifactsApi: { list: (...args: unknown[]) => artifacts.list(...args) },
}));

const project = {
  id: "p1",
  name: "trading workbench",
  urlKey: "trading-workbench",
  status: "in_progress",
  description: "Research, backtest and ship trading strategies.",
  targetDate: "2026-12-15",
  archivedAt: null,
} as unknown as Project;

const tasks = [
  { id: "t1", identifier: "TES-41", title: "Download data", status: "in_progress", assigneeAgentId: "a1", updatedAt: new Date() },
  { id: "t2", identifier: "TES-45", title: "Start testing", status: "blocked", assigneeAgentId: "a2", updatedAt: new Date() },
] as unknown as ProjectTask[];

function renderHeader(tab: string) {
  const history = createMemoryHistory();
  const base = "/TES/projects/trading-workbench";
  history.set({ value: tab ? `${base}/${tab}` : base });
  render(() => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyProvider company={company}>
        <MemoryRouter history={history}>
          <Route
            path="*"
            component={() => (
              <ProjectPhoneHeader
                project={project}
                fallbackName="trading-workbench"
                base={base}
                tab={tab}
                status={<span>In progress</span>}
                target="Dec 15"
                numbers={{ open: 2, running: 1, blocked: 1 }}
                tasks={tasks}
                pluginTabs={[]}
              />
            )}
          />
        </MemoryRouter>
      </CompanyProvider>
    </QueryClientProvider>
  ));
}

describe("ProjectPhoneHeader", () => {
  afterEach(() => {
    cleanup();
    switcher.open.mockClear();
    artifacts.list.mockReset();
  });

  it("shows the overview's crumb line, description, numbers and agents", () => {
    renderHeader("");
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Dec 15")).toBeTruthy();
    expect(screen.getByText(project.description!)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search this project" }).getAttribute("href")).toBe("/TES/search?projectId=p1");
    const agents = screen.getByRole("group", { name: "Agents on this project" });
    const links = [...agents.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("title"))).toEqual(["Quant Researcher · Running TES-41", "ML Engineer · Blocked on TES-45"]);
    expect(links[0]!.getAttribute("href")).toBe("/TES/agents/quant-researcher");
    expect(screen.getByText("blocked").querySelector("b")?.textContent).toBe("1");
    const views = screen.getByRole("navigation", { name: "Project views" });
    expect([...views.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["Overview", "List", "Docs"]);
  });

  it("opens the dock's switcher from the name, marking this project", () => {
    renderHeader("issues");
    const name = screen.getByRole("button", { name: "trading workbench, switch project" });
    fireEvent.click(name);
    expect(switcher.open).toHaveBeenCalledWith(name, { kind: "project", key: "trading-workbench" });
  });

  it("leaves the description and search out on the list", () => {
    renderHeader("issues");
    expect(screen.queryByText(project.description!)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Search/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Agents on this project" })).toBeTruthy();
  });

  it("counts docs and files on Docs instead of tasks and agents", async () => {
    artifacts.list.mockResolvedValue({ artifacts: [], groups: [{ count: 3 }, { count: 2 }], nextCursor: null });
    renderHeader("docs");
    await waitFor(() => expect(screen.getByText("docs and files")).toBeTruthy());
    expect(screen.getByText("tasks with files").querySelector("b")?.textContent).toBe("2");
    expect(screen.getByText("docs and files").querySelector("b")?.textContent).toBe("5");
    expect(screen.queryByRole("group", { name: "Agents on this project" })).toBeNull();
    expect(screen.getByRole("link", { name: "Search docs and files" })).toBeTruthy();
  });
});
