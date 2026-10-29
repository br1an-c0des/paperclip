import type {
  AppDefinition,
  ChatActivityItem,
  ChatProvider,
  ChatPublicationState,
  ConnectionMethodDef,
  InstanceExperimentalSettings,
  PhotonProjectInspection,
  SlackAppConfiguration,
} from "@paperclipai/shared";
import type { ChatEndpoint, ChatEndpointStatus, ChatResolution } from "@/api/chat-endpoints";
import type { ConnectionState } from "../apps-model";

/*
 * View model for chat endpoints (src/apps/chat/): an agent people reach from Slack, GitHub, Teams,
 * Discord, Telegram, a Speko voice persona or an AgentMail inbox. The routes under
 * `/:prefix/apps/chat`, which providers the instance shows, the setup steps, the endpoint's tabs,
 * and the activity rules (replay, resolve). The rules follow the old UI's
 * ui/src/pages/apps/chat/ChatEndpointSetup.tsx and ChatEndpointDetail.tsx.
 */

export const PROVIDER_NAMES: Record<ChatProvider, string> = {
  slack: "Slack",
  github: "GitHub",
  discord: "Discord",
  "microsoft-teams": "Microsoft Teams",
  telegram: "Telegram",
  speko: "Speko",
  agentmail: "AgentMail",
  "imessage-photon": "iMessage Photon",
};

export function providerName(provider: string) {
  return PROVIDER_NAMES[provider as ChatProvider] ?? provider;
}

type Flags = Partial<InstanceExperimentalSettings> | undefined;

/**
 * Whether the instance shows a provider: AgentMail inboxes always, GitHub review bots with
 * `enableGitHubReviewBots`, the rest with `enableChatConnectors` (the old UI's chatProviderVisible).
 */
export function chatProviderVisible(provider: string | null | undefined, flags: Flags) {
  if (provider === "agentmail") return true;
  if (provider === "github" || provider === "github-code-review-bot") return flags?.enableGitHubReviewBots === true;
  return flags?.enableChatConnectors === true;
}

// ---------------------------------------------------------------------------------------------
// Routes

export type ChatTab = "settings" | "access" | "reviews" | "conversations" | "activity";
export const CHAT_TABS: { key: ChatTab; label: string }[] = [
  { key: "settings", label: "Settings" },
  { key: "access", label: "Access" },
  { key: "reviews", label: "Reviews" },
  { key: "conversations", label: "Conversations" },
  { key: "activity", label: "Activity" },
];

/** The tabs an endpoint has: reviews only on GitHub; AgentMail and voice have no destinations to list. */
export function tabsFor(provider: ChatProvider): { key: ChatTab; label: string }[] {
  return CHAT_TABS.filter((tab) => tab.key !== "reviews" || provider === "github");
}

export type ChatRoute =
  | { kind: "connect" }
  | { kind: "detail"; endpointId: string; tab: ChatTab }
  /** Relative to `/:prefix/apps`. */
  | { kind: "redirect"; to: string };

/** `/:prefix/apps/<rest>` when it's a chat page (the old UI's `/apps/chat/*`), else null. */
export function chatRoute(rest: string): ChatRoute | null {
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "chat") return null;
  const [, id, tab, extra] = parts;
  if (!id) return { kind: "redirect", to: "" };
  if (id === "connect") return { kind: "connect" };
  // `/apps/chat/:id/reviews/:reviewId`: the review list, where each review links out.
  if (tab === "reviews" && extra) return { kind: "detail", endpointId: id, tab: "reviews" };
  if (tab && CHAT_TABS.some((entry) => entry.key === tab) && !extra) return { kind: "detail", endpointId: id, tab: tab as ChatTab };
  return { kind: "redirect", to: `chat/${encodeURIComponent(id)}/settings` };
}

/** Where to set up a provider's chat endpoint, keeping the agent when one is chosen already. */
export function chatConnectHref(base: string, provider: string, options: { agentId?: string | null; resume?: string; reconnect?: boolean } = {}) {
  const params = new URLSearchParams({ provider });
  if (options.agentId) params.set("agentId", options.agentId);
  if (options.resume) params.set("resume", options.resume);
  if (options.reconnect) params.set("reconnect", "1");
  return `${base}/chat/connect?${params.toString()}`;
}

// ---------------------------------------------------------------------------------------------
// The gallery's chat apps

/** The method that connects an app as a chat channel, with the provider it creates. */
export function channelMethod(app: AppDefinition): (ConnectionMethodDef & { provider: ChatProvider }) | null {
  const method = app.methods.find((candidate) => candidate.purpose === "channel" && candidate.provider);
  return (method as (ConnectionMethodDef & { provider: ChatProvider }) | undefined) ?? null;
}

/** Whether the app also connects as tools (Slack does both: then you choose which). */
export function hasToolMethod(app: AppDefinition) {
  return app.methods.some((method) => (method.purpose ?? "tool") === "tool" && method.transport !== "chat_sdk");
}

/** Chat apps the instance shows, for the gallery: AgentMail, and the rest behind their flags. */
export function chatApps(apps: readonly AppDefinition[], flags: Flags): AppDefinition[] {
  return apps.filter((app) => {
    const method = channelMethod(app);
    return method ? chatProviderVisible(method.provider === "github" ? "github" : method.provider, flags) : false;
  });
}

/** The gallery: the tool apps, then chat-only apps that aren't there yet, in name order. */
export function withChatApps(toolApps: readonly AppDefinition[], apps: readonly AppDefinition[], flags: Flags): AppDefinition[] {
  const shown = new Set(toolApps.map((app) => app.slug));
  const extra = chatApps(apps, flags).filter((app) => !shown.has(app.slug));
  return [...toolApps, ...extra].sort(
    (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.name.localeCompare(b.name),
  );
}

/** The chat provider a gallery app connects, when the instance shows it. */
export function galleryChatProvider(app: AppDefinition, flags: Flags): ChatProvider | null {
  const method = channelMethod(app);
  return method && chatProviderVisible(method.provider, flags) ? method.provider : null;
}

// ---------------------------------------------------------------------------------------------
// An endpoint's state

const STATE: Record<ChatEndpointStatus, ConnectionState> = {
  active: { kind: "connected", label: "Connected", tone: "green", message: null },
  paused: { kind: "paused", label: "Paused", tone: null, message: "It isn't receiving new messages." },
  draft: { kind: "draft", label: "Setup incomplete", tone: "amber", message: "Finish setup before people can reach the agent." },
  verifying: { kind: "draft", label: "Verifying", tone: "amber", message: "Waiting for the provider to confirm." },
  attention: { kind: "attention", label: "Needs attention", tone: "amber", message: null },
  revoked: { kind: "attention", label: "Access revoked", tone: "amber", message: "Reconnect to verify access." },
  archived: { kind: "paused", label: "Removed", tone: null, message: null },
};

export function endpointState(endpoint: Pick<ChatEndpoint, "status" | "healthMessage" | "lastError">): ConnectionState {
  const state = STATE[endpoint.status] ?? STATE.attention;
  return state.kind === "attention" && !state.message ? { ...state, message: endpoint.healthMessage ?? endpoint.lastError ?? null } : state;
}

/** Setup isn't finished (Slack's last step is its test, which counts as done). */
export function needsSetup(endpoint: Pick<ChatEndpoint, "status" | "provider" | "setup">) {
  if (endpoint.setup?.step === "complete") return false;
  if (endpoint.provider === "slack" && endpoint.setup?.step === "test") return false;
  return ["draft", "verifying", "attention", "revoked"].includes(endpoint.status);
}

/** The endpoint's health in words: its lifecycle first, then the provider's last report. */
export function healthPresentation(endpoint: Pick<ChatEndpoint, "status" | "healthMessage" | "lastError">) {
  const lifecycle: Partial<Record<ChatEndpointStatus, string>> = {
    draft: "Connection setup is incomplete.",
    verifying: "Connection verification is in progress.",
    paused: "Connection is paused. Resume it to receive new messages.",
    attention: "Connection needs attention.",
    revoked: "Connection access is revoked. Reconnect to verify access.",
    archived: "Connection has been removed from Paperclip.",
  };
  const message = endpoint.status === "active" ? null : (lifecycle[endpoint.status] ?? null);
  return {
    message: message ?? endpoint.healthMessage ?? null,
    previousHealth: message ? (endpoint.healthMessage ?? null) : null,
    error: endpoint.lastError ?? null,
    errorLabel: ["active", "attention", "revoked"].includes(endpoint.status) ? "Reason" : "Last reported error",
  };
}

/** What reconnecting and removing do at each provider (the old UI's guidance, word for word in spirit). */
export const LIFECYCLE_GUIDANCE: Record<ChatProvider, { reconnect: string; remove: string }> = {
  speko: {
    reconnect: "Reverifies this voice persona and updates its signed session tools. Task history stays.",
    remove: "Stops accepting voice requests. Accepted work and task history stay in Paperclip.",
  },
  agentmail: { reconnect: "Reconnects the same email inbox.", remove: "Disconnects email. Task history stays." },
  slack: {
    reconnect: "Verifies or replaces credentials for this same Slack app. It doesn't reinstall the app or change channels.",
    remove: "Stops new messages and retires the saved Slack credentials. The Slack app and its bot stay installed until you remove them in Slack.",
  },
  github: {
    reconnect: "Verifies this same App and installation, then updates its webhook. It doesn't reinstall the App or change repository access.",
    remove: "Stops new events and retires the saved App key and webhook secret. The GitHub App stays installed until you remove it on GitHub.",
  },
  discord: {
    reconnect: "Verifies this same Discord application and server installation.",
    remove: "Stops its gateway connection and retires the bot token. The bot stays in the server until you remove it in Discord.",
  },
  "microsoft-teams": {
    reconnect: "Verifies this same Microsoft app, tenant and bot. It doesn't reinstall the Teams app.",
    remove: "Stops new messages and retires the client secret. The Entra app, Azure Bot and Teams app stay until you remove them in Microsoft.",
  },
  "imessage-photon": {
    reconnect: "Verifies the same Photon project and line, then recovers eligible missed messages.",
    remove: "Removes the saved secret. Your Photon project, number and Messages history stay in Photon.",
  },
  telegram: {
    reconnect: "Verifies this same BotFather bot and refreshes its webhook and command menu.",
    remove: "Removes its Telegram webhook and command menu, then retires the token. The bot stays until you delete it in Telegram.",
  },
};

// ---------------------------------------------------------------------------------------------
// Setup

export type SetupStep = "agent" | "connect" | "verify" | "try";
export const SETUP_STEPS: { key: SetupStep; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "connect", label: "Connect" },
  { key: "verify", label: "Verify" },
  { key: "try", label: "Try it" },
];

/**
 * Where setup stands: no endpoint yet is choosing the agent; credentials not taken is Connect; the
 * provider still has to call back is Verify; then a test message. Reconnecting starts at Connect.
 */
export function setupStep(endpoint: Pick<ChatEndpoint, "setup" | "status"> | null, repairing = false): SetupStep {
  if (!endpoint) return "agent";
  if (repairing) return "connect";
  const step = endpoint.setup?.step;
  if (step === "test" || step === "complete") return "try";
  if (step === "provider_setup" || step === "verify" || endpoint.status === "verifying") return "verify";
  return "connect";
}

/** Reconnecting a working endpoint, or one the provider cut off, rather than first-time setup. */
export function isRepairing(endpoint: Pick<ChatEndpoint, "status" | "provider" | "providerAccountId" | "botExternalId"> | null, reconnect: boolean) {
  if (!endpoint) return false;
  const recovering = endpoint.status === "attention" || endpoint.status === "revoked";
  // A GitHub draft that never got an App has nothing to reconnect: it's still first-time setup.
  if (endpoint.provider === "github" && recovering && !endpoint.providerAccountId && !endpoint.botExternalId) return false;
  return recovering || (reconnect && (endpoint.status === "active" || endpoint.status === "paused"));
}

/**
 * What Photon's setup sends: the shared DM line when the project offers it, else the picked
 * dedicated number; null until the inspection allows one.
 */
export function photonCredentials(
  inspection: Pick<PhotonProjectInspection, "allocation" | "eligible"> | null,
  projectId: string,
  projectSecret: string,
  lineId: string,
): Record<string, string> | null {
  if (!inspection?.eligible) return null;
  if (inspection.allocation === "shared") return { projectId: projectId.trim(), projectSecret, allocation: "shared" };
  return lineId ? { projectId: projectId.trim(), projectSecret, lineId, allocation: "dedicated" } : null;
}

/** Providers whose setup this board can walk through (all of them since M7: Photon picks its line, Slack can be set up for you). */
export const SETUP_PROVIDERS = new Set<ChatProvider>(["slack", "github", "discord", "microsoft-teams", "telegram", "speko", "agentmail", "imessage-photon"]);

/** Slack's app name, bot name and slash command from the agent's name (the shared package's default). */
export function defaultSlackApp(agentName: string): SlackAppConfiguration {
  const botName =
    agentName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "paperclip-agent";
  return { appName: `${botName}-paperclip`, botName, command: `/${botName.replace(/[._]+/g, "-")}` };
}

const SLACK_BOT_SCOPES = [
  "app_mentions:read", "assistant:write", "channels:history", "channels:read", "chat:write", "commands", "files:read", "files:write",
  "groups:history", "groups:read", "im:history", "im:read", "mpim:history", "mpim:read", "reactions:read", "reactions:write", "users:read",
  // Slack tools
  "im:write", "emoji:read", "pins:read", "pins:write", "bookmarks:read", "bookmarks:write", "channels:manage", "channels:write.topic",
];

const SLACK_EVENTS = [
  "agent_session_stopped", "app_mention", "message.channels", "message.groups", "message.im", "message.mpim", "member_joined_channel",
  "member_left_channel", "channel_left", "group_left", "reaction_added", "reaction_removed", "channel_archive", "group_archive",
  "channel_unarchive", "group_unarchive", "channel_deleted", "channel_rename", "group_rename", "app_uninstalled", "tokens_revoked",
];

/**
 * The Slack App manifest to create the app from (the shared package's buildSlackAppManifest, copied
 * in the style of decision 10): the bot, its slash command, events and interactivity all point at
 * Paperclip's webhook.
 */
export function slackManifest(app: SlackAppConfiguration, agentName: string, webhookUrl: string) {
  return {
    display_information: { name: app.appName, description: `Talk to ${agentName} and manage work in Paperclip.`.slice(0, 140) },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      agent_view: { agent_description: "Work with a Paperclip agent in a task-backed conversation." },
      bot_user: { display_name: app.botName },
      slash_commands: [
        { command: app.command, description: `Start or manage work with ${agentName}`, usage_hint: "status | new | close | <task>", should_escape: false, url: webhookUrl },
      ],
    },
    oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
      event_subscriptions: { request_url: webhookUrl, bot_events: SLACK_EVENTS },
      interactivity: { is_enabled: true, request_url: webhookUrl },
    },
  };
}

/** The credential fields a provider's setup takes (GitHub's App key is sent separately, with its secret). */
export function missingCredentials(fields: readonly { key: string; required?: boolean }[], values: Record<string, string>) {
  return fields.filter((field) => field.required !== false && !values[field.key]?.trim()).map((field) => field.key);
}

// ---------------------------------------------------------------------------------------------
// Activity

export const ACTIVITY_KIND_LABELS: Record<ChatActivityItem["kind"], string> = {
  delivery: "Message in",
  publication: "Message out",
  action: "Provider action",
  health: "Connection health",
  repair: "Connection repair",
};

/** A failed delivery or publication can be replayed, unless it carried a file. */
export function canReplay(item: ChatActivityItem) {
  if (item.fileTransfer || !item.replayable || item.status !== "failed") return false;
  return item.kind === "delivery" || item.kind === "publication";
}

/** The ways to settle an unconfirmed send; a file still in consent or upload may only be cancelled. */
export function resolutionActions(item: ChatActivityItem): ChatResolution[] {
  const offered = item.resolutionActions ?? [];
  const file = item.fileTransfer;
  if (!file) return offered;
  if (item.kind !== "publication" || !Number.isSafeInteger(file.version) || file.version < 1) return [];
  if (!["consent_unknown", "upload_unknown", "file_info_unknown", "conflict"].includes(file.phase)) return [];
  return file.phase === "file_info_unknown" ? offered : offered.filter((action) => action === "cancel");
}

export function canResolve(item: ChatActivityItem) {
  return (item.kind === "publication" || item.kind === "action") && item.status === "delivery_unknown" && resolutionActions(item).length > 0;
}

export function resolutionText(item: ChatActivityItem) {
  if (item.actionType === "slash_task_start") {
    return "Paperclip lost track after asking Slack to start the task. Check Slack first: retrying can make a duplicate message and task.";
  }
  if (item.actionType === "provider_effect") {
    return "Paperclip lost track after sending this reply. Check the provider first: marking it delivered applies any pending change; retrying can send it twice.";
  }
  const phase = item.fileTransfer?.phase;
  if (phase === "file_info_unknown") {
    return "The file uploaded, but its Teams notice wasn't confirmed. Check Teams first. Retrying sends only the notice, and may duplicate it.";
  }
  if (phase === "consent_unknown") return "The consent card may have reached Teams; the file isn't delivered. Cancelling doesn't remove a card already sent.";
  if (phase) return "The file may already be in OneDrive. Cancelling stops this transfer; it doesn't delete what's there.";
  return "Paperclip lost track after sending. Check the conversation first: retrying can send it twice.";
}

export const RESOLUTION_LABELS: Record<ChatResolution, string> = {
  mark_delivered: "Mark delivered",
  retry_anyway: "Retry anyway",
  cancel: "Cancel the send",
};

/** A resource each channel can turn on by itself (Teams' direct and group chats follow the settings). */
export function isToggleableResource(provider: ChatProvider, type: string) {
  return !(provider === "microsoft-teams" && (type === "direct_message" || type === "group_chat"));
}

// ---------------------------------------------------------------------------------------------
// A task's chat conversation

export const PUBLICATION_FEEDBACK: Record<ChatPublicationState, { title: string; tone: "info" | "success" | "warn" | "error" }> = {
  awaiting_consent: { title: "Waiting for the recipient to accept the file", tone: "info" },
  published: { title: "Sent to the conversation", tone: "success" },
  pending: { title: "Queued", tone: "info" },
  streaming: { title: "Sending…", tone: "info" },
  retry: { title: "Delivery will be retried", tone: "warn" },
  delivery_unknown: { title: "Delivery not confirmed; settle it in the endpoint's Activity before sending again", tone: "warn" },
  failed: { title: "Delivery failed; retry it from the endpoint's Activity", tone: "error" },
  cancelled: { title: "Delivery cancelled; some parts may already be there", tone: "info" },
};

/** A send is finished when every part of it is published. */
export function publicationDone(status: { total: number; published: number; publication: { state: ChatPublicationState } } | undefined) {
  return Boolean(status && status.total > 0 && status.published === status.total && status.publication.state === "published");
}
