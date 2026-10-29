import type { Agent, JoinRequest } from "@paperclipai/shared";

/*
 * Inviting an outside agent (decision 39, D2; guides/outside-agents.md): an agent that runs on its
 * own (Hermes, OpenClaw, any HTTP agent) joins through an agent-only invite. It reads the invite's
 * onboarding text, sends a join request, and once the board approves it in the Inbox, claims its
 * Paperclip API key.
 *
 * `buildAgentOnboardingPrompt` is ported from ui/src/lib/agent-onboarding-prompt.ts, word for word.
 * `EXTERNAL_AGENT_TOOL_GUIDANCE` mirrors packages/shared/src/external-agent-guidance.ts (ui-new
 * imports the shared package with `import type` only). Check both at each upstream sync.
 */

export type OutsidePreset = "hermes" | "other";

export const OUTSIDE_PRESETS: { value: OutsidePreset; name: string; description: string; adapter: string }[] = [
  { value: "hermes", name: "Hermes", description: "An existing Hermes agent, through its gateway", adapter: "hermes_gateway" },
  { value: "other", name: "Other", description: "Any agent that can connect to Paperclip: OpenClaw, an HTTP service, a script", adapter: "http" },
];

export const EXTERNAL_AGENT_TOOL_GUIDANCE = `When you receive a Paperclip assignment or message, use your own available tools, apps, plugins, skills, and capabilities to complete the requested work, then return the result to Paperclip. For example, use your existing Slack connection when the task calls for Slack. Paperclip's app catalog describes what this connection exposes; it is not a list of everything you can use in your own runtime. A missing Paperclip app connection does not make your own connection unavailable. Respect each tool's existing permissions, approvals, and the user's current instructions. Keep Paperclip data and actions within this connection's authorized company, agent, and task. Never use another Paperclip connection or identity to bypass a denial. Setup or test restrictions apply only to their stated scope; do not carry them into later requests unless the user explicitly says they continue.`;

/**
 * Whether approving an agent's join request can work: the server files the new agent under the
 * company's CEO and answers 409 "no active CEO" without one (decision 40). Any agent with the CEO
 * role that isn't retired counts, as `resolveJoinRequestAgentManagerId` reads the company's agents.
 */
export function hasCeo(agents: readonly Pick<Agent, "role" | "status">[] | undefined) {
  return (agents ?? []).some((agent) => agent.role === "ceo" && agent.status !== "terminated");
}

/** The onboarding text's absolute address: the invite's own, or its path on this origin. */
export function onboardingTextUrl(invite: { token: string; onboardingTextUrl?: string; onboardingTextPath?: string }, origin: string) {
  const path = invite.onboardingTextUrl ?? invite.onboardingTextPath ?? `/api/invites/${invite.token}/onboarding.txt`;
  try {
    return new URL(path, origin).href;
  } catch {
    return path;
  }
}

/** Join requests that came in through this invite, newest first. */
export function requestsForInvite<T extends Pick<JoinRequest, "inviteId" | "createdAt">>(requests: readonly T[] | undefined, inviteId: string | null) {
  if (!inviteId) return [];
  return (requests ?? [])
    .filter((request) => request.inviteId === inviteId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export type AgentOnboardingPromptInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function buildAgentOnboardingPrompt(input: AgentOnboardingPromptInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0 ? candidateUrls.map((url) => `- ${url}`).join("\n") : "- (No candidate URLs are available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask the operator to configure a reachable Paperclip hostname, then retry.
Suggested steps for the operator:
- choose a hostname that resolves to the Paperclip host from your runtime
- run: npx paperclipai allowed-hostname <host>
- restart Paperclip
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this agent onboarding prompt`
      : `If none are reachable, ask the operator to add a reachable Paperclip hostname, restart, and retry.
Suggested command for the operator:
- npx paperclipai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nIf your runtime exposes a callback or gateway URL, test Paperclip-to-agent reachability with: ${resolutionTestUrl}?url=<urlencoded-agent-url>.`
    : "";

  return `You're invited to join a Paperclip company as an agent.

First, respond to your user that you understand the request and are going to onboard into Paperclip. Then work through the steps below.

Paperclip onboarding documents to try:
${candidateList}

Connectivity guidance:
Paperclip must be reachable from your runtime. Verify a base URL with: GET <base-url>/api/health
${connectivityBlock}${resolutionLine}

Join flow:
1. Read the onboarding.txt document from the first reachable URL above.
2. Submit an agent join request to the invite registration endpoint.
3. Use your own agent name for \`agentName\`.
4. Include a concise \`capabilities\` summary so the board knows what work to assign you.
5. Set \`adapterType\` to the Paperclip adapter that matches your runtime when one exists.
6. Put runtime-specific settings in \`agentDefaultsPayload\`.
7. Wait for board approval before claiming the API key.
8. Claim the Paperclip API key once through the standard claim endpoint, store it securely, and use it for future Paperclip API calls. Store the parsed \`token\` field from the raw HTTP JSON response before printing or summarizing it; do not copy token values from chat, transcript, or tool-output previews. A token value containing literal \`...\` or \`[redacted]\` is a masked display preview, not a valid key. Do not rotate or invent a Paperclip key manually.

OpenClaw Gateway note:
If you are an OpenClaw Gateway agent, use \`adapterType: "openclaw_gateway"\`, set \`agentDefaultsPayload.url\` to your \`ws://\` or \`wss://\` gateway URL, and include \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token. Do not use \`/v1/responses\` or \`/hooks/*\` in that join flow.

Hermes Gateway note:
If you are a Hermes Gateway agent, use \`adapterType: "hermes_gateway"\`.
- For a clean Hermes install, generate a fresh random gateway key, start Hermes with \`API_SERVER_ENABLED=true\` and \`API_SERVER_KEY=<random-gateway-key>\`, then run \`hermes gateway run --replace --accept-hooks\`. The default Hermes API server port is \`8642\`.
- Set \`agentDefaultsPayload.apiBaseUrl\` to the Hermes gateway URL Paperclip can reach, \`agentDefaultsPayload.apiKey\` to the exact same value as \`API_SERVER_KEY\`, and \`agentDefaultsPayload.paperclipApiUrl\` to the Paperclip base URL Hermes can reach. \`agentDefaultsPayload.apiKey\` is the Hermes gateway key, not the Paperclip API key.
- \`apiBaseUrl\` examples: local loopback API \`http://127.0.0.1:8642\`; local dashboard root \`http://127.0.0.1:9119\` (Paperclip maps it to \`/api\`); LAN/private network \`http://<private-ip>:8642\`; private overlay \`http://<tailnet-host>:8642\`; Docker \`http://host.docker.internal:8642\`; reverse proxy/TLS \`https://hermes-gateway.example\`.
- If you only have the default Hermes dashboard or chat URL, \`http://127.0.0.1:9119\` and \`http://127.0.0.1:9119/chat\` are accepted and map to \`/api\` automatically.
- Watch out: \`/chat\` and the dashboard root are browser UI routes. Paperclip tests \`/api/health\` and starts runs with \`/api/v1/runs\` after mapping them to the API base.
- Three distinct uses to keep apart: \`hermes_local\` runs Hermes on the Paperclip host; \`hermes_gateway\` calls an already-running Hermes API server via \`apiBaseUrl\`; Hermes-originated Paperclip API calls use the claimed \`PAPERCLIP_API_KEY\` and \`PAPERCLIP_API_URL\`, not \`agentDefaultsPayload.apiBaseUrl\`.
- When claiming the Paperclip API key from Hermes, write the raw response \`token\` directly to private storage and verify it with a Paperclip API call. Hermes/tool displays may redact or truncate secrets, so never persist a displayed preview that contains \`...\` as the actual key.

After you have connected to Paperclip, review and follow the full onboarding instructions in onboarding.txt.

Working through Paperclip:
${EXTERNAL_AGENT_TOOL_GUIDANCE}
`;
}

function buildCandidateOnboardingUrls(input: AgentOnboardingPromptInput): string[] {
  const candidates = (input.connectionCandidates ?? []).map((candidate) => candidate.trim()).filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) urls.add(trimmed);
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) urls.add(candidate);
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentOnboardingPromptInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(/\/onboarding\.txt$/, "/test-resolution");
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
