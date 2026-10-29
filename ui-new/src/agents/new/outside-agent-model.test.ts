import { EXTERNAL_AGENT_TOOL_GUIDANCE as SHARED_GUIDANCE } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { buildAgentOnboardingPrompt as oldPrompt } from "../../../../ui/src/lib/agent-onboarding-prompt";
import { buildAgentOnboardingPrompt, EXTERNAL_AGENT_TOOL_GUIDANCE, hasCeo, onboardingTextUrl, requestsForInvite } from "./outside-agent-model";

describe("the onboarding prompt", () => {
  it("mirrors the shared tool guidance", () => {
    expect(EXTERNAL_AGENT_TOOL_GUIDANCE).toBe(SHARED_GUIDANCE);
  });

  it("matches the old UI's prompt for the same invite", () => {
    const inputs = [
      { onboardingTextUrl: "http://localhost:3100/api/invites/pcp_abc/onboarding.txt" },
      {
        onboardingTextUrl: "http://localhost:3100/api/invites/pcp_abc/onboarding.txt",
        connectionCandidates: ["http://box.tailnet:3100", " ", "not a url"],
        testResolutionUrl: "http://box.tailnet:3100/api/invites/pcp_abc/test-resolution",
      },
      { onboardingTextUrl: "/api/invites/pcp_abc/onboarding.txt", connectionCandidates: [] },
    ];
    for (const input of inputs) expect(buildAgentOnboardingPrompt(input)).toBe(oldPrompt(input));
  });

  it("lists every reachable address with the onboarding path", () => {
    const prompt = buildAgentOnboardingPrompt({
      onboardingTextUrl: "http://localhost:3100/api/invites/pcp_abc/onboarding.txt",
      connectionCandidates: ["http://box.tailnet:3100"],
    });
    expect(prompt).toContain("- http://localhost:3100/api/invites/pcp_abc/onboarding.txt");
    expect(prompt).toContain("- http://box.tailnet:3100/api/invites/pcp_abc/onboarding.txt");
    expect(prompt).toContain("http://localhost:3100/api/invites/pcp_abc/test-resolution?url=");
  });
});

describe("outside agent helpers", () => {
  it("needs a CEO that isn't retired", () => {
    expect(hasCeo([])).toBe(false);
    expect(hasCeo([{ role: "general", status: "idle" }])).toBe(false);
    expect(hasCeo([{ role: "ceo", status: "terminated" }])).toBe(false);
    expect(hasCeo([{ role: "ceo", status: "paused" }])).toBe(true);
  });

  it("makes the onboarding address absolute", () => {
    expect(onboardingTextUrl({ token: "t", onboardingTextPath: "/api/invites/t/onboarding.txt" }, "http://localhost:5175")).toBe(
      "http://localhost:5175/api/invites/t/onboarding.txt",
    );
    expect(onboardingTextUrl({ token: "t", onboardingTextUrl: "https://pc.example/api/invites/t/onboarding.txt" }, "http://localhost:5175")).toBe(
      "https://pc.example/api/invites/t/onboarding.txt",
    );
    expect(onboardingTextUrl({ token: "t" }, "http://localhost:5175")).toBe("http://localhost:5175/api/invites/t/onboarding.txt");
  });

  it("finds the join requests sent through the invite, newest first", () => {
    const requests = [
      { id: "a", inviteId: "inv-1", createdAt: new Date("2026-10-28T10:00:00Z") },
      { id: "b", inviteId: "inv-2", createdAt: new Date("2026-10-28T11:00:00Z") },
      { id: "c", inviteId: "inv-1", createdAt: new Date("2026-10-28T12:00:00Z") },
    ];
    expect(requestsForInvite(requests, "inv-1").map((request) => request.id)).toEqual(["c", "a"]);
    expect(requestsForInvite(requests, null)).toEqual([]);
  });
});
