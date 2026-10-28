import type { AgentDetail } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const chat = vi.hoisted(() => ({ list: vi.fn(), setup: vi.fn() }));
const email = vi.hoisted(() => ({ inboxes: vi.fn(), control: vi.fn() }));
const tools = vi.hoisted(() => ({ gallery: vi.fn() }));
const flags = vi.hoisted(() => ({ value: { enableChatConnectors: true } as Record<string, boolean> }));

vi.mock("@/api/chat-endpoints", () => ({ chatEndpointsApi: chat }));
vi.mock("@/api/email", () => ({ emailApi: email }));
vi.mock("@/api/tools", () => ({ toolsApi: tools }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: flags.value }) }));

const { ChannelsPanel } = await import("./ChannelsPanel");

const agent = { id: "a1", name: "Ada" } as AgentDetail;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory();
  history.set({ value: "/TES/agents/ada/tools" });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history} root={() => <ChannelsPanel agent={agent} />}>
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.value = { enableChatConnectors: true };
  chat.list.mockResolvedValue([
    { id: "e1", provider: "slack", status: "active", assignedAgentId: "a1", assignedAgentName: "Ada", providerAccountLabel: "Acme workspace", allowUnlinkedPeople: false },
    { id: "e2", provider: "telegram", status: "active", assignedAgentId: "other", assignedAgentName: "Bob", allowUnlinkedPeople: false },
    { id: "e3", provider: "discord", status: "archived", assignedAgentId: "a1", assignedAgentName: "Ada", allowUnlinkedPeople: false },
    { id: "inbox-1", provider: "agentmail", status: "active", assignedAgentId: "a1", assignedAgentName: "Ada", allowUnlinkedPeople: false },
  ]);
  email.inboxes.mockResolvedValue([
    { id: "inbox-1", companyId: "co1", connectionId: "c", assignedAgentId: "a1", address: "ada@agentmail.to", status: "paused", receiveMode: "websocket", lastError: null, lastSyncAt: null },
  ]);
  tools.gallery.mockResolvedValue({ apps: [] });
  chat.setup.mockResolvedValue({});
  email.control.mockResolvedValue({});
});

describe("ChannelsPanel", () => {
  it("lists the agent's own channels and its inbox, once each", async () => {
    renderPanel();
    expect(await screen.findByText("Slack")).toBeTruthy();
    expect(screen.getByText("Acme workspace")).toBeTruthy();
    expect(await screen.findByText("ada@agentmail.to")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.queryByText("Telegram")).toBeNull();
    expect(screen.queryByText("Discord")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open" }).map((link) => link.getAttribute("href"))).toEqual([
      "/TES/apps/chat/e1/settings",
      "/TES/apps/chat/inbox-1/settings",
    ]);
  });

  it("shows only the inbox while chat connectors are off", async () => {
    flags.value = {};
    renderPanel();
    expect(await screen.findByText("ada@agentmail.to")).toBeTruthy();
    expect(chat.list).not.toHaveBeenCalled();
    expect(screen.queryByText("Slack")).toBeNull();
  });

  it("disconnects a chat channel after asking", async () => {
    renderPanel();
    const row = (await screen.findByText("Slack")).closest("li")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }, { container: document.querySelector("[data-layer='dialog']") as HTMLElement }));
    await waitFor(() => expect(chat.setup).toHaveBeenCalledWith("e1", { action: "remove" }));
    expect(email.control).not.toHaveBeenCalled();
  });

  it("removes an inbox through its own control", async () => {
    renderPanel();
    const row = (await screen.findByText("ada@agentmail.to")).closest("li")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Disconnect" }));
    const dialog = await waitFor(() => document.querySelector("[data-layer='dialog']") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(email.control).toHaveBeenCalledWith("inbox-1", "remove"));
  });
});
