import type { AiConnectionList } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const list: AiConnectionList = {
  currentUserId: "me",
  canManageConnections: true,
  connections: [
    {
      id: "c1",
      grantId: "g1",
      companyId: "co1",
      provider: "anthropic",
      method: "subscription",
      name: "Company Claude subscription",
      accountLabel: "ada@example.com",
      ownership: "shared",
      isDefault: false,
      status: "connected",
      usageProbeSupported: true,
    },
    {
      id: "c2",
      grantId: "g2",
      companyId: "co1",
      provider: "anthropic",
      method: "api_key",
      name: "My Claude API key",
      ownership: "personal",
      ownerUserId: "me",
      ownerName: "You",
      isDefault: false,
      status: "connected",
    },
    {
      id: "c3",
      grantId: "g3",
      companyId: "co1",
      provider: "anthropic",
      method: "subscription",
      name: "Old Claude",
      ownership: "personal",
      ownerUserId: "me",
      ownerName: "You",
      isDefault: true,
      status: "expired",
      unavailableReason: "Reconnect with a separate sign-in.",
    },
  ],
};

const api = vi.hoisted(() => ({
  list: vi.fn(),
  setDefault: vi.fn(async () => ({ ok: true })),
  activeRuns: vi.fn(async () => []),
  probeUsage: vi.fn(),
}));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: api }));
vi.mock("@/api/health", () => ({ healthApi: { get: async () => ({ status: "ok", localAiLoginSupported: true }) } }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/lib/company-data", () => ({ useAgentsQuery: () => ({ data: [], isPending: false, isError: false }) }));

const { AiConnections } = await import("./AiConnections");

describe("AiConnections", () => {
  it("lists connections with their status, owner and actions", async () => {
    api.list.mockResolvedValue(list);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(() => (
      <QueryClientProvider client={client}>
        <AiConnections />
      </QueryClientProvider>
    ));
    expect(await screen.findByText("Company Claude subscription")).toBeTruthy();
    expect(screen.getByText("Claude · Subscription · ada@example.com · Shared with the company")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    // The expired default is marked, crowned, as unavailable.
    expect(screen.getByText("Default unavailable")).toBeTruthy();
    expect(screen.getByText("Reconnect with a separate sign-in.")).toBeTruthy();

    // Only your own connected personal account offers to become the default; only the expired one Reconnect.
    const makeDefault = screen.getAllByRole("button", { name: "Set as default for Claude" });
    expect(makeDefault).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reconnect" })).toHaveLength(1);
    fireEvent.click(makeDefault[0]!);
    await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith("co1", "g2"));

    // Usage is offered where the provider reports it.
    expect(screen.getAllByRole("button", { name: "Usage" })).toHaveLength(1);
  });

  it("crowns your default and keeps a failed change on its row with Retry", async () => {
    api.list.mockResolvedValue({
      ...list,
      connections: [
        { ...list.connections[1]!, isDefault: true },
        { ...list.connections[1]!, id: "c4", grantId: "g4", name: "Second Claude key" },
        { ...list.connections[1]!, id: "c5", grantId: "g5", name: "Viewer-only key", canSetDefault: false },
      ],
    });
    api.setDefault.mockRejectedValueOnce(new Error("Server said no."));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(() => (
      <QueryClientProvider client={client}>
        <AiConnections />
      </QueryClientProvider>
    ));
    expect(await screen.findByText("Your Claude default")).toBeTruthy();
    // canSetDefault: false hides the action.
    const set = screen.getAllByRole("button", { name: "Set as default for Claude" });
    expect(set).toHaveLength(1);
    fireEvent.click(set[0]!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't change your Claude default. Server said no.");
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(api.setDefault).toHaveBeenCalledTimes(2));
    expect(api.setDefault).toHaveBeenLastCalledWith("co1", "g4");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
