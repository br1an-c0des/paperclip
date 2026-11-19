import type { AgentDetail } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const api = vi.hoisted(() => ({
  updatePermissions: vi.fn(),
  projectAccess: vi.fn(),
  interactionPermissions: vi.fn(),
  updateInteractionPermissions: vi.fn(),
  addProjectAccess: vi.fn(),
}));
vi.mock("@/api/agents", () => ({ agentsApi: api }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useProjectsQuery: () => ({ data: [] }) }));

const { PermissionsSection } = await import("./PermissionsSection");

let client: QueryClient;

function agent(permissions: Record<string, unknown> = {}, extra: Partial<AgentDetail> = {}) {
  return { id: "a1", companyId: "co1", name: "Ada", role: "engineer", status: "idle", permissions: { canCreateAgents: false, ...permissions }, access: { canAssignTasks: true, taskAssignSource: "simple_default" }, ...extra } as unknown as AgentDetail;
}

function mount(value: AgentDetail) {
  const history = createMemoryHistory();
  history.set({ value: "/TES/agents/ada/permissions" });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history} root={() => <PermissionsSection agent={value} />}>
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

const press = (element: Element) => {
  fireEvent.pointerDown(element, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(element, { button: 0, pointerType: "mouse" });
  fireEvent.click(element);
};

const accessCard = () => screen.getByRole("heading", { name: "Access" }).closest("section.card") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.updatePermissions.mockImplementation(async (_id: string, body: Record<string, unknown>) => agent(body));
  api.projectAccess.mockResolvedValue({ projectIds: [], canManage: true });
  api.interactionPermissions.mockResolvedValue({ agentId: "a1", companyId: "co1", overrides: {}, effective: {} });
});

describe("PermissionsSection's Access card", () => {
  it("shows the level and the thirteen actions, worker when nothing is stored", async () => {
    mount(agent());
    const card = accessCard();
    expect(within(card).getByRole("button", { name: "Level: Worker" })).toBeTruthy();
    expect(within(card).getAllByRole("switch")).toHaveLength(13);
    expect(within(card).getByRole("switch", { name: "Create tasks" }).getAttribute("aria-checked")).toBe("true");
    expect(within(card).getByRole("switch", { name: "Assign tasks" }).getAttribute("aria-checked")).toBe("false");
    expect(within(card).getByRole("switch", { name: "Hire agents" }).getAttribute("aria-checked")).toBe("false");
    expect(within(card).getByText("Worker.")).toBeTruthy();
    // Delete tasks is in no level.
    expect(within(card).getByRole("group", { name: "Only set here" }).textContent).toContain("Delete tasks");
    expect(within(card).getByText("Off unless turned on here.")).toBeTruthy();
  });

  it("drops the old Hire agents and Assign tasks switches from the Trust card", async () => {
    mount(agent());
    const trust = screen.getByRole("heading", { name: "Trust" }).closest("section.card") as HTMLElement;
    expect(within(trust).queryByRole("switch", { name: "Hire agents" })).toBeNull();
    expect(within(trust).queryByRole("switch", { name: "Assign tasks" })).toBeNull();
    expect(within(trust).getByRole("switch", { name: "Create skills" })).toBeTruthy();
  });

  it("marks an override and resets it to the level's default", async () => {
    mount(agent({ access: { level: "manager", overrides: { "tasks:delete": true, "tasks:assign": false } } }));
    const card = accessCard();
    expect(within(card).getByText("Manager, with 2 actions set for this agent.")).toBeTruthy();
    expect(within(card).getByRole("switch", { name: "Delete tasks" }).getAttribute("aria-checked")).toBe("true");
    expect(within(card).getByRole("switch", { name: "Assign tasks" }).getAttribute("aria-checked")).toBe("false");
    expect(within(card).getAllByText("Set for this agent")).toHaveLength(2);
    fireEvent.click(within(card).getByRole("button", { name: "Reset “Assign tasks” to the level's default" }));
    await waitFor(() =>
      expect(api.updatePermissions).toHaveBeenCalledWith("a1", { access: { level: "manager", overrides: { "tasks:delete": true } }, canCreateSkills: true }, "co1"),
    );
  });

  it("saves a switch as an override with the whole access, never the old flags", async () => {
    mount(agent({ access: { level: "worker" } }));
    fireEvent.click(within(accessCard()).getByRole("switch", { name: "Hire agents" }));
    await waitFor(() => expect(api.updatePermissions).toHaveBeenCalled());
    const body = api.updatePermissions.mock.calls[0]![1];
    expect(body).toEqual({ access: { level: "worker", overrides: { "agents:create": true } }, canCreateSkills: true });
    expect(body).not.toHaveProperty("canCreateAgents");
    expect(body).not.toHaveProperty("canAssignTasks");
  });

  it("changes the level from the picker, dropping overrides the new level gives", async () => {
    mount(agent({ access: { level: "worker", overrides: { "tasks:assign": true } } }));
    press(within(accessCard()).getByRole("button", { name: "Level: Worker" }));
    press(await screen.findByRole("menuitem", { name: /^Manager/ }));
    await waitFor(() => expect(api.updatePermissions).toHaveBeenCalledWith("a1", { access: { level: "manager" }, canCreateSkills: true }, "co1"));
  });

  it("resets every action from the footer", async () => {
    mount(agent({ access: { level: "admin", overrides: { "api:raw": false } } }));
    fireEvent.click(within(accessCard()).getByRole("button", { name: "Reset all" }));
    await waitFor(() => expect(api.updatePermissions).toHaveBeenCalledWith("a1", { access: { level: "admin" }, canCreateSkills: true }, "co1"));
  });

  it("Create skills keeps the stored access in the body", async () => {
    mount(agent({ access: { level: "manager", overrides: { "agents:create": true } } }));
    fireEvent.click(screen.getByRole("switch", { name: "Create skills" }));
    await waitFor(() =>
      expect(api.updatePermissions).toHaveBeenCalledWith("a1", { canCreateSkills: false, access: { level: "manager", overrides: { "agents:create": true } } }, "co1"),
    );
  });

  it("waits for a pending hire to be approved", async () => {
    mount(agent({}, { status: "pending_approval" } as Partial<AgentDetail>));
    const card = accessCard();
    expect(within(card).getByText("This can be set once the hire is approved.")).toBeTruthy();
    expect((within(card).getByRole("switch", { name: "Comment" }) as HTMLInputElement).disabled).toBe(true);
  });
});
