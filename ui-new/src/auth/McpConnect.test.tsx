import type { McpConnection, McpConnectionRequest } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const mcp = vi.hoisted(() => ({
  request: vi.fn(),
  device: vi.fn(),
  consent: vi.fn(),
  consentDevice: vi.fn(),
  previewDotPairing: vi.fn(),
  pairDot: vi.fn(),
  setup: vi.fn(),
  connections: vi.fn(),
  revoke: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/api/mcp", () => ({ mcpApi: mcp }));

const { McpConnectPage, AssistantConnectionsPage } = await import("./McpConnect");

const company = (extra: Partial<McpConnectionRequest["companies"][number]> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  logoUrl: null,
  canWrite: true,
  maxAccessLevel: "admin" as const,
  actAsAgents: [{ id: "22222222-2222-4222-8222-222222222222", name: "Ada" }],
  ...extra,
});

const request = (extra: Partial<McpConnectionRequest> = {}): McpConnectionRequest => ({
  id: "req1",
  clientName: "Claude Code",
  redirectOrigin: "http://localhost:3333",
  requestedWrite: true,
  requestedConfigure: true,
  offlineAccess: true,
  requiresSignIn: false,
  requestedCompanyId: null,
  companies: [company()],
  setupUrl: null,
  ...extra,
});

let client: QueryClient;

function mount(path: string, component: () => ReturnType<typeof McpConnectPage>, pattern: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history}>
        <Route path={pattern} component={component} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

const mountConsent = () => mount("/mcp-connect/req1", () => <McpConnectPage />, "/mcp-connect/:id");

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mcp.consent.mockResolvedValue({});
});

describe("the consent screen", () => {
  it("offers acts as (you or an agent) and a level, starting at you and manager", async () => {
    mcp.request.mockResolvedValue(request());
    mountConsent();
    expect(await screen.findByRole("radio", { name: "You" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "You" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Ada" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /^Manager/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("approves with who it acts as and the level, never the old checkboxes", async () => {
    mcp.request.mockResolvedValue(request());
    mountConsent();
    fireEvent.click(await screen.findByRole("radio", { name: "Ada" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Worker/ }));
    fireEvent.click(screen.getByRole("button", { name: "Connect organization" }));
    await waitFor(() =>
      expect(mcp.consent).toHaveBeenCalledWith("req1", {
        decision: "approve",
        companyId: "11111111-1111-4111-8111-111111111111",
        actAsAgentId: "22222222-2222-4222-8222-222222222222",
        accessLevel: "worker",
      }),
    );
  });

  it("sends only the decision when cancelled", async () => {
    mcp.request.mockResolvedValue(request());
    mountConsent();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mcp.consent).toHaveBeenCalledWith("req1", { decision: "deny", companyId: "11111111-1111-4111-8111-111111111111" }));
  });

  it("lets a viewer give read only and nothing more", async () => {
    mcp.request.mockResolvedValue(request({ companies: [company({ canWrite: false, maxAccessLevel: "read_only", actAsAgents: [] })] }));
    mountConsent();
    expect((await screen.findByRole("radio", { name: /^Read only/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /^Manager/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Your role in this organization is read-only, so the connection can only read.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect organization" }));
    await waitFor(() => expect(mcp.consent).toHaveBeenCalledWith("req1", expect.objectContaining({ accessLevel: "read_only", actAsAgentId: null })));
  });
});

describe("/assistant-connections", () => {
  const connection = (extra: Partial<McpConnection> = {}): McpConnection => ({
    id: "c1",
    companyId: "co1",
    clientName: "Claude Code",
    companyName: "Acme",
    user: { name: "Sam", image: null },
    scopes: ["paperclip:read", "paperclip:write"],
    actAsAgent: null,
    accessLevel: "manager",
    accessOverrides: {},
    actAsAgentChoices: [{ id: "a1", name: "Ada" }],
    createdAt: "2026-11-18T00:00:00Z",
    revokedAt: null,
    ...extra,
  });

  const press = (element: Element) => {
    fireEvent.pointerDown(element, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(element, { button: 0, pointerType: "mouse" });
    fireEvent.click(element);
  };

  beforeEach(() => {
    mcp.setup.mockResolvedValue({ enabled: true, serverUrl: "", invitationUrl: "", invitation: "" });
    mcp.update.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ ...connection(), id, ...body }));
  });

  const mountList = () => mount("/assistant-connections", () => <AssistantConnectionsPage />, "/assistant-connections");

  it("shows who each connection acts as and its level", async () => {
    mcp.connections.mockResolvedValue([connection(), connection({ id: "c2", actAsAgent: { id: "a1", name: "Ada" }, accessLevel: "worker", accessOverrides: { "tasks:delete": true } })]);
    mountList();
    expect(await screen.findByText("Acts as you · Manager")).toBeTruthy();
    expect(screen.getByText("Acts as Ada · Worker at most · 1 action set")).toBeTruthy();
  });

  it("changes the level in place, sending the overrides whole", async () => {
    mcp.connections.mockResolvedValue([connection({ accessOverrides: { "tasks:assign": false } })]);
    mountList();
    await screen.findByText(/Acts as you · Manager/);
    press(screen.getByRole("button", { name: "Level: Manager" }));
    press(await screen.findByRole("menuitem", { name: /^Admin/ }));
    await waitFor(() => expect(mcp.update).toHaveBeenCalledWith("c1", { accessLevel: "admin", accessOverrides: { "tasks:assign": false } }));
  });

  it("switches who it acts as", async () => {
    mcp.connections.mockResolvedValue([connection()]);
    mountList();
    await screen.findByText(/Acts as you/);
    press(screen.getByRole("button", { name: "Acts as: You" }));
    press(await screen.findByRole("menuitem", { name: "Ada" }));
    await waitFor(() => expect(mcp.update).toHaveBeenCalledWith("c1", { actAsAgentId: "a1" }));
  });

  it("turns an action on for the connection, and resets it", async () => {
    mcp.connections.mockResolvedValue([connection({ accessOverrides: { "api:raw": true } })]);
    mountList();
    await screen.findByText(/1 action set/);
    const editor = screen.getByText("Change access").closest("details") as HTMLElement;
    expect(within(editor).getByText("Set for this connection")).toBeTruthy();
    fireEvent.click(within(editor).getByRole("switch", { name: "Delete tasks" }));
    await waitFor(() => expect(mcp.update).toHaveBeenLastCalledWith("c1", { accessLevel: "manager", accessOverrides: { "api:raw": true, "tasks:delete": true } }));
    await waitFor(() => expect((within(editor).getByRole("button", { name: "Reset all actions" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(editor).getByRole("button", { name: "Reset all actions" }));
    await waitFor(() => expect(mcp.update).toHaveBeenLastCalledWith("c1", { accessLevel: "manager", accessOverrides: {} }));
  });

  it("leaves a Dot agent pairing as it was", async () => {
    mcp.connections.mockResolvedValue([connection({ scopes: ["paperclip:agent"], agent: { id: "a1", name: "Ada", provider: "openai_dot" } })]);
    mountList();
    expect(await screen.findByText("Agent connection")).toBeTruthy();
    expect(screen.queryByText("Change access")).toBeNull();
  });
});
