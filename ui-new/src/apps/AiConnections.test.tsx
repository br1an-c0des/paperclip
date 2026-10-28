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
    expect(screen.getByText("Your default")).toBeTruthy();
    expect(screen.getByText("Reconnect with a separate sign-in.")).toBeTruthy();

    // Only your own connected personal account offers Make default; only the expired one Reconnect.
    const makeDefault = screen.getAllByRole("button", { name: "Make default" });
    expect(makeDefault).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reconnect" })).toHaveLength(1);
    fireEvent.click(makeDefault[0]!);
    await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith("co1", "g2"));

    // Usage is offered where the provider reports it.
    expect(screen.getAllByRole("button", { name: "Usage" })).toHaveLength(1);
  });
});
