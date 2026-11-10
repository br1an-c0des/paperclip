import type { AgentDetail, AgentInteractionPermissionsState } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const api = vi.hoisted(() => ({ interactionPermissions: vi.fn(), updateInteractionPermissions: vi.fn(), updatePermissions: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: api }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));

const { InteractionsCard } = await import("./InteractionsCard");

const KEYS = [
  "canAssignTasksToAgents",
  "canReceiveAssignmentsFromAgents",
  "canAssignTasksToHumans",
  "canMentionAgents",
  "canReceiveMentionsFromAgents",
  "canCommentOnOtherTasks",
  "canReceiveCommentsFromAgents",
  "canEditOtherTasks",
  "canReceiveTaskEditsFromAgents",
  "canConfigureOtherAgents",
  "canReceiveConfigurationChangesFromAgents",
] as const;

function state(overrides: AgentInteractionPermissionsState["overrides"]): AgentInteractionPermissionsState {
  const effective = Object.fromEntries(KEYS.map((key) => [key, overrides[key] !== false])) as AgentInteractionPermissionsState["effective"];
  return { agentId: "a1", companyId: "co1", overrides, effective };
}

function renderCard(agent: Partial<AgentDetail> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(() => (
    <QueryClientProvider client={client}>
      <InteractionsCard agent={{ id: "a1", name: "Ada", status: "idle", ...agent } as AgentDetail} />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.interactionPermissions.mockResolvedValue(state({ canReceiveCommentsFromAgents: false }));
  api.updateInteractionPermissions.mockImplementation(async (_id: string, patch: Record<string, boolean | null>) => {
    const overrides: Record<string, boolean> = { canReceiveCommentsFromAgents: false };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete overrides[key];
      else overrides[key] = value;
    }
    return state(overrides);
  });
});

describe("InteractionsCard", () => {
  it("shows the eleven switches with the agent's own setting and its Reset", async () => {
    renderCard();
    expect(await screen.findByRole("switch", { name: "Take comments from agents" })).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(11);
    expect(screen.getByRole("switch", { name: "Take comments from agents" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Mention agents" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("button", { name: /^Reset “/ })).toHaveLength(1);
    expect(screen.getByText("1 of 11 turned off. Changes save at once.")).toBeTruthy();
  });

  it("saves a switch through the interaction route only", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Mention agents" }));
    await waitFor(() => expect(api.updateInteractionPermissions).toHaveBeenCalledWith("a1", { canMentionAgents: false }));
    expect(api.updatePermissions).not.toHaveBeenCalled();
  });

  it("resets one switch with null, and all of them from the footer", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Reset “Take comments from agents” to the default" }));
    await waitFor(() => expect(api.updateInteractionPermissions).toHaveBeenCalledWith("a1", { canReceiveCommentsFromAgents: null }));
    api.interactionPermissions.mockResolvedValue(state({ canReceiveCommentsFromAgents: false, canEditOtherTasks: true }));
    cleanup();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Reset all" }));
    await waitFor(() =>
      expect(api.updateInteractionPermissions).toHaveBeenLastCalledWith("a1", { canReceiveCommentsFromAgents: null, canEditOtherTasks: null }),
    );
  });

  it("waits for a pending hire to be approved", async () => {
    renderCard({ status: "pending_approval" });
    expect(await screen.findByText("These can be set once the hire is approved.")).toBeTruthy();
    const toggle = await screen.findByRole("switch", { name: "Mention agents" });
    expect((toggle as HTMLInputElement).disabled).toBe(true);
  });
});
