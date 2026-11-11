import type { Company } from "@paperclipai/shared";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";

/*
 * The company step's host against the real query layer. Coming back to the tab refetches the
 * companies list, and a refetch lands as fresh objects (solid-query keeps no structural sharing),
 * so a host keyed on the company object rebuilt onboarding: the open Connect Claude dialog and the
 * step were lost while the person signed in to Claude in another tab. AgentOnboarding is a stand-in
 * here that keeps the same kind of local state and counts its mounts.
 */

const YOU = "user-1";
const mounts = vi.hoisted(() => ({ count: 0 }));
const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/api/companies", () => ({ companiesApi: api }));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ isAuthenticatedMode: () => false, session: () => null, userId: () => YOU, health: () => null }),
}));
vi.mock("./AgentOnboarding", async () => {
  const { createSignal, onMount, Show } = await import("solid-js");
  const { useCompany } = await import("@/lib/company");
  return {
    AgentOnboarding: () => {
      const company = useCompany();
      const [step, setStep] = createSignal("agent");
      const [open, setOpen] = createSignal(false);
      onMount(() => mounts.count++);
      return (
        <>
          <p data-testid="org">{company().name}</p>
          <p data-testid="step">{step()}</p>
          <button type="button" onClick={() => setStep("model")}>
            Continue
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Connect Claude
          </button>
          <Show when={open()}>
            <div role="dialog" aria-label="Connect Claude">
              Paste the code
            </div>
          </Show>
        </>
      );
    },
  };
});

const { OnboardingPage } = await import("./OnboardingPage");

const company = (name: string) => ({ id: "c1", name, issuePrefix: "TST", status: "active" }) as unknown as Company;
const listKey = queryKeys.companies.list(YOU);

function renderPage(client: QueryClient) {
  const history = createMemoryHistory();
  history.set({ value: "/TST/onboarding" });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history}>
        <Route path="/:companyPrefix/onboarding" component={OnboardingPage} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

/** Onboarding at the model step with the Connect Claude dialog open, as when the person left for Claude's sign-in. */
async function openConnect(client: QueryClient) {
  renderPage(client);
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
  expect(screen.getByRole("dialog", { name: "Connect Claude" })).toBeTruthy();
  expect(screen.getByTestId("step").textContent).toBe("model");
  expect(mounts.count).toBe(1);
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    mounts.count = 0;
    api.list.mockReset();
  });
  afterEach(cleanup);

  it("keeps the step and an open dialog when a refetch brings a changed company record", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(listKey, [company("Northwind")]);
    await openConnect(client);

    // Back on the tab: the companies list refetches and the company comes back as a new object.
    api.list.mockResolvedValue([company("Northwind Labs")]);
    await client.refetchQueries({ queryKey: listKey });
    await waitFor(() => expect(screen.getByTestId("org").textContent).toBe("Northwind Labs"));

    expect(screen.getByRole("dialog", { name: "Connect Claude" })).toBeTruthy();
    expect(screen.getByTestId("step").textContent).toBe("model");
    expect(mounts.count).toBe(1);
  });

  it("keeps onboarding open when a refetch of the companies fails", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(listKey, [company("Northwind")]);
    await openConnect(client);

    api.list.mockRejectedValue(new Error("offline"));
    await client.refetchQueries({ queryKey: listKey });
    await waitFor(() => expect(client.getQueryState(listKey)?.status).toBe("error"));

    expect(screen.queryByText("Couldn't load your organizations")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Connect Claude" })).toBeTruthy();
    expect(screen.getByTestId("step").textContent).toBe("model");
    expect(mounts.count).toBe(1);
  });
});
