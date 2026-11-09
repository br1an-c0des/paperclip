import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { IssueContextUsage } from "@paperclipai/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

let reading: IssueContextUsage | null = null;
const compact = vi.fn(async () => ({ requestId: "q1", runId: "r9" }));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useLiveRunsQuery: () => ({ data: [] }) }));
vi.mock("@/api/issues", () => ({ issueContextApi: { usage: vi.fn(async () => reading), compact: () => compact() } }));

const { ContextUsageValue, useTaskContext } = await import("./TaskContext");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      {(() => {
        const context = useTaskContext(() => "t1", () => "a1");
        return <ContextUsageValue context={context} />;
      })()}
    </QueryClientProvider>
  ));
}

const usage = (compaction: IssueContextUsage["compaction"]): IssueContextUsage => ({
  runId: "r1",
  agentId: "a1",
  sessionId: "s1",
  usedTokens: 27_000,
  windowTokens: 258_000,
  observedAt: new Date().toISOString(),
  totals: { inputTokens: 77_000, cachedInputTokens: 49_000, outputTokens: 1_100 },
  costUsd: null,
  compactions: 1,
  compaction,
});

describe("the Context row", () => {
  it("opens the breakdown on a tap and compacts on request", async () => {
    reading = usage({ status: "available", reasonCode: null, reason: null });
    mount();
    const trigger = await screen.findByRole("button", { name: /Context window: 10% of 258k tokens used/ });
    expect(trigger.textContent).toBe("10% of 258k");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("77k · 49k cached");
    expect(dialog.textContent).toContain("Compactions1");
    fireEvent.click(screen.getByRole("button", { name: "Compact now" }));
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  });

  it("shows why Compact now is unavailable, disabled", async () => {
    reading = usage({ status: "unavailable", reasonCode: "agent_busy", reason: "The agent is working on this task right now." });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Context window/ }));
    await screen.findByRole("dialog");
    expect((screen.getByRole("button", { name: "Compact now" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toBe("The agent is working on this task right now.");
  });
});
