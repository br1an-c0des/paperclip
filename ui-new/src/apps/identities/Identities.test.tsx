import type { ToolConnection } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const tools = vi.hoisted(() => ({ grants: vi.fn() }));
const grantsApi = vi.hoisted(() => ({ revoke: vi.fn(), replaceMembers: vi.fn(), delegate: vi.fn(), revokeDelegation: vi.fn(), startPersonal: vi.fn() }));

vi.mock("@/api/tools", () => ({ toolsApi: tools }));
vi.mock("@/api/connection-extras", () => ({ connectionGrantsApi: grantsApi, aggregatorsApi: {} }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({
  useAgentsQuery: () => ({
    data: [
      { id: "a1", name: "Ada", status: "idle" },
      { id: "a2", name: "Bob", status: "idle" },
    ],
  }),
}));
vi.mock("@/ui/Avatar", () => ({ AgentAvatar: () => <span /> }));

const { ConnectionExtras } = await import("./Identities");

const members = [
  { userId: "me", name: "Brian", email: "b@test" },
  { userId: "u2", name: "Cleo", email: "c@test" },
];

function renderFor(policy: string, grants: unknown[], capabilities: Record<string, boolean> = {}) {
  tools.grants.mockResolvedValue({ connection: { id: "c1", uid: "c1" }, grants, capabilities, currentUserId: "me", members });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = { id: "c1", credentialPolicy: policy, connectionPurpose: "tool", transport: "mcp_remote", config: {}, transportConfig: {} } as unknown as ToolConnection;
  render(() => (
    <QueryClientProvider client={client}>
      <ConnectionExtras connection={connection} canConfigure />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  grantsApi.replaceMembers.mockResolvedValue({ members: [{ subjectType: "user", subjectId: "u2" }] });
  grantsApi.delegate.mockResolvedValue({});
});

describe("connection identities", () => {
  it("narrows the organization account to chosen people", async () => {
    renderFor("shared", [{ id: "g1", kind: "organization", status: "active", isDefault: true, members: [], capabilities: { canEditAudience: true, canRevoke: true } }]);
    expect(await screen.findByText(/Who can use it: Everyone in the organization/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Chosen people" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Cleo/ }));
    fireEvent.click(save);
    await waitFor(() => expect(grantsApi.replaceMembers).toHaveBeenCalledWith("c1", "g1", ["u2"]));
  });

  it("offers Connect as me on a personal connection you haven't connected", async () => {
    renderFor("per_user", [], { canConnectAsCurrentUser: true });
    expect(await screen.findByText("Your account")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect as me" })).toBeTruthy();
  });

  it("lets another agent act as you", async () => {
    renderFor("per_user", [{ id: "g2", kind: "user", status: "active", subjectUserId: "me", members: [], delegations: [{ id: "d1", agentId: "a1" }] }]);
    expect(await screen.findByText(/You · /)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Agents that may act as you" }).textContent).toContain("Ada");
    fireEvent.change(screen.getByRole("combobox", { name: "Agent to add" }), { target: { value: "a2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(grantsApi.delegate).toHaveBeenCalledWith("c1", "g2", "a2"));
  });

  it("shows nothing for an AI connection", () => {
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <ConnectionExtras connection={{ id: "c9", connectionPurpose: "ai" } as unknown as ToolConnection} canConfigure />
      </QueryClientProvider>
    ));
    expect(tools.grants).not.toHaveBeenCalled();
  });
});
