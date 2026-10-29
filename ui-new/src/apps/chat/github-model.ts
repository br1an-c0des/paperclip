import type {
  GitHubAllowedPerson,
  GitHubAppWizardState,
  GitHubChatConfiguration,
  GitHubReviewEvent,
  GitHubReviewPolicy,
} from "@paperclipai/shared";
import type { ChatEndpoint, ChatIdentityLink } from "@/api/chat-endpoints";

/*
 * View model for GitHub review bots (src/apps/chat/GitHubSetup.tsx, GitHubBot.tsx): the guided App
 * registration's states, the manifest form's address check, the organizations you've used, and the
 * review configuration's people and policy. Rules follow ui/src/pages/apps/chat/GitHubChatSetup.tsx,
 * GitHubBotManagement.tsx and GitHubBotConfiguration.tsx.
 */

export type WizardState = GitHubAppWizardState["state"];

/** States the server settles in; others keep the page polling `POST …/github/setup`. */
const SETTLED: ReadonlySet<WizardState> = new Set(["connected", "create", "identity", "enrollment", "recovery"]);

export function wizardPollMs(state: WizardState | undefined) {
  return state && SETTLED.has(state) ? false : 5000;
}

/**
 * The manifest form posts to github.com only: the server's registration address must be GitHub's
 * new-App page for a user or an organization, with nothing smuggled in.
 */
export function manifestAction(registrationUrl: string): string {
  const url = new URL(registrationUrl);
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/(settings|organizations\/[A-Za-z0-9-]+\/settings)\/apps\/new$/.test(url.pathname)
  ) {
    throw new Error("GitHub returned an invalid registration address");
  }
  return url.toString();
}

/** Organizations this company already reaches on GitHub: from project repositories and other bots. */
export function knownOrganizations(
  repositories: ReadonlyArray<{ fullName: string; ownerType?: string | null }>,
  endpoints: readonly ChatEndpoint[],
): string[] {
  const found = new Map<string, string>();
  for (const repository of repositories) {
    if (repository.ownerType !== "organization") continue;
    const login = repository.fullName.split("/")[0];
    if (login) found.set(login.toLowerCase(), login);
  }
  for (const endpoint of endpoints) {
    const github = endpoint.setup?.github;
    if (endpoint.provider === "github" && (endpoint.status === "active" || endpoint.status === "paused") && github?.ownerType === "organization" && github.ownerLogin) {
      found.set(github.ownerLogin.toLowerCase(), github.ownerLogin);
    }
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/** The App's default name: the agent's, cut to GitHub's 34 characters. */
export function defaultAppName(name: string | null | undefined) {
  return (name?.trim() || "GitHub Reviewer").slice(0, 34);
}

/** Verification checks still failing, without the delivery ones once a delivery was seen. */
export function failingChecks(state: GitHubAppWizardState, webhookVerified: boolean) {
  const checks = state.verification?.checks ?? [];
  return checks.filter((check) => !check.ok && !(webhookVerified && (check.key === "webhook" || check.key === "delivery")));
}

// ---------------------------------------------------------------------------------------------
// Configuration: people

export type PersonRow = GitHubAllowedPerson & { linked: boolean; explicit: boolean; label: string | null; principalId: string | null };

/**
 * The people rows: configured members (kept when their link was revoked, so the page can say why
 * they can't run), linked accounts not configured yet, then guests.
 */
export function peopleRows(configuration: GitHubChatConfiguration, links: readonly ChatIdentityLink[]): { members: PersonRow[]; guests: PersonRow[] } {
  const linked = links.filter((link) => link.status === "linked" && link.githubUserId);
  const linkOf = (githubUserId: string) => linked.find((link) => link.githubUserId === githubUserId) ?? null;
  const row = (person: GitHubAllowedPerson, explicit: boolean): PersonRow => {
    const link = linkOf(person.githubUserId);
    return {
      ...person,
      explicit,
      linked: person.kind === "guest" || Boolean(link),
      label: link?.paperclipUserLabel ?? null,
      principalId: link?.principalId ?? null,
    };
  };
  const configured = configuration.people.filter((person) => person.kind === "member").map((person) => row(person, true));
  const extra = linked
    .filter((link) => link.paperclipUserId && !configuration.people.some((person) => person.githubUserId === link.githubUserId))
    .map((link) =>
      row({ kind: "member", userId: link.paperclipUserId!, githubUserId: link.githubUserId!, login: link.githubLogin ?? link.externalLabel }, false),
    );
  const guests = configuration.people.filter((person) => person.kind === "guest").map((person) => row(person, true));
  return { members: [...configured, ...extra], guests };
}

/** Adds or replaces one person (by GitHub user ID). */
export function withPerson(configuration: GitHubChatConfiguration, person: GitHubAllowedPerson): GitHubChatConfiguration {
  const exists = configuration.people.some((entry) => entry.githubUserId === person.githubUserId);
  return {
    ...configuration,
    people: exists ? configuration.people.map((entry) => (entry.githubUserId === person.githubUserId ? person : entry)) : [...configuration.people, person],
  };
}

export function withoutPerson(configuration: GitHubChatConfiguration, githubUserId: string): GitHubChatConfiguration {
  return { ...configuration, people: configuration.people.filter((entry) => entry.githubUserId !== githubUserId) };
}

/** Whether a member's mentions are allowed: every linked member, or only the ones picked. */
export function mentionsAllowed(configuration: GitHubChatConfiguration, person: PersonRow) {
  return person.kind === "guest" || configuration.memberAccess === "all_linked" || person.explicit;
}

// ---------------------------------------------------------------------------------------------
// Configuration: review policy

export const REVIEW_EVENTS: { key: GitHubReviewEvent; label: string }[] = [
  { key: "opened", label: "Pull request opened" },
  { key: "synchronize", label: "New commits pushed" },
  { key: "reopened", label: "Pull request reopened" },
  { key: "ready_for_review", label: "Marked ready for review" },
  { key: "mention", label: "Bot mentioned" },
  { key: "comment", label: "Reply in a bot thread" },
];

export const INVOCATION_LABELS: Record<GitHubReviewPolicy["invocation"], string> = {
  mentions_only: "Only when mentioned",
  linked_authors: "Automatically for linked members",
  allowed_authors: "Automatically for members and allowed contributors",
};

/** One entry per line, trimmed, blanks dropped. */
export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A passing score from 1 to 5, or null for report only; anything else is invalid. */
export function parseScore(text: string, reportOnly: boolean): { ok: true; value: GitHubReviewPolicy["ratingThreshold"] } | { ok: false } {
  if (reportOnly) return { ok: true, value: null };
  const score = Number(text);
  if (text.trim() === "" || !Number.isInteger(score) || score < 1 || score > 5) return { ok: false };
  return { ok: true, value: score as 1 | 2 | 3 | 4 | 5 };
}

export function toggleEvent(policy: GitHubReviewPolicy, event: GitHubReviewEvent, on: boolean): GitHubReviewPolicy {
  const events = on ? [...new Set([...policy.events, event])] : policy.events.filter((entry) => entry !== event);
  return { ...policy, events: REVIEW_EVENTS.map((entry) => entry.key).filter((key) => events.includes(key)) };
}

// ---------------------------------------------------------------------------------------------
// Repositories

export function repositoryNote(resource: { availability: string; enabled: boolean }) {
  return resource.availability === "available" ? undefined : "Unavailable on GitHub. Update the App's installation access, then refresh.";
}

/** `@slug` to mention the bot with, from its bot username (`slug[bot]`). */
export function botMention(endpoint: Pick<ChatEndpoint, "botUsername">) {
  const slug = endpoint.botUsername?.replace(/^@/, "").replace(/\[bot\]$/, "");
  return slug ? `@${slug}` : null;
}

/** The App's settings page on GitHub, where its name and logo change. */
export function appSettingsUrl(endpoint: ChatEndpoint) {
  const github = endpoint.setup?.github;
  const slug = botMention(endpoint)?.slice(1);
  if (!slug) return "https://github.com/settings/apps";
  if (github?.appOwnerType === "organization" && github.appOwnerLogin) {
    return `https://github.com/organizations/${encodeURIComponent(github.appOwnerLogin)}/settings/apps/${encodeURIComponent(slug)}`;
  }
  if (github?.appOwnerType === "personal") return `https://github.com/settings/apps/${encodeURIComponent(slug)}`;
  // Older manual connections don't record who owns the App.
  return "https://github.com/settings/apps";
}
