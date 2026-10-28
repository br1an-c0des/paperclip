import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { InviteSummary } from "@/api/invites";
import {
  assistantName,
  authFeedback,
  authFormProblem,
  authReturnPath,
  claimCloudSignInAttempt,
  cliRetryDelay,
  cloudCreateUrl,
  cloudOf,
  cloudSignInUrl,
  connectionAccess,
  connectionTitle,
  inviteView,
  mcpProblem,
  nestedString,
  pendingInvitePath,
  readPendingHandoff,
  rememberPendingInvite,
  clearPendingInvite,
  resumeCloudHandoff,
} from "./auth-model";

afterEach(() => localStorage.clear());

describe("authReturnPath", () => {
  it("keeps an in-app path with its query and hash", () => {
    expect(authReturnPath("/TRA/issues/TRA-1?tab=runs#c1")).toBe("/TRA/issues/TRA-1?tab=runs#c1");
  });

  it.each([null, "", "https://evil.example/", "//evil.example", "/auth", "/auth/?next=/x", "/a\\b", "/a b"])("falls back to / for %s", (next) => {
    expect(authReturnPath(next)).toBe("/");
  });
});

describe("pending invite", () => {
  it("remembers the invite path until it's cleared for that token", () => {
    rememberPendingInvite(" abc ");
    expect(pendingInvitePath()).toBe("/invite/abc");
    clearPendingInvite("other");
    expect(pendingInvitePath()).toBe("/invite/abc");
    clearPendingInvite("abc");
    expect(pendingInvitePath()).toBeNull();
  });
});

describe("the sign-in form", () => {
  it("asks for a name and a long enough password on sign-up only", () => {
    expect(authFormProblem("sign_in", { name: "", email: "a@b.c", password: "x" })).toBeNull();
    expect(authFormProblem("sign_up", { name: "", email: "a@b.c", password: "longenough" })).toBe("Enter your name.");
    expect(authFormProblem("sign_up", { name: "Ann", email: "a@b.c", password: "short" })).toMatch(/at least 8/);
    expect(authFormProblem("sign_up", { name: "Ann", email: "", password: "longenough" })).toBe("Enter your email.");
  });

  it("turns an existing account on sign-up into a nudge to sign in", () => {
    const error = new ApiError("User already exists", 422, { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists" });
    expect(authFeedback(error, "sign_up", "ann@example.com")).toEqual({
      tone: "info",
      message: "An account already exists for ann@example.com. Sign in to continue.",
      switchTo: "sign_in",
    });
  });

  it("explains a wrong password", () => {
    const error = new ApiError("Invalid email or password", 401, { code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(authFeedback(error, "sign_in", "x").message).toMatch(/don't match an account/);
    expect(authFeedback(new ApiError("Request failed: 401", 401, null), "sign_in", "x").tone).toBe("error");
  });

  it("passes other errors through", () => {
    expect(authFeedback(new ApiError("Sign up is disabled", 400, { message: "Sign up is disabled" }), "sign_up", "x")).toEqual({
      tone: "error",
      message: "Sign up is disabled",
    });
  });
});

describe("Paperclip Cloud", () => {
  const cloud = { managed: true as const, managedBy: "paperclip-cloud" as const, stackSlug: "acme", cloudBaseUrl: "https://cloud.example/api" };

  it("reads the cloud block off health", () => {
    expect(cloudOf({ status: "ok" })).toBeNull();
    expect(cloudOf({ status: "ok", cloud } as never)).toEqual(cloud);
  });

  it("builds the entry and create addresses from the base's origin", () => {
    expect(cloudSignInUrl(cloud, "/TRA/issues")).toBe("https://cloud.example/v1/stacks/acme/entry-redirect?returnTo=%2FTRA%2Fissues");
    expect(cloudSignInUrl({ ...cloud, stackSlug: null }, "/")).toBeNull();
    expect(cloudCreateUrl(cloud)).toBe("https://cloud.example/stacks/new");
    expect(cloudCreateUrl({ ...cloud, cloudBaseUrl: "javascript:alert(1)" })).toBeNull();
  });

  it("goes to Cloud automatically once per five minutes", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(claimCloudSignInAttempt(storage, 1_000_000)).toBe(true);
    expect(claimCloudSignInAttempt(storage, 1_000_000 + 60_000)).toBe(false);
    expect(claimCloudSignInAttempt(storage, 1_000_000 + 6 * 60_000)).toBe(true);
  });

  it("reads a fresh handoff and drops a stale or malformed one", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, removeItem: (key: string) => void store.delete(key) };
    const key = "paperclip.cloud-oauth-handoff.v1";
    store.set(key, JSON.stringify({ version: 1, session: "a".repeat(20), savedAt: 1000 }));
    expect(readPendingHandoff(storage, 2000)).toBe("a".repeat(20));
    expect(readPendingHandoff(storage, 1000 + 16 * 60_000)).toBeNull();
    expect(store.has(key)).toBe(false);
    store.set(key, JSON.stringify({ version: 1, session: "bad session", savedAt: 1000 }));
    expect(readPendingHandoff(storage, 2000)).toBeNull();
  });

  it("trades the handoff for the provider's address, retrying a server error once", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: "https://provider.example/authorize?x=1" }), { status: 200 }));
    await expect(resumeCloudHandoff("s".repeat(20), request as typeof fetch)).resolves.toBe("https://provider.example/authorize?x=1");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses an unsafe provider address and explains an expired handoff", async () => {
    const unsafe = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authorizationUrl: "javascript:alert(1)" }), { status: 200 }));
    await expect(resumeCloudHandoff("s".repeat(20), unsafe as typeof fetch)).rejects.toThrow(/invalid provider sign-in address/);
    const expired = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "SESSION_NOT_AVAILABLE" }), { status: 410 }));
    await expect(resumeCloudHandoff("s".repeat(20), expired as typeof fetch)).rejects.toThrow(/expired/);
  });
});

describe("CLI auth", () => {
  it("waits the server's retry-after, at least a second, else a minute", () => {
    expect(cliRetryDelay(new ApiError("slow down", 429, { details: { retryAfterSeconds: 5 } }))).toBe(5000);
    expect(cliRetryDelay(new ApiError("slow down", 429, { details: { retryAfterSeconds: 0.1 } }))).toBe(1000);
    expect(cliRetryDelay(new ApiError("slow down", 429, {}))).toBe(60_000);
  });
});

describe("MCP connect", () => {
  it("tells an unconfigured server and a switched-off setting apart from other errors", () => {
    expect(mcpProblem(new ApiError("API route not found", 404, { error: "API route not found" })).kind).toBe("unconfigured");
    const off = mcpProblem(new ApiError("temporarily_unavailable", 503, { error: "temporarily_unavailable", error_description: "Assistant connections are disabled." }));
    expect(off.kind).toBe("disabled");
    expect(off.message).toMatch(/enablePublicMcp/);
    expect(mcpProblem(new ApiError("invalid_request", 404, { error: "invalid_request", error_description: "Connection request is expired or already decided." }))).toEqual({
      kind: "error",
      message: "Connection request is expired or already decided.",
    });
  });

  it("names the assistant and the connection", () => {
    expect(assistantName("Claude Code")).toBe("Claude Code");
    expect(assistantName("MCP client")).toBe("your assistant");
    expect(connectionTitle({ clientName: "Claude", user: { name: "Sam Smith" } })).toBe("Sam’s Claude connection");
    expect(connectionTitle({ clientName: "Claude", user: { name: "James" } })).toBe("James’ Claude connection");
    expect(connectionTitle({ clientName: "Codex", user: null })).toBe("Codex connection");
    expect(connectionAccess(["paperclip:read", "paperclip:write", "paperclip:configure"])).toBe("Read and edit work; configure agents, projects and skills");
    expect(connectionAccess(["paperclip:agent"])).toBe("Agent connection");
  });
});

describe("inviteView", () => {
  const invite = (patch: Partial<InviteSummary> = {}): InviteSummary => ({
    id: "inv1",
    companyId: "co1",
    inviteType: "company_join",
    allowedJoinTypes: "human",
    expiresAt: "2099-01-01T00:00:00Z",
    ...patch,
  });

  it("waits for a signed-in person's companies before deciding", () => {
    expect(inviteView({ invite: invite(), authenticated: true, signedIn: true, companyIds: undefined })).toEqual({ kind: "checking" });
  });

  it("recognises a member", () => {
    expect(inviteView({ invite: invite(), authenticated: true, signedIn: true, companyIds: ["co1"] })).toEqual({ kind: "member" });
  });

  it("asks someone signed out to make an account, and accepts automatically once signed in", () => {
    expect(inviteView({ invite: invite(), authenticated: true, signedIn: false, companyIds: [] })).toEqual({ kind: "account" });
    expect(inviteView({ invite: invite(), authenticated: true, signedIn: true, companyIds: [] })).toEqual({ kind: "accept", auto: true });
  });

  it("never accepts a bootstrap invite without a click", () => {
    expect(inviteView({ invite: invite({ inviteType: "bootstrap_ceo", companyId: null }), authenticated: true, signedIn: true, companyIds: [] })).toEqual({
      kind: "accept",
      auto: false,
    });
  });

  it("shows the agent form for an agent-only invite", () => {
    expect(inviteView({ invite: invite({ allowedJoinTypes: "agent" }), authenticated: true, signedIn: false, companyIds: [] })).toEqual({ kind: "agent_form" });
  });

  it("reports join requests that wait, were rejected or are used", () => {
    expect(inviteView({ invite: invite({ joinRequestStatus: "pending_approval", joinRequestType: "agent" }), authenticated: true, signedIn: false, companyIds: [] }).kind).toBe(
      "awaiting_approval",
    );
    expect(inviteView({ invite: invite({ joinRequestStatus: "rejected", joinRequestType: "agent" }), authenticated: true, signedIn: false, companyIds: [] })).toEqual({
      kind: "unavailable",
      reason: "This join request wasn't approved.",
    });
    // A person's pending request can still be completed by accepting again.
    expect(inviteView({ invite: invite({ joinRequestStatus: "pending_approval", joinRequestType: "human" }), authenticated: true, signedIn: true, companyIds: [] }).kind).toBe(
      "accept",
    );
  });

  it("reads nested strings from an accept result", () => {
    expect(nestedString({ textInstructions: { url: "https://x/onboarding.txt" } }, ["textInstructions", "url"])).toBe("https://x/onboarding.txt");
    expect(nestedString({ textInstructions: {} }, ["textInstructions", "url"])).toBeNull();
  });
});
