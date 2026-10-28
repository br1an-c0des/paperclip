import { Route, Router } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const api = vi.hoisted(() => ({
  health: vi.fn(),
  session: vi.fn(),
  signUpEmail: vi.fn(),
  signInEmail: vi.fn(),
  invite: vi.fn(),
  accept: vi.fn(),
  companies: vi.fn(),
}));
vi.mock("@/api/health", () => ({ healthApi: { get: api.health } }));
vi.mock("@/api/auth", async (original) => ({
  ...(await original<typeof import("@/api/auth")>()),
  authApi: { getSession: api.session, signUpEmail: api.signUpEmail, signInEmail: api.signInEmail },
}));
vi.mock("@/api/invites", () => ({ invitesApi: { get: api.invite, accept: api.accept } }));
vi.mock("@/api/companies", () => ({ companiesApi: { list: api.companies } }));

const { InvitePage } = await import("./Invite");

const session = { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "ann@example.com", name: "Ann" } };
const company = { id: "co1", name: "Northwind", issuePrefix: "NOR", logoUrl: null };

function renderInvite() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", "/invite/tok123");
  render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="/invite/:token" component={InvitePage} />
        <Route path="/NOR" component={() => <p>Northwind board</p>} />
      </Router>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  api.health.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
  api.invite.mockResolvedValue({
    id: "inv1",
    companyId: "co1",
    companyName: "Northwind",
    inviteType: "company_join",
    allowedJoinTypes: "human",
    humanRole: "operator",
    expiresAt: "2099-01-01T00:00:00Z",
    invitedByUserName: "Sam",
  });
});

describe("InvitePage", () => {
  it("signs a new person up, accepts the invite and opens the organization", async () => {
    let signedIn = false;
    api.session.mockImplementation(async () => (signedIn ? session : null));
    api.signUpEmail.mockImplementation(async () => {
      signedIn = true;
    });
    let member = false;
    api.companies.mockImplementation(async () => (member ? [company] : []));
    api.accept.mockImplementation(async () => {
      member = true;
      return { id: "jr1", status: "approved", requestType: "human" };
    });

    renderInvite();
    expect(await screen.findByRole("heading", { name: "Join Northwind" })).toBeTruthy();
    expect(localStorage.getItem("paperclip:pending-invite-token")).toBe("tok123");
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ann" } });
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ann@example.com" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account and continue" }));

    expect(await screen.findByText("Northwind board")).toBeTruthy();
    expect(api.accept).toHaveBeenCalledWith("tok123", { requestType: "human" });
    expect(api.accept).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("paperclip:pending-invite-token")).toBeNull();
  });

  it("doesn't accept again for someone already in the organization", async () => {
    api.session.mockResolvedValue(session);
    api.companies.mockResolvedValue([company]);
    renderInvite();
    expect(await screen.findByRole("heading", { name: "You're already in Northwind" })).toBeTruthy();
    expect(api.accept).not.toHaveBeenCalled();
  });

  it("shows a request waiting for approval", async () => {
    api.session.mockResolvedValue(session);
    api.companies.mockResolvedValue([]);
    api.accept.mockResolvedValue({ id: "jr1", status: "pending_approval", requestType: "human" });
    renderInvite();
    expect(await screen.findByRole("heading", { name: "Request to join Northwind" })).toBeTruthy();
    await waitFor(() => expect(api.accept).toHaveBeenCalledTimes(1));
  });
});
