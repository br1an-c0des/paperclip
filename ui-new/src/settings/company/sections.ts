/*
 * Company settings' sections (board 21's rail and board 30's outline), each with its own URL under
 * `/:prefix/company/settings`, and where the old UI's settings addresses land.
 *
 * Plugin settings pages keep the old UI's address, `/company/settings/<routePath>`, so any other
 * first segment is a plugin page candidate; the page checks it against the installed plugins.
 */

export type SectionKey = "general" | "members" | "connections" | "secrets" | "budgets" | "environments" | "transfer";

export type SectionDef = { key: SectionKey; label: string; path: string };

export const SECTIONS: readonly SectionDef[] = [
  { key: "general", label: "General", path: "" },
  { key: "members", label: "Members", path: "/members" },
  { key: "connections", label: "Connections", path: "/connections" },
  { key: "secrets", label: "Secrets", path: "/secrets" },
  { key: "budgets", label: "Budgets", path: "/budgets" },
  { key: "environments", label: "Environments", path: "/environments" },
  { key: "transfer", label: "Import and export", path: "/transfer" },
];

export type Route =
  | { kind: "section"; key: SectionKey }
  /** An old address: go to `key`'s section, with `anchor` when it names one of its cards. */
  | { kind: "redirect"; key: SectionKey; anchor?: string }
  | { kind: "plugin"; routePath: string }
  /** App (instance) settings live elsewhere; their old addresses aren't company settings. */
  | { kind: "instance" };

const BY_SEGMENT = new Map(SECTIONS.map((section) => [section.path.slice(1), section.key]));

/** Old addresses: the old UI's company settings pages, and its redirects to them (generated/routes.md). */
const LEGACY: Record<string, { key: SectionKey; anchor?: string }> = {
  access: { key: "members" },
  invites: { key: "members", anchor: "invites" },
  "join-requests": { key: "members", anchor: "join-requests" },
  "cloud-upstream": { key: "transfer" },
  export: { key: "transfer", anchor: "export" },
  import: { key: "transfer", anchor: "import" },
};

/**
 * What the part of the address after `/company/settings` names. `search` is the query string,
 * for the old Members page's `?tab=invites`.
 */
export function parseSettingsPath(rest: string | undefined, search = ""): Route {
  const segments = (rest ?? "").split("/").filter(Boolean);
  const [first, second] = segments;
  if (!first) return { kind: "section", key: "general" };
  if (first === "instance") {
    // Environments moved here from instance settings: the API is per company (board 30).
    if (second === "environments") return { kind: "redirect", key: "environments" };
    return { kind: "instance" };
  }
  const key = BY_SEGMENT.get(first);
  if (key) {
    if (segments.length > 1) return { kind: "redirect", key };
    if (key === "members" && new URLSearchParams(search).get("tab") === "invites") return { kind: "redirect", key, anchor: "invites" };
    return { kind: "section", key };
  }
  const legacy = LEGACY[first];
  if (legacy) return { kind: "redirect", ...legacy };
  return { kind: "plugin", routePath: first };
}

/** The address of a section, with an optional card anchor. */
export function sectionHref(base: string, key: SectionKey, anchor?: string) {
  const section = SECTIONS.find((entry) => entry.key === key)!;
  return `${base}${section.path}${anchor ? `#${anchor}` : ""}`;
}

/** The old UI's `/company/export/*` and `/company/import` pages land on Import and export. */
export function transferRedirect(base: string, kind: "export" | "import") {
  return sectionHref(base, "transfer", kind);
}
