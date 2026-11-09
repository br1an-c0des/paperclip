/*
 * What MessageBody draws on top of a message's Markdown (U68, since the 2026-11-07 sync):
 *
 * - GitHub links name what they point at (upstream #19476, ui/src/lib/github-link.ts): a pull
 *   request or issue shows as `owner/repo#12` with its icon, a repository as `owner/repo`, any other
 *   GitHub page keeps its text with the GitHub mark.
 * - `diff` and `patch` code blocks colour their lines (upstream #19478, ui/src/lib/patch.ts): added
 *   green, removed red, hunk headers and file headers muted.
 *
 * Both are copied from the old UI as upstream has them, so they can be checked at each sync.
 */

export interface GitHubLink {
  kind: "github" | "repository" | "pull_request" | "issue";
  label: string | null;
  description: string;
}

const RESERVED_PATHS = new Set([
  "about", "account", "apps", "business", "codespaces", "collections", "contact",
  "customer-stories", "education", "enterprise", "enterprises", "events", "explore", "features",
  "issues", "join", "login", "logout", "marketplace", "new", "notifications",
  "organizations", "orgs", "pricing", "pulls", "readme", "search", "security",
  "sessions", "settings", "site", "sponsors", "stars", "team", "topics", "trending", "users",
]);

export function parseGitHubLink(href: string | null | undefined): GitHubLink | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com") || url.username || url.password || url.port) return null;

  const fallback: GitHubLink = { kind: "github", label: null, description: "GitHub" };
  const segments = url.pathname.replace(/\/$/, "").slice(1).split("/");
  const [owner, repository, type, number] = segments;
  if (
    !owner ||
    !repository ||
    RESERVED_PATHS.has(owner.toLowerCase()) ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner) ||
    !/^[a-z\d_.-]+$/i.test(repository) ||
    repository === "." ||
    repository === ".."
  )
    return fallback;

  const repo = `${owner}/${repository}`;
  if ((type === "pull" || type === "issues") && number && /^[1-9]\d*$/.test(number)) {
    const label = `${repo}#${number}`;
    return { kind: type === "pull" ? "pull_request" : "issue", label, description: `GitHub ${type === "pull" ? "pull request" : "issue"}: ${label}` };
  }
  if (segments.length === 2) return { kind: "repository", label: repo, description: `GitHub repository: ${repo}` };
  return fallback;
}

export type PatchLineKind = "add" | "remove" | "hunk" | "context" | "file" | "skip";

/** Classifies a unified diff line by line, tracking hunk lengths so a later file header stays a header. */
export function createUnifiedDiffClassifier(): (raw: string) => { kind: PatchLineKind; text: string } {
  let inHunk = false;
  let remaining: { old: number; next: number } | null = null;
  return (source) => {
    const raw = source.replace(/\r$/, "");
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      return { kind: "skip", text: raw };
    }
    if (raw.startsWith("@@")) {
      const header = raw.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
      remaining = header ? { old: Number(header[1] ?? 1), next: Number(header[2] ?? 1) } : null;
      inHunk = !remaining || remaining.old > 0 || remaining.next > 0;
      return { kind: "hunk", text: raw };
    }
    if (raw === "\\ No newline at end of file") return { kind: "skip", text: raw };
    if (
      !inHunk &&
      (raw.startsWith("+++ ") ||
        raw.startsWith("--- ") ||
        raw.startsWith("index ") ||
        raw.startsWith("new file mode") ||
        raw.startsWith("deleted file mode") ||
        raw.startsWith("similarity index") ||
        raw.startsWith("rename from") ||
        raw.startsWith("rename to"))
    )
      return { kind: "skip", text: raw };
    const kind = raw.startsWith("+") ? "add" : raw.startsWith("-") ? "remove" : "context";
    if (inHunk && remaining) {
      if (kind !== "add") remaining.old -= 1;
      if (kind !== "remove") remaining.next -= 1;
      if (remaining.old <= 0 && remaining.next <= 0) inHunk = false;
    }
    return { kind, text: kind === "add" || kind === "remove" || raw.startsWith(" ") ? raw.slice(1) : raw };
  };
}

/** A patch's lines with their kinds, each keeping its own text and line break, as PatchLines renders them. */
export function patchLines(text: string): { text: string; kind: PatchLineKind }[] {
  const classify = createUnifiedDiffClassifier();
  return text.split(/(?<=\n)/).map((line) => ({ text: line, kind: classify(line.replace(/\r?\n$/, "")).kind }));
}
