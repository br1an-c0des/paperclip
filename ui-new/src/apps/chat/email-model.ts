import type { AgentMailInspection } from "@/api/email";

/*
 * AgentMail setup rules (src/apps/chat/EmailSetup.tsx), as the old UI's EmailEndpointSetup has
 * them: the address it suggests from the agent's name, the domains an account can use, and what's
 * wrong with a chosen address.
 */

/** "Ada Lovelace" → "ada-lovelace": lowercase, safe characters, at most 64. */
export function suggestUsername(agentName: string) {
  return agentName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
}

/** AgentMail's own domain, the account's verified domains, and whatever is chosen now. */
export function inboxDomains(inspection: AgentMailInspection | null, current: string) {
  const verified = (inspection?.domains ?? [])
    .filter((entry) => entry.status === "VERIFIED" && entry.domain.toLowerCase() !== "agentmail.to")
    .map((entry) => entry.domain.toLowerCase());
  return [...new Set([...verified, "agentmail.to", current])];
}

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Why the new address can't be used, or null. `known` are addresses already taken. */
export function addressProblem(username: string, address: string, known: readonly string[]) {
  if (!username) return "Choose the part before the @.";
  if (username.length > 64) return "Keep it to 64 characters.";
  if (!USERNAME_PATTERN.test(username)) return "Start with a letter or number; use letters, numbers, dots, - and _.";
  if (known.some((entry) => entry.toLowerCase() === address.toLowerCase())) return "That address is already in use. Choose another.";
  return null;
}
