/*
 * Addresses that name a record by something a rename changes: a project's or agent's `urlKey`
 * (derived from its name) and the company's issue prefix (re-derived when a managed instance
 * renames the company, which also re-keys every task and case identifier).
 *
 * A page that finds its record by such a key remembers which record each key found, so after a
 * rename (on the page, in another tab, or from a live update) the old key still finds the record by
 * its id. The page then moves the address to the new key, keeping the rest of the path, the query
 * and the fragment. Older history entries and remembered paths ("Back to app") with the old key
 * still land on the record, since the memory lasts for the session.
 */

/** Which record id each address key last found, per page kind. Keys include their scope. */
export type KeyMemory = Map<string, string>;

/**
 * The record an address key names: the one the key matches now, or else the one it matched
 * earlier in this session (found by id), which has since been renamed.
 */
export function followKey<T extends { id: string }>(
  items: readonly T[] | undefined,
  key: string,
  matches: (item: T, key: string) => boolean,
  memory: KeyMemory,
  scope = "",
): T | undefined {
  if (!items || !key) return undefined;
  const direct = items.find((item) => matches(item, key));
  if (direct) {
    rememberKey(memory, key, direct.id, scope);
    return direct;
  }
  const id = rememberedId(memory, key, scope);
  return id ? items.find((item) => item.id === id) : undefined;
}

/** Records that a key found this record, for a page that finds records its own way. */
export function rememberKey(memory: KeyMemory, key: string, id: string, scope = "") {
  memory.set(`${scope}\u0000${key}`, id);
}

/** The id a key found earlier in this session, if it did. */
export function rememberedId(memory: KeyMemory, key: string, scope = "") {
  return memory.get(`${scope}\u0000${key}`);
}

type Place = { pathname: string; search: string; hash: string };

/** The address with the path segment at `index` (0 is the company prefix) set to `value`. */
export function addressWithSegment(place: Place, index: number, value: string) {
  const segments = place.pathname.split("/");
  // The leading "/" makes segments[0] empty, so path segment `index` is at `index + 1`.
  if (segments.length > index + 1) segments[index + 1] = encodeURIComponent(value);
  return `${segments.join("/")}${place.search}${place.hash}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The address under the company's new issue prefix: the first segment, and the task and case
 * identifiers the server re-keyed with it (`OLD-12` and `OLD-C3` become `NEW-12` and `NEW-C3`), in
 * the path after `issues` or `cases` and in query values (`?task=OLD-12`).
 */
export function addressWithPrefix(place: Place, oldPrefix: string, newPrefix: string) {
  const identifier = new RegExp(`^${escapeRegExp(oldPrefix)}-(C?\\d+)$`, "i");
  const rekey = (value: string) => {
    const match = identifier.exec(value);
    return match ? `${newPrefix}-${match[1].toUpperCase()}` : value;
  };
  const segments = place.pathname.split("/");
  if (segments.length > 1) segments[1] = encodeURIComponent(newPrefix);
  for (let index = 2; index < segments.length; index += 1) {
    if (segments[index - 1] === "issues" || segments[index - 1] === "cases") {
      segments[index] = encodeURIComponent(rekey(decodeSegment(segments[index])));
    }
  }
  let search = place.search;
  if (search) {
    const entries = [...new URLSearchParams(search).entries()];
    const next = entries.map(([name, value]) => [name, rekey(value)] as [string, string]);
    if (next.some(([, value], index) => value !== entries[index][1])) search = `?${new URLSearchParams(next).toString()}`;
  }
  return `${segments.join("/")}${search}${place.hash}`;
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
