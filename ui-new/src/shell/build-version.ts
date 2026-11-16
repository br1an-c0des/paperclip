/*
 * The build line under You in the nav (BuildVersion.tsx): "ui 1a2b3c4 · server 5d6e7f8". The UI's
 * commit and build time are baked in by vite.config.ts (`__UI_COMMIT__`, `__UI_BUILT_AT__`); the
 * server's is `GET /api/health`'s `commit`. A UI built without a commit (a Docker build given no
 * PAPERCLIP_UI_COMMIT) says "ui unknown"; a server that reports none leaves its part out.
 */

const SHA = /^[0-9a-f]{7,40}$/i;

/** A git sha, trimmed, or null for anything that isn't one (empty, "dev", "unknown"). */
export function fullCommit(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return SHA.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** The first 7 characters of a git sha, or null. */
export function shortCommit(value: string | null | undefined): string | null {
  return fullCommit(value)?.slice(0, 7) ?? null;
}

export type BuildVersion = {
  /** The visible line: "ui 1a2b3c4 · server 5d6e7f8", "ui unknown · server 5d6e7f8", "ui 1a2b3c4". */
  line: string;
  ui: string | null;
  server: string | null;
  /** The UI's build time, ISO, or null when it isn't a valid date. */
  builtAt: string | null;
};

export function buildVersion(input: { uiCommit: string | null | undefined; uiBuiltAt: string | null | undefined; serverCommit: string | null | undefined }): BuildVersion {
  const ui = fullCommit(input.uiCommit);
  const server = fullCommit(input.serverCommit);
  const parts = [`ui ${ui ? ui.slice(0, 7) : "unknown"}`];
  if (server) parts.push(`server ${server.slice(0, 7)}`);
  const at = input.uiBuiltAt ? new Date(input.uiBuiltAt) : null;
  return { line: parts.join(" · "), ui, server, builtAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null };
}

/** The build time as the tooltip shows it, in the viewer's locale and time zone. */
export function formatBuiltAt(iso: string | null, locale?: string, timeZone?: string): string {
  if (!iso) return "Unknown";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}
