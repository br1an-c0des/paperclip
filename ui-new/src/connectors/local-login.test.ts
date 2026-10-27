import type { AiConnectionLoginIntent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoginController,
  EXPIRED_MESSAGE,
  loginTargetKey,
  POLL_MS,
  SUBMIT_FAILED_MESSAGE,
  type LoginApi,
  type LoginState,
} from "./local-login";

const intent: AiConnectionLoginIntent = {
  provider: "anthropic",
  method: "subscription",
  name: "Company Claude subscription",
  ownership: "shared",
  agentIds: [],
  allAgents: true,
};

const SIGN_IN = { status: "sign_in_required" as const, authorizationUrl: "https://claude.ai/oauth/authorize?x=1" };

function setup() {
  let sessions = 0;
  const api = {
    startLocalLogin: vi.fn(async () => ({ sessionId: `attempt-${++sessions}`, expiresAt: "2099-01-01T00:30:00Z" })),
    checkLocalLogin: vi.fn(async () => SIGN_IN as Awaited<ReturnType<LoginApi["checkLocalLogin"]>>),
    submitLocalLoginCode: vi.fn(async () => ({ ok: true as const })),
    cancelLocalLogin: vi.fn(async () => ({ ok: true as const })),
    connectLocal: vi.fn(async () => ({ connectionId: "conn-1", grantId: "grant-1" })),
  };
  const states: LoginState[] = [];
  const controller = createLoginController({ api, companyId: "co1", onChange: (state) => states.push(state) });
  return { api, controller, states, last: () => states[states.length - 1] };
}

/** Let queued promise callbacks run without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("loginTargetKey", () => {
  it("ignores the name and the order of agents", () => {
    expect(loginTargetKey({ ...intent, name: "Other" })).toBe(loginTargetKey(intent));
    expect(loginTargetKey({ ...intent, allAgents: false, agentIds: ["b", "a"] })).toBe(
      loginTargetKey({ ...intent, allAgents: false, agentIds: ["a", "b"] }),
    );
    expect(loginTargetKey({ ...intent, ownership: "personal" })).not.toBe(loginTargetKey(intent));
    expect(loginTargetKey({ ...intent, connectionId: "c1" })).not.toBe(loginTargetKey(intent));
  });
});

describe("createLoginController", () => {
  it("starts an attempt, checks it with the session ID, and shows the sign-in link", async () => {
    const { api, controller, states, last } = setup();
    controller.begin(intent);
    expect(states[0]).toEqual({ phase: "preparing" });
    await flush();
    expect(api.startLocalLogin).toHaveBeenCalledWith("co1", intent);
    expect(api.checkLocalLogin).toHaveBeenCalledWith("co1", { ...intent, localSessionId: "attempt-1" });
    expect(last()).toEqual({
      phase: "sign_in",
      authorizationUrl: SIGN_IN.authorizationUrl,
      code: null,
      expiresAt: "2099-01-01T00:30:00Z",
      submitting: false,
      codeSubmitted: false,
    });
  });

  it("polls every 5 seconds while sign-in is required, and stops once ready", async () => {
    const { api, controller, last } = setup();
    controller.begin(intent);
    await flush();
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(2);
    api.checkLocalLogin.mockResolvedValue({ status: "ready" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(last()).toEqual({ phase: "ready" });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(3);
    expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  });

  it("submits the browser code to the attempt, marks it sent, and checks again", async () => {
    const { api, controller, last } = setup();
    controller.begin(intent);
    await flush();
    const submitting = controller.submitCode("  code#state  ");
    expect(last()).toMatchObject({ phase: "sign_in", submitting: true });
    await submitting;
    expect(api.submitLocalLoginCode).toHaveBeenCalledWith("co1", "attempt-1", "code#state");
    expect(last()).toMatchObject({ phase: "sign_in", submitting: false, codeSubmitted: true });
    // Checked again straight away; the CLI is still finishing, and the code stays marked as sent.
    await flush();
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(2);
    expect(last()).toMatchObject({ phase: "sign_in", codeSubmitted: true });
    api.checkLocalLogin.mockResolvedValue({ status: "ready" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(last()).toEqual({ phase: "ready" });
  });

  it("stops at an error when the code can't be submitted, until sign-in starts again", async () => {
    const { api, controller, last } = setup();
    controller.begin(intent);
    await flush();
    api.submitLocalLoginCode.mockRejectedValue(new Error("bad code"));
    await controller.submitCode("nope");
    expect(last()).toEqual({ phase: "error", message: SUBMIT_FAILED_MESSAGE, expired: false });
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ phase: "error" });
  });

  it("ends the attempt when it expires, and restarts it with restart: true after cancelling the old one", async () => {
    const { api, controller, last } = setup();
    api.checkLocalLogin.mockResolvedValue({ status: "expired" });
    controller.begin(intent);
    await flush();
    expect(last()).toEqual({ phase: "error", message: EXPIRED_MESSAGE, expired: true });
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);

    api.checkLocalLogin.mockResolvedValue(SIGN_IN);
    controller.retry();
    await flush();
    expect(api.cancelLocalLogin).toHaveBeenCalledWith("co1", "attempt-1");
    expect(api.startLocalLogin).toHaveBeenLastCalledWith("co1", { ...intent, restart: true });
    expect(api.cancelLocalLogin.mock.invocationCallOrder[0]).toBeLessThan(api.startLocalLogin.mock.invocationCallOrder[1]);
    expect(api.checkLocalLogin).toHaveBeenLastCalledWith("co1", { ...intent, localSessionId: "attempt-2" });
    expect(last()).toMatchObject({ phase: "sign_in" });
  });

  it("shows the server's error from a check", async () => {
    const { api, controller, last } = setup();
    api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", error: "Claude Code is not installed." });
    controller.begin(intent);
    await flush();
    expect(last()).toEqual({ phase: "error", message: "Claude Code is not installed.", expired: false });
  });

  it("keeps the attempt when only the name changes, and replaces it when the target changes", async () => {
    const { api, controller } = setup();
    controller.begin(intent);
    await flush();
    controller.dispose();
    controller.begin({ ...intent, name: "Renamed" });
    await flush();
    expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
    expect(api.cancelLocalLogin).not.toHaveBeenCalled();
    expect(api.checkLocalLogin).toHaveBeenLastCalledWith("co1", { ...intent, name: "Renamed", localSessionId: "attempt-1" });

    const personal = { ...intent, ownership: "personal" as const, allAgents: false };
    controller.begin(personal);
    await flush();
    expect(api.cancelLocalLogin).toHaveBeenCalledWith("co1", "attempt-1");
    expect(api.startLocalLogin).toHaveBeenLastCalledWith("co1", personal);
  });

  it("saves a ready account with the session ID and the latest name", async () => {
    const { api, controller, last } = setup();
    api.checkLocalLogin.mockResolvedValue({ status: "ready" });
    controller.begin(intent);
    await flush();
    const result = await controller.connect("My Claude");
    expect(api.connectLocal).toHaveBeenCalledWith("co1", { ...intent, name: "My Claude", localSessionId: "attempt-1" });
    expect(result).toEqual({ connectionId: "conn-1", grantId: "grant-1" });
    expect(last()).toEqual({ phase: "saved", result });
  });

  it("doesn't save before the account is ready, and lets a failed save be retried", async () => {
    const { api, controller, last } = setup();
    controller.begin(intent);
    await flush();
    await controller.connect();
    expect(api.connectLocal).not.toHaveBeenCalled();

    api.checkLocalLogin.mockResolvedValue({ status: "ready" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    api.connectLocal.mockRejectedValueOnce(new Error("Sign-in session not found"));
    await controller.connect();
    expect(last()).toEqual({ phase: "ready", error: "Sign-in session not found" });
    await controller.connect();
    expect(api.connectLocal).toHaveBeenCalledTimes(2);
    expect(last()).toMatchObject({ phase: "saved" });
  });

  it("stops polling on dispose without cancelling the attempt", async () => {
    const { api, controller, states } = setup();
    controller.begin(intent);
    await flush();
    const seen = states.length;
    controller.dispose();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
    expect(api.cancelLocalLogin).not.toHaveBeenCalled();
    expect(states.length).toBe(seen);
  });

  it("drops a check that answers after the attempt was replaced", async () => {
    const { api, controller, last } = setup();
    let answer!: (value: typeof SIGN_IN) => void;
    api.checkLocalLogin.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    controller.begin(intent);
    await flush();
    controller.retry();
    await flush();
    expect(last()).toMatchObject({ phase: "sign_in" });
    api.checkLocalLogin.mockClear();
    answer({ ...SIGN_IN, authorizationUrl: "https://stale.example" });
    await flush();
    expect(last()).toMatchObject({ authorizationUrl: SIGN_IN.authorizationUrl });
  });
});
