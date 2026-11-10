/*
 * Which sidebar the shell shows, and where "Back to app" goes (SettingsNav.tsx).
 *
 * App settings (`/company/settings/instance/*`) and Company settings (`/company/settings/*`) swap the
 * main left nav for their own sidebar. The old UI's addresses that land on them (`/instance/*`,
 * `/settings/*`, `/company/export/*`, `/company/import`) count as settings too, so passing through a
 * redirect never becomes the place Back to app returns to. `/company/settings/tools/*` is a retired
 * page that redirects out of settings (routes/legacy-model.ts), so it doesn't.
 *
 * Back to app returns to the last address outside settings, kept in memory only; moving between
 * sections, or between the two settings areas, leaves it alone. Without one, or when it belongs to
 * another company, it goes to the company's dashboard.
 */

export type SettingsArea = "app" | "company";

/** The address after `/:prefix`, or null when it's outside that company. */
function companyPath(pathname: string, prefix: string): string | null {
  const lower = pathname.toLowerCase();
  const base = `/${prefix.toLowerCase()}`;
  if (lower !== base && !lower.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length).replace(/\/+$/, "");
  return rest === "" ? "/" : rest;
}

/** The settings area an address belongs to, or null for the rest of the app. */
export function settingsArea(pathname: string, prefix: string): SettingsArea | null {
  const path = companyPath(pathname, prefix);
  if (!path) return null;
  if (/^\/(?:company\/settings\/instance|instance|settings)(?:\/|$)/i.test(path)) return "app";
  if (/^\/company\/settings\/tools(?:\/|$)/i.test(path)) return null;
  if (/^\/company\/(?:settings|export|import)(?:\/|$)/i.test(path)) return "company";
  return null;
}

export type Place = { pathname: string; search?: string; hash?: string };

/** What to remember after a move to `place`: the place itself outside settings, else what was kept. */
export function nextAppPath(previous: string | null, place: Place, prefix: string): string | null {
  if (settingsArea(place.pathname, prefix)) return previous;
  return `${place.pathname}${place.search ?? ""}${place.hash ?? ""}`;
}

/** Where Back to app goes: the remembered address in this company, or its dashboard. */
export function backToAppHref(remembered: string | null, prefix: string): string {
  if (remembered) {
    const pathname = remembered.replace(/[?#].*$/, "");
    if (companyPath(pathname, prefix) !== null && !settingsArea(pathname, prefix)) return remembered;
  }
  return `/${prefix}/dashboard`;
}
