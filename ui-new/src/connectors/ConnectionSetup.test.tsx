import type { AiConnectionList } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const api = vi.hoisted(() => ({
  startLocalLogin: vi.fn(),
  checkLocalLogin: vi.fn(),
  submitLocalLoginCode: vi.fn(),
  cancelLocalLogin: vi.fn(),
  connectLocal: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: api }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/lib/company-data", () => ({
  useAgentsQuery: () => ({
    data: [
      { id: "a1", name: "Quant Researcher", status: "idle", adapterType: "claude_local" },
      { id: "a2", name: "Writer", status: "idle", adapterType: "claude_local" },
    ],
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/ui/Avatar", () => ({ AgentAvatar: () => <span /> }));

const { ConnectionSetup } = await import("./ConnectionSetup");

const manager: AiConnectionList = { currentUserId: "me", canManageConnections: true, connections: [] };

function renderSetup(options: { list?: AiConnectionList; subscriptionSupported?: boolean } = {}) {
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(() => (
    <QueryClientProvider client={client}>
      <ConnectionSetup
        open
        onOpenChange={() => {}}
        list={options.list ?? manager}
        subscriptionSupported={options.subscriptionSupported ?? true}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  ));
  return { onSaved };
}

beforeEach(() => {
  api.startLocalLogin.mockResolvedValue({ sessionId: "attempt-1", expiresAt: "2099-01-01T00:30:00Z" });
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://claude.ai/oauth/authorize?x=1" });
  api.submitLocalLoginCode.mockResolvedValue({ ok: true });
  api.cancelLocalLogin.mockResolvedValue({ ok: true });
  api.connectLocal.mockResolvedValue({ connectionId: "conn-1", grantId: "grant-1" });
  api.create.mockResolvedValue({ connectionId: "conn-2", grantId: "grant-2" });
});

describe("ConnectionSetup", () => {
  it("signs in with a Claude subscription for chosen agents and saves it", async () => {
    const { onSaved } = renderSetup();
    fireEvent.click(await screen.findByRole("switch", { name: /every agent/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Writer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to sign-in" }));

    const link = await screen.findByRole("link", { name: /sign in to claude/i });
    expect(link.getAttribute("href")).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(api.startLocalLogin).toHaveBeenCalledWith("co1", {
      provider: "anthropic",
      method: "subscription",
      name: "Company Claude subscription",
      ownership: "shared",
      agentIds: ["a2"],
      allAgents: false,
    });

    fireEvent.input(screen.getByLabelText("Authorization code"), { target: { value: "abc#xyz" } });
    api.checkLocalLogin.mockResolvedValue({ status: "ready" });
    fireEvent.click(screen.getByRole("button", { name: "Submit code" }));
    await waitFor(() => expect(api.submitLocalLoginCode).toHaveBeenCalledWith("co1", "attempt-1", "abc#xyz"));
    await screen.findByText(/Claude is signed in/);

    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Company Claude subscription", { connectionId: "conn-1", grantId: "grant-1" }));
    expect(api.connectLocal).toHaveBeenCalledWith("co1", expect.objectContaining({ localSessionId: "attempt-1", agentIds: ["a2"] }));
  });

  it("saves an API key", async () => {
    const { onSaved } = renderSetup({ subscriptionSupported: false });
    // Without local sign-in the dialog opens on the API key.
    fireEvent.input(await screen.findByLabelText("Anthropic API key"), { target: { value: "sk-ant-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.create).toHaveBeenCalledWith("co1", {
      provider: "anthropic",
      method: "api_key",
      name: "Company Claude API key",
      ownership: "shared",
      apiKey: "sk-ant-123",
      agentIds: [],
      allAgents: true,
    });
  });

  it("keeps a non-manager's connection personal", async () => {
    renderSetup({ list: { ...manager, canManageConnections: false } });
    expect(await screen.findByText("Just me")).toBeTruthy();
    const everyAgent = screen.getByRole("switch", { name: /every agent/i }) as HTMLInputElement;
    expect(everyAgent.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue to sign-in" }));
    await waitFor(() =>
      expect(api.startLocalLogin).toHaveBeenCalledWith("co1", expect.objectContaining({ ownership: "personal", allAgents: false, name: "My Claude subscription" })),
    );
  });
});
