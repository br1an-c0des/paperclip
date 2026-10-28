import type { AppDefinition, ChatActivityItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { ChatEndpoint } from "@/api/chat-endpoints";
import {
  canReplay,
  canResolve,
  chatApps,
  chatConnectHref,
  chatProviderVisible,
  chatRoute,
  defaultSlackApp,
  endpointState,
  galleryChatProvider,
  isRepairing,
  missingCredentials,
  needsSetup,
  publicationDone,
  resolutionActions,
  setupStep,
  slackManifest,
  tabsFor,
  withChatApps,
} from "./chat-model";
import { addressProblem, inboxDomains, suggestUsername } from "./email-model";

const on = { enableChatConnectors: true, enableGitHubReviewBots: true };
const off = { enableChatConnectors: false, enableGitHubReviewBots: false };

const app = (slug: string, methods: Partial<AppDefinition["methods"][number]>[], extra: Partial<AppDefinition> = {}) =>
  ({ slug, name: slug[0]!.toUpperCase() + slug.slice(1), methods, ...extra }) as unknown as AppDefinition;
const slack = app("slack", [
  { key: "mcp", purpose: "tool", transport: "mcp_remote" },
  { key: "chat", purpose: "channel", provider: "slack", transport: "chat_sdk" },
] as never);
const telegram = app("telegram", [{ key: "chat", purpose: "channel", provider: "telegram", transport: "chat_sdk" }] as never);
const agentmail = app("agentmail", [{ key: "chat", purpose: "channel", provider: "agentmail", transport: "chat_sdk" }] as never);
const github = app("github-code-review-bot", [{ key: "chat", purpose: "channel", provider: "github", transport: "chat_sdk" }] as never);
const linear = app("linear", [{ key: "mcp", purpose: "tool", transport: "mcp_remote" }] as never);

describe("chatProviderVisible", () => {
  it("always shows AgentMail and keeps the rest behind their flags", () => {
    expect(chatProviderVisible("agentmail", off)).toBe(true);
    expect(chatProviderVisible("slack", off)).toBe(false);
    expect(chatProviderVisible("slack", { enableChatConnectors: true })).toBe(true);
    expect(chatProviderVisible("github", { enableChatConnectors: true })).toBe(false);
    expect(chatProviderVisible("github", { enableGitHubReviewBots: true })).toBe(true);
    expect(chatProviderVisible("slack", undefined)).toBe(false);
  });
});

describe("chatRoute", () => {
  it("reads the chat pages under /apps", () => {
    expect(chatRoute("")).toBeNull();
    expect(chatRoute("connections/c1")).toBeNull();
    expect(chatRoute("chat/connect")).toEqual({ kind: "connect" });
    expect(chatRoute("chat/e1/activity")).toEqual({ kind: "detail", endpointId: "e1", tab: "activity" });
    expect(chatRoute("chat/e1/reviews/r9")).toEqual({ kind: "detail", endpointId: "e1", tab: "reviews" });
  });

  it("sends unknown or missing tabs to settings, and a bare /chat to Apps", () => {
    expect(chatRoute("chat/e1")).toEqual({ kind: "redirect", to: "chat/e1/settings" });
    expect(chatRoute("chat/e1/nope")).toEqual({ kind: "redirect", to: "chat/e1/settings" });
    expect(chatRoute("chat")).toEqual({ kind: "redirect", to: "" });
  });

  it("keeps the reviews tab to GitHub", () => {
    expect(tabsFor("slack").map((tab) => tab.key)).not.toContain("reviews");
    expect(tabsFor("github").map((tab) => tab.key)).toContain("reviews");
  });

  it("builds the connect address with the agent", () => {
    expect(chatConnectHref("/TES/apps", "slack", { agentId: "a1" })).toBe("/TES/apps/chat/connect?provider=slack&agentId=a1");
    expect(chatConnectHref("/TES/apps", "slack", { resume: "e1", reconnect: true })).toBe("/TES/apps/chat/connect?provider=slack&resume=e1&reconnect=1");
  });
});

describe("the gallery's chat apps", () => {
  it("shows chat apps only when their flag is on", () => {
    expect(chatApps([slack, telegram, agentmail, github, linear], off).map((entry) => entry.slug)).toEqual(["agentmail"]);
    expect(chatApps([slack, telegram, agentmail, github, linear], on).map((entry) => entry.slug)).toEqual([
      "slack",
      "telegram",
      "agentmail",
      "github-code-review-bot",
    ]);
  });

  it("adds chat-only apps to the tool apps without repeating one", () => {
    const merged = withChatApps([slack, linear], [slack, telegram, agentmail, linear], on);
    expect(merged.map((entry) => entry.slug)).toEqual(["agentmail", "linear", "slack", "telegram"]);
  });

  it("names the provider a tile connects", () => {
    expect(galleryChatProvider(telegram, on)).toBe("telegram");
    expect(galleryChatProvider(telegram, off)).toBeNull();
    expect(galleryChatProvider(linear, on)).toBeNull();
  });
});

describe("an endpoint's state and setup", () => {
  const endpoint = (fields: Partial<ChatEndpoint>) => ({ status: "active", provider: "slack", ...fields }) as ChatEndpoint;

  it("reads the lifecycle, with the provider's message when it needs attention", () => {
    expect(endpointState(endpoint({})).label).toBe("Connected");
    expect(endpointState(endpoint({ status: "attention", healthMessage: "Token revoked" })).message).toBe("Token revoked");
    expect(endpointState(endpoint({ status: "draft" })).kind).toBe("draft");
  });

  it("walks setup from the agent to the test", () => {
    expect(setupStep(null)).toBe("agent");
    expect(setupStep(endpoint({ status: "draft" }))).toBe("connect");
    expect(setupStep(endpoint({ status: "draft", setup: { step: "provider_setup" } }))).toBe("verify");
    expect(setupStep(endpoint({ status: "verifying" }))).toBe("verify");
    expect(setupStep(endpoint({ setup: { step: "test" } }))).toBe("try");
    expect(setupStep(endpoint({ setup: { step: "complete" } }), true)).toBe("connect");
  });

  it("counts Slack's test step as set up", () => {
    expect(needsSetup(endpoint({ status: "draft" }))).toBe(true);
    expect(needsSetup(endpoint({ status: "draft", provider: "telegram", setup: { step: "test" } }))).toBe(true);
    expect(needsSetup(endpoint({ status: "verifying", provider: "slack", setup: { step: "test" } }))).toBe(false);
    expect(needsSetup(endpoint({ status: "active" }))).toBe(false);
  });

  it("treats a GitHub draft without an App as first-time setup, not a repair", () => {
    expect(isRepairing(endpoint({ status: "attention", provider: "github" }), false)).toBe(false);
    expect(isRepairing(endpoint({ status: "attention", provider: "github", providerAccountId: "1" }), false)).toBe(true);
    expect(isRepairing(endpoint({ status: "active" }), true)).toBe(true);
    expect(isRepairing(endpoint({ status: "active" }), false)).toBe(false);
  });

  it("lists the credentials still missing", () => {
    const fields = [{ key: "botToken" }, { key: "signingSecret" }, { key: "guildId", required: false }];
    expect(missingCredentials(fields, { botToken: "x", signingSecret: " " })).toEqual(["signingSecret"]);
  });

  it("names the Slack app after the agent and points its manifest at the webhook", () => {
    const slackApp = defaultSlackApp("Ada Lovelace!");
    expect(slackApp).toEqual({ appName: "ada-lovelace-paperclip", botName: "ada-lovelace", command: "/ada-lovelace" });
    const manifest = slackManifest(slackApp, "Ada", "https://board.test/hooks/slack");
    expect(manifest.settings.event_subscriptions.request_url).toBe("https://board.test/hooks/slack");
    expect(manifest.features.slash_commands[0]!.command).toBe("/ada-lovelace");
  });
});

describe("activity", () => {
  const item = (fields: Partial<ChatActivityItem>) => ({ id: "i", kind: "publication", status: "failed", replayable: true, ...fields }) as ChatActivityItem;

  it("replays failed sends, never ones carrying a file", () => {
    expect(canReplay(item({}))).toBe(true);
    expect(canReplay(item({ status: "delivered" as never }))).toBe(false);
    expect(canReplay(item({ fileTransfer: { phase: "upload_unknown", version: 1 } as never }))).toBe(false);
  });

  it("only lets a file in an unknown upload be cancelled", () => {
    const unknown = item({ status: "delivery_unknown" as never, resolutionActions: ["mark_delivered", "retry_anyway", "cancel"] });
    expect(resolutionActions(unknown)).toEqual(["mark_delivered", "retry_anyway", "cancel"]);
    expect(canResolve(unknown)).toBe(true);
    expect(resolutionActions({ ...unknown, fileTransfer: { phase: "upload_unknown", version: 2 } } as ChatActivityItem)).toEqual(["cancel"]);
    expect(resolutionActions({ ...unknown, fileTransfer: { phase: "uploading", version: 2 } } as ChatActivityItem)).toEqual([]);
  });

  it("is done when every part is published", () => {
    expect(publicationDone({ total: 2, published: 2, publication: { state: "published" } })).toBe(true);
    expect(publicationDone({ total: 2, published: 1, publication: { state: "pending" } })).toBe(false);
    expect(publicationDone(undefined)).toBe(false);
  });
});

describe("AgentMail addresses", () => {
  it("suggests a username from the agent's name", () => {
    expect(suggestUsername("Ada Lovelace")).toBe("ada-lovelace");
    expect(suggestUsername("--Bob")).toBe("bob");
  });

  it("offers verified domains and AgentMail's own", () => {
    const inspection = {
      scope: { scope_type: "organization" },
      inboxes: [],
      domains: [
        { domain_id: "1", domain: "Example.com", status: "VERIFIED" },
        { domain_id: "2", domain: "pending.com", status: "PENDING" },
      ],
    };
    expect(inboxDomains(inspection, "agentmail.to")).toEqual(["example.com", "agentmail.to"]);
  });

  it("explains what's wrong with an address", () => {
    expect(addressProblem("", "@agentmail.to", [])).toMatch(/before the @/);
    expect(addressProblem("-x", "-x@agentmail.to", [])).toMatch(/Start with/);
    expect(addressProblem("ada", "ada@agentmail.to", ["ADA@agentmail.to"])).toMatch(/already in use/);
    expect(addressProblem("ada", "ada@agentmail.to", [])).toBeNull();
  });
});
