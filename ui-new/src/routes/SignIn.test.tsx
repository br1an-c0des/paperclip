import { Route, Router, useLocation } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createEffect } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const api = vi.hoisted(() => ({ health: vi.fn(), session: vi.fn(), signInEmail: vi.fn() }));
vi.mock("@/api/health", () => ({ healthApi: { get: api.health } }));
vi.mock("@/api/auth", async (original) => ({
  ...(await original<typeof import("@/api/auth")>()),
  authApi: { getSession: api.session, signInEmail: api.signInEmail },
}));

const { SignIn } = await import("./SignIn");

const session = { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "ann@example.com", name: "Ann" } };

/** Renders /auth at `href`, with every path the router visits after it recorded in `visited`. */
function renderSignIn(href: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const visited: string[] = [];
  const Page = (props: { name: string }) => {
    const location = useLocation();
    createEffect(() => visited.push(location.pathname));
    return <p>{props.name}</p>;
  };
  window.history.replaceState(null, "", href);
  render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="/auth" component={SignIn} />
        <Route path="/companies" component={() => <Page name="Companies page" />} />
        <Route path="/" component={() => <Page name="Home page" />} />
      </Router>
    </QueryClientProvider>
  ));
  return visited;
}

beforeEach(() => {
  api.health.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
});

describe("SignIn", () => {
  it("goes to ?next= after signing in, in one navigation", async () => {
    let signedIn = false;
    api.session.mockImplementation(async () => (signedIn ? session : null));
    api.signInEmail.mockImplementation(async () => {
      signedIn = true;
    });

    const visited = renderSignIn("/auth?next=%2Fcompanies");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ann@example.com" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Companies page")).toBeTruthy();
    expect(window.location.pathname).toBe("/companies");
    // Settled: nothing navigates on to `/` once `?next=` is gone.
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.pathname).toBe("/companies");
    expect(visited).toEqual(["/companies"]);
  });

  it("sends someone already signed in straight on to ?next=", async () => {
    api.session.mockResolvedValue(session);
    renderSignIn("/auth?next=%2Fcompanies");
    expect(await screen.findByText("Companies page")).toBeTruthy();
    expect(api.signInEmail).not.toHaveBeenCalled();
  });
});
