/*
 * Where the old UI's addresses land (audit/m7-parity.md, section 4), kept apart from the routes so
 * the mapping can be tested. Agents, Slack messages, emails and the `paperclip` skill link to these,
 * so each one goes to the page that does the same job now. Every redirect keeps the query and the
 * fragment (`#comment-<id>`, `#document-<key>`), which the page it lands on reads.
 */

/** "PAP-123" or a case's "PAP-C7": the company prefix in front of a task or case identifier. */
export function identifierPrefix(ref: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-[A-Za-z]?\d+$/.exec(ref.trim());
  return match ? match[1]! : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

/** Appends the query and fragment to a target that may already have a query of its own. */
export function withSearchAndHash(target: string, search: string, hash: string) {
  const [path, own = ""] = target.split("?") as [string, string?];
  const params = new URLSearchParams(own);
  for (const [key, value] of new URLSearchParams(search)) if (!params.has(key)) params.append(key, value);
  const query = params.toString();
  const fragment = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `${path}${query ? `?${query}` : ""}${fragment}`;
}

/**
 * The old developer Tools pages moved under Apps → Advanced (ui/src/App.tsx,
 * `legacyToolsRedirectTarget`); relative to `/:prefix/`.
 */
export function legacyToolsTarget(tab?: string | null) {
  if (!tab) return "apps/advanced/profiles";
  if (["applications", "connections", "overview", "examples", "runtime", "audit"].includes(tab)) return "apps";
  if (tab === "policies") return "apps/advanced/profiles";
  return `apps/advanced/${encodeURIComponent(tab)}`;
}

const OLD_TASK_VIEWS = new Set(["active", "all", "backlog", "done"]);

/**
 * A company page's old address (what follows `/:prefix/`, without query or fragment) and where it
 * goes now, relative to `/:prefix/` unless it starts with `/`; null when the address is current.
 */
export function companyLegacyTarget(rest: string): string | null {
  const path = rest.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const [first, second, third] = parts;
  switch (first) {
    case "issues":
      // The old Organization views became status presets on the task list (tasks/view-url.ts).
      if (parts.length === 2 && OLD_TASK_VIEWS.has(second!)) return `issues?view=${second}`;
      if (parts.length === 2 && second === "recent") return "issues";
      return null;
    case "tasks":
      return parts.length === 1 ? "issues" : null;
    case "dashboard":
      return second === "live" && parts.length === 2 ? "dashboard" : null;
    // The Decisions page and its queues were dropped (decision 12): what needs you is the Inbox.
    case "decisions":
      return "inbox";
    case "approvals":
      if (parts.length === 1 || (second === "pending" && parts.length === 2)) return "inbox";
      return null;
    // Goals are set in project settings (decision 14); the company's goals were the dashboard's.
    case "goals":
      return parts.length === 1 ? "dashboard" : null;
    case "tools":
      return parts.length <= 2 ? legacyToolsTarget(second) : null;
    case "company":
      if (second === "settings" && third === "tools" && parts.length <= 4) return legacyToolsTarget(parts[3]);
      return null;
    case "companies":
      return parts.length === 1 ? "/companies" : null;
    // The conference-room chat was an experiment behind a switch; agent chats took its place.
    case "board-chat":
      return "chats";
    // Artifacts V1 was dropped (decision 12); Search's Artifacts scope lists the company's outputs.
    case "artifacts":
      return parts.length === 1 ? "search?scope=artifacts" : null;
    // Cases get pages of their own with D1; until then the list is the task list.
    case "cases":
      return parts.length === 1 ? "issues" : null;
    case "status-cards":
      return second ? `status/${encodeURIComponent(second)}` : "status";
    default:
      return null;
  }
}

/** A project's old tabs (`/projects/:key/<tab>`), which became sections of its settings. */
export function projectLegacyTab(tab: string): string | null {
  const path = tab.replace(/^\/+|\/+$/g, "");
  if (path === "configuration") return "settings";
  if (path === "budget") return "settings/budget";
  if (path === "workspaces" || path.startsWith("workspaces/")) return "settings/code";
  return null;
}
