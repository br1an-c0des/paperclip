/*
 * The command palette's view model: which commands match a query, and in what order. Kept apart from
 * the component so the matching can be tested.
 *
 * A command matches when every word of the query appears in its label or keywords, ignoring case.
 * Labels that start with the query rank first. With no query, each group shows its first few
 * entries.
 */

export type PaletteCommand = {
  id: string;
  label: string;
  /** Extra words to match on, such as a task's identifier. */
  keywords?: string;
  hint?: string;
  run: () => void;
};

export type PaletteGroup = { title: string; commands: PaletteCommand[]; /** Shown with no query. */ idleLimit?: number };

const MAX_PER_GROUP = 8;

export function matchScore(command: PaletteCommand, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const label = command.label.toLowerCase();
  const haystack = `${label} ${command.keywords?.toLowerCase() ?? ""}`;
  if (!words.every((word) => haystack.includes(word))) return null;
  const phrase = words.join(" ");
  if (label.startsWith(phrase)) return 0;
  if (label.split(/\W+/).some((part) => part.startsWith(words[0]!))) return 1;
  return 2;
}

export const SEARCH_HANDOFF_ID = "search-everything";

/**
 * The hand-off to the Search page, drawn last: "Search everything", or "Search everything for
 * “…”" with what's typed. It's always there, so a query that matches no command still leads
 * somewhere; Shift+Enter runs it from anywhere in the list.
 */
export function searchHandOff(query: string, open: (query: string) => void): PaletteGroup {
  const term = query.trim().replace(/\s+/g, " ");
  return {
    title: "Search",
    commands: [
      {
        id: SEARCH_HANDOFF_ID,
        label: term ? `Search everything for “${term}”` : "Search everything",
        hint: "Shift Enter",
        run: () => open(term),
      },
    ],
  };
}

/** The old palette's quick filters (ui/src/lib/search-query-parser.ts): Search's operators. */
export const QUICK_FILTERS = ["assignee:me", "is:open", "updated:>7d"] as const;

/**
 * Quick filters: picking one adds the operator to what's typed and keeps the palette open, so the
 * hand-off below takes it to the Search page, which reads it. Ones already typed are left out; with
 * all of them typed, there's no group.
 */
export function quickFilterGroup(query: string, setQuery: (next: string) => void): PaletteGroup | null {
  const typed = new Set(query.trim().split(/\s+/).filter(Boolean));
  const left = QUICK_FILTERS.filter((chip) => !typed.has(chip));
  if (left.length === 0) return null;
  return {
    title: "Quick filters",
    commands: left.map((chip) => ({
      id: `filter:${chip}`,
      label: chip,
      hint: "Add",
      run: () => setQuery(query.trim() ? `${query.trim()} ${chip} ` : `${chip} `),
    })),
  };
}

/** The groups to show for a query, each filtered, ranked and capped; empty groups are dropped. */
export function filterPalette(groups: PaletteGroup[], query: string): PaletteGroup[] {
  const searching = query.trim().length > 0;
  return groups
    .map((group) => {
      if (!searching) return { ...group, commands: group.commands.slice(0, group.idleLimit ?? MAX_PER_GROUP) };
      const ranked = group.commands
        .map((command, index) => ({ command, index, score: matchScore(command, query) }))
        .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .slice(0, MAX_PER_GROUP)
        .map((entry) => entry.command);
      return { ...group, commands: ranked };
    })
    .filter((group) => group.commands.length > 0);
}
