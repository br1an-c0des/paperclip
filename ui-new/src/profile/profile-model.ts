import type { UserProfileDailyPoint, UserProfileResponse, UserProfileWindowStats } from "@paperclipai/shared";

/*
 * The profile page's numbers (after ui/src/pages/UserProfile.tsx), kept apart from the page so they
 * can be tested: slugs, the headline numbers, completion rates and the fourteen-day chart.
 */

type Usage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

export function totalTokens(row: Usage) {
  return row.inputTokens + row.cachedInputTokens + row.outputTokens;
}

/** As the server slugs a name, email or id (server/src/routes/user-profiles.ts). */
export function slugify(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/**
 * The slug to ask for. `me` is you: the server doesn't know "me", so it becomes your id, the one
 * slug that names one member (display names needn't be unique). Old `/u/me` links work that way.
 */
export function profileSlug(slug: string, youId: string | null): string {
  if (slug.toLowerCase() === "me") return youId ? (slugify(youId) ?? youId) : "me";
  return slug;
}

/** The address of someone's profile under a company: by id when it's known. */
export function profilePath(prefix: string, user: { id?: string | null; name?: string | null; email?: string | null } | null | undefined) {
  const slug = slugify(user?.id) ?? slugify(user?.name) ?? slugify(user?.email?.split("@")[0]) ?? "me";
  return `/${prefix}/u/${slug}`;
}

export function completionRate(stats: Pick<UserProfileWindowStats, "touchedIssues" | "completedIssues">) {
  if (stats.touchedIssues === 0) return 0;
  return Math.round((stats.completedIssues / stats.touchedIssues) * 100);
}

export function displayName(user: UserProfileResponse["user"]) {
  return user.name?.trim() || user.email?.split("@")[0] || "User";
}

export function windowOf(profile: UserProfileResponse, key: UserProfileWindowStats["key"]) {
  return profile.stats.find((entry) => entry.key === key);
}

export type ChartDay = { date: string; tokens: number; completed: number; height: number; label: string; tick: boolean };

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "Oct 14" for a `YYYY-MM-DD` day, read as a calendar date (not shifted by the time zone). */
export function shortDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return SHORT_DATE.format(new Date(year, month - 1, day));
}

/**
 * The fourteen days as bars: each day's tokens as a share of the busiest day (at least 4% when
 * there was any use, so a quiet day still shows), its completions, and a date under the first,
 * middle and last bars.
 */
export function chartDays(points: readonly UserProfileDailyPoint[]): ChartDay[] {
  const totals = points.map((point) => totalTokens(point));
  const max = Math.max(1, ...totals);
  const last = points.length - 1;
  return points.map((point, index) => {
    const tokens = totals[index]!;
    return {
      date: point.date,
      tokens,
      completed: point.completedIssues,
      height: tokens === 0 ? 0 : Math.max(4, Math.round((tokens / max) * 100)),
      label: shortDay(point.date),
      tick: index === 0 || index === Math.floor(last / 2) || index === last,
    };
  });
}

/** "issue comment added" from `issue.comment_added`. */
export function actionLabel(action: string) {
  return action.replace(/[._]/g, " ").replace(/^./, (char) => char.toUpperCase());
}
