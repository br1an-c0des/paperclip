import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { AuthMode } from "./auth-model";

afterEach(cleanup);

const auth = vi.hoisted(() => ({ signInEmail: vi.fn(), signUpEmail: vi.fn() }));
vi.mock("@/api/auth", async (original) => ({ ...(await original<typeof import("@/api/auth")>()), authApi: auth }));

const { AuthForm } = await import("./AuthForm");

function renderForm(initial: AuthMode = "sign_up") {
  const onSignedIn = vi.fn();
  const [mode, setMode] = createSignal<AuthMode>(initial);
  render(() => <AuthForm mode={mode()} onModeChange={setMode} onSignedIn={onSignedIn} />);
  const fill = (label: string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
  return { onSignedIn, mode, fill };
}

describe("AuthForm", () => {
  it("creates an account and signs it in", async () => {
    auth.signUpEmail.mockResolvedValue({});
    const { onSignedIn, fill } = renderForm();
    fill("Name", "Ann");
    fill("Email", " ann@example.com ");
    fill("Password", "correct horse");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.signUpEmail).toHaveBeenCalledWith({ name: "Ann", email: "ann@example.com", password: "correct horse" });
  });

  it("checks the password length before sending", async () => {
    const { fill } = renderForm();
    fill("Name", "Ann");
    fill("Email", "ann@example.com");
    fill("Password", "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at least 8 characters");
    expect(auth.signUpEmail).not.toHaveBeenCalled();
  });

  it("switches to sign-in when the account exists", async () => {
    auth.signUpEmail.mockRejectedValue(new ApiError("User already exists", 422, { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }));
    const { onSignedIn, mode, fill } = renderForm();
    fill("Name", "Ann");
    fill("Email", "ann@example.com");
    fill("Password", "correct horse");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("An account already exists for ann@example.com");
    expect(mode()).toBe("sign_in");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("signs in", async () => {
    auth.signInEmail.mockResolvedValue({});
    const { onSignedIn, fill } = renderForm("sign_in");
    fill("Email", "ann@example.com");
    fill("Password", "pw");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.signInEmail).toHaveBeenCalledWith({ email: "ann@example.com", password: "pw" });
  });
});
