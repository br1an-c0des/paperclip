import { dehydrate, hashKey, hydrate, type Query, type QueryClient, type QueryKey } from "@tanstack/solid-query";
import { classifyError, isTransientError } from "./errors";

/*
 * Reads kept across reloads (U51, after ui/src/lib/persisted-query-cache.ts in #18825): an
 * allowlist of what the shell and the last tasks need, saved in local storage, so a reload while
 * the server is down still opens the board on the last data instead of an empty page.
 *
 * - **Allowlist.** Health, the session (who you are: name, email, picture, nothing else), board
 *   access, your companies and their order, the instance's settings and plugin pages; per company
 *   the agents, projects, labels, people, sidebar counts, your inbox and the task list; the nav's
 *   personal reads (your project order, your stars and the projects you left), so a reload draws
 *   the nav as you arranged it at once instead of reshuffling it as they arrive; and the 20 tasks
 *   opened last; and the 100 pull request previews (U113) learned last. Nothing else: no comments,
 *   documents, run output, secrets or credentials. Fields that could carry those are stripped from
 *   what is saved (`EXCLUDED_FIELDS`).
 * - **Pull request previews** (since the 2026-11-10 sync, as the old UI keeps them after #20654):
 *   your own (the key names you), in the company's record, each kept only for the `maxAgeMs` its
 *   answer gave, so an expired one is never restored as current. A link GitHub couldn't describe,
 *   or a read that failed, is the 60-second "no preview" and isn't kept. A restored preview isn't
 *   refetched: it keeps its read time, so opening its card reads again only once `maxAgeMs` has
 *   passed (LinkPreview.tsx `staleTime`).
 * - **Scope.** One record per user and company, plus one for the user (`…:<user>:root`). A reload
 *   restores only the last signed-in user's records, and only companies in their saved list.
 * - **Age.** Each read is kept 24 hours from when it was fetched. Records from another build are
 *   dropped, since a new build can read data differently.
 * - **Clearing.** Sign-out clears the user's records, and so does the server saying the session is
 *   gone. A task the server refuses (403, 404) leaves the record at the next save.
 * - **Restored reads are stale.** Each is refetched as soon as a screen uses it. While the server
 *   is down the refetch waits (connectivity.ts) and the saved data shows.
 *
 * A saved session shows the board but doesn't send writes: the session gate checks it with the
 * server first (session.tsx `verified`).
 */

export const QUERY_CACHE_PREFIX = "paperclip.ui-new.query-cache.v1:";
export const QUERY_CACHE_ACTIVE = `${QUERY_CACHE_PREFIX}active`;
export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
export const QUERY_CACHE_MAX_TASKS = 20;
export const QUERY_CACHE_MAX_LINK_PREVIEWS = 100;
const MAX_RECORD_CHARS = 1_500_000;
/** In local_trusted mode there's no session; tasks call the board `local-board`. */
export const LOCAL_BOARD_USER = "local-board";

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type SavedQuery = { queryKey: unknown[]; data: unknown; dataUpdatedAt: number };
type Envelope = { version: 1; userId: string; companyId: string | null; buildId: string; savedAt: number; queries: SavedQuery[] };

const controllers = new WeakMap<QueryClient, { clear: () => void }>();

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Keys that may hold someone's words, a secret or a credential. They're never written to storage. */
const EXCLUDED_FIELDS = new Set(
  [
    "planDocument", "legacyPlanDocument", "documentSummaries", "documents", "comments", "workProducts", "browsers",
    "pairingCode", "viewerUrl", "accessToken", "refreshToken", "sessionToken", "token", "password", "apiKey", "privateKey",
    "authorization", "access_token", "refresh_token", "id_token", "clientSecret", "client_secret", "api_key", "private_key",
    "credentials", "env", "secretMaterial", "boardBootstrap",
  ].map((key) => key.toLowerCase()),
);
/** An agent's adapter settings keep only what names its model, as the old UI's cache does. */
const ADAPTER_DISPLAY_FIELDS = ["provider", "model", "agent", "acpxAgent", "effort", "modelReasoningEffort", "reasoningEffort", "thinking", "variant"];

export function displayData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(displayData);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !EXCLUDED_FIELDS.has(key.toLowerCase()))
      .map(([key, item]) => {
        if (key === "runtimeConfig") return [key, {}];
        if (key === "adapterConfig") {
          const config = object(item) ?? {};
          const kept: [string, unknown][] = ADAPTER_DISPLAY_FIELDS.filter((field) => typeof config[field] === "string").map((field) => [field, config[field]]);
          if (typeof config.fastMode === "boolean") kept.push(["fastMode", config.fastMode]);
          return [key, Object.fromEntries(kept)];
        }
        return [key, displayData(item)];
      }),
  );
}

/** The session, as far as showing who you are goes. */
function sessionDisplay(data: unknown, userId: string) {
  const session = object(data);
  const user = object(session?.user);
  return {
    session: { id: String(object(session?.session)?.id ?? ""), userId },
    user: { id: userId, name: user?.name ?? null, email: user?.email ?? null, image: user?.image ?? null },
  };
}

const userIdOf = (session: unknown) => {
  const id = object(object(session)?.user)?.id;
  return typeof id === "string" && id ? id : null;
};

/** Whose board this is: the signed-in user, `local-board` without sign-in, or null while unknown. */
export function cacheUser(client: QueryClient): string | null {
  const health = object(client.getQueryData(["health"]));
  if (health?.deploymentMode === "local_trusted") return LOCAL_BOARD_USER;
  return userIdOf(client.getQueryData(["auth", "session"]));
}

/** The companies list's key for a user: by account, or "anonymous" without sign-in (company.tsx). */
const companiesKeyFor = (userId: string) => ["companies", "list", userId === LOCAL_BOARD_USER ? "anonymous" : userId];

function companyIdsFor(client: QueryClient, userId: string): string[] {
  const list = client.getQueryData<unknown>(companiesKeyFor(userId));
  return Array.isArray(list) ? list.map((company) => object(company)?.id).filter((id): id is string => typeof id === "string" && !!id) : [];
}

const isTaskDetail = (key: readonly unknown[]) => key[0] === "issues" && key[1] === "detail" && key.length === 3;
const isTaskRef = (key: readonly unknown[]) => key[0] === "issues" && key[1] === "ref" && key.length === 3;
const isLinkPreview = (key: readonly unknown[]) => key[0] === "link-preview";

/**
 * A pull request preview worth keeping (`queryKeys.linkPreview`'s answer): one GitHub described,
 * still within the `maxAgeMs` it was given at `updatedAt`.
 */
export function previewCurrent(data: unknown, updatedAt: number, now: number) {
  const result = object(data);
  const maxAgeMs = result?.maxAgeMs;
  return (
    !!object(result?.preview) &&
    typeof maxAgeMs === "number" &&
    Number.isFinite(maxAgeMs) &&
    Number.isFinite(updatedAt) &&
    now - updatedAt >= 0 &&
    now - updatedAt < maxAgeMs
  );
}

/**
 * Which record a read belongs in: null for the user's own record, a company id, or undefined when
 * it isn't kept. This is the allowlist; everything not named here stays in memory only.
 */
export function persistScope(key: readonly unknown[], data: unknown, userId: string, companyIds: readonly string[]): string | null | undefined {
  const [root, second, third] = key;
  if (key.length === 1 && root === "health") return null;
  if (root === "auth" && second === "session" && key.length === 2) return userIdOf(data) === userId ? null : undefined;
  if (root === "access" && second === "current-board-access" && key.length === 2) return object(data)?.userId === userId ? null : undefined;
  if (hashKey(key) === hashKey(companiesKeyFor(userId))) return null;
  if (root === "instance" && key.length === 2 && (second === "experimental-settings" || second === "general-settings")) return null;
  if (root === "plugins" && second === "ui-contributions" && key.length === 2) return null;
  // Your nav's order (layout/nav-prefs.tsx): companies in your record, projects in the company's.
  if (root === "sidebar-preferences" && second === "company-order" && key.length === 3) return third === userId ? null : undefined;
  if (root === "sidebar-preferences" && second === "project-order" && key.length === 4) {
    return key[3] === userId && typeof third === "string" && companyIds.includes(third) ? third : undefined;
  }
  if (isTaskDetail(key)) {
    const companyId = object(data)?.companyId;
    return typeof companyId === "string" && companyIds.includes(companyId) ? companyId : undefined;
  }
  if (root === "access" && second === "company-user-directory" && key.length === 3) return companyIds.includes(String(third)) ? String(third) : undefined;
  if (typeof second !== "string" || !companyIds.includes(second)) return undefined;
  if (key.length === 2 && (root === "agents" || root === "sidebar-badges" || root === "goals")) return second;
  if (root === "projects" && key.length === 3 && third === "list") return second;
  // Your memberships: the projects and agents you starred, and the projects you left.
  if (root === "resource-memberships" && key.length === 3 && third === "me") return second;
  if (root === "issues" && key.length === 3 && third === "labels") return second;
  // Your pull request previews (U113): the key names whose they are.
  if (isLinkPreview(key) && key.length === 4 && third === userId && typeof key[3] === "string") return second;
  // Your inbox: its task rows and the attention feed.
  if (root === "issues" && key.length === 4 && third === "inbox" && (key[3] === "mine" || key[3] === "mine-context")) return second;
  if (root === "attention" && key.length === 3 && third === "with-dismissed") return second;
  // The whole company's task list in its default order (TasksView.tsx `useTaskList`).
  if (root === "issues" && key.length === 5 && third === "view" && key[3] === "__all__" && key[4] === "__all__") return second;
  return undefined;
}

/** What's written for a read: the session as display identity, a task reference as it is, the rest stripped. */
function projected(query: SavedQuery, userId: string): unknown {
  if (query.queryKey[0] === "auth" && query.queryKey[1] === "session") return sessionDisplay(query.data, userId);
  if (isTaskRef(query.queryKey)) return query.data;
  return displayData(query.data);
}

function browserStorage(): CacheStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const recordKey = (userId: string, companyId: string | null) =>
  `${QUERY_CACHE_PREFIX}${encodeURIComponent(userId)}:${companyId === null ? "root" : encodeURIComponent(companyId)}`;

function storageKeys(storage: CacheStorage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function removeRecords(storage: CacheStorage, userId?: string) {
  const prefix = userId ? `${QUERY_CACHE_PREFIX}${encodeURIComponent(userId)}:` : QUERY_CACHE_PREFIX;
  for (const key of storageKeys(storage)) if (key.startsWith(prefix) && key !== QUERY_CACHE_ACTIVE) storage.removeItem(key);
  if (!userId || storage.getItem(QUERY_CACHE_ACTIVE) === userId) storage.removeItem(QUERY_CACHE_ACTIVE);
}

/** Clears the signed-in user's saved reads (sign-out). */
export function clearPersistedQueries(client: QueryClient) {
  controllers.get(client)?.clear();
}

export type PersistedCache = { flush: () => void; clear: () => void; dispose: () => void };

export function startPersistedQueryCache(
  client: QueryClient,
  options: { buildId: string | null; storage?: CacheStorage | null; now?: () => number; debounceMs?: number; target?: Window | null },
): PersistedCache {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const buildId = options.buildId?.trim() || null;
  const now = options.now ?? Date.now;
  const target = options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let owner: string | null = null;
  // When another user's session replaced the one whose reads are in memory: only reads fetched
  // since then are theirs to save.
  let switchedAt = 0;
  // Reads the server refused for good since the page loaded: never saved again until they succeed.
  const blocked = new Set<string>();
  // When each task was last opened, so the 20 kept are the ones you looked at.
  const visits = new Map<string, number>();

  const clear = () => {
    const userId = owner ?? cacheUser(client);
    try {
      if (storage) removeRecords(storage, userId ?? undefined);
    } catch {
      // Storage unavailable: nothing was saved.
    }
    owner = null;
  };
  controllers.set(client, { clear });
  if (!storage || !buildId) return { flush: () => {}, clear, dispose: () => controllers.delete(client) };

  const fresh = (updatedAt: number) => Number.isFinite(updatedAt) && now() - updatedAt >= 0 && now() - updatedAt <= QUERY_CACHE_MAX_AGE;

  const read = (userId: string, companyId: string | null): Envelope | null => {
    const key = recordKey(userId, companyId);
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as Envelope;
      if (entry?.version !== 1 || entry.userId !== userId || entry.companyId !== companyId || entry.buildId !== buildId || !fresh(entry.savedAt) || !Array.isArray(entry.queries)) {
        storage.removeItem(key);
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  };
  const valid = (entry: Envelope, companyIds: string[]) =>
    entry.queries.filter(
      (query) =>
        Array.isArray(query?.queryKey) &&
        query.data !== undefined &&
        fresh(query.dataUpdatedAt) &&
        !blocked.has(hashKey(query.queryKey)) &&
        (!isLinkPreview(query.queryKey) || previewCurrent(query.data, query.dataUpdatedAt, now())) &&
        // A task reference rides in the company record of the task it names (see flush).
        (isTaskRef(query.queryKey)
          ? entry.companyId !== null && typeof query.data === "string"
          : persistScope(query.queryKey, query.data, entry.userId, companyIds) === entry.companyId),
    );
  const restore = (entry: Envelope, companyIds: string[]) => {
    const queries = valid(entry, companyIds);
    hydrate(client, {
      mutations: [],
      queries: queries.map((query) => ({
        queryKey: query.queryKey as QueryKey,
        queryHash: hashKey(query.queryKey),
        dehydratedAt: entry.savedAt,
        state: {
          data: query.data,
          dataUpdatedAt: query.dataUpdatedAt,
          dataUpdateCount: 1,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          // A preview keeps its read time and `maxAgeMs`: its card reads again only once that's passed.
          isInvalidated: !isLinkPreview(query.queryKey),
          status: "success" as const,
          fetchStatus: "idle" as const,
        },
      })),
    });
    // Saved data is a stand-in: each read refetches as soon as a screen uses it.
    const restored = new Set(queries.filter((query) => !isLinkPreview(query.queryKey)).map((query) => hashKey(query.queryKey)));
    void client.invalidateQueries({ predicate: (query) => restored.has(query.queryHash) }, { cancelRefetch: false });
  };

  // Restore the last signed-in user's records, before anything renders.
  try {
    const active = storage.getItem(QUERY_CACHE_ACTIVE);
    const root = active ? read(active, null) : null;
    if (active && root) {
      owner = active;
      restore(root, []);
      const companyIds = companyIdsFor(client, active);
      for (const companyId of companyIds) {
        const entry = read(active, companyId);
        if (entry) restore(entry, companyIds);
      }
    } else if (active) {
      // Another build's records, or too old.
      removeRecords(storage);
    }
  } catch {
    // Unreadable records: start empty.
  }

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    const userId = cacheUser(client);
    if (!userId) return;
    if (owner && owner !== userId) {
      removeRecords(storage, owner);
      if (!switchedAt) switchedAt = now();
    }
    owner = userId;
    const companyIds = companyIdsFor(client, userId);
    const eligible = (query: Query) =>
      query.state.data !== undefined &&
      (query.state.status === "success" || isTransientError(query.state.error)) &&
      !blocked.has(query.queryHash) &&
      fresh(query.state.dataUpdatedAt) &&
      query.state.dataUpdatedAt >= switchedAt &&
      (!isLinkPreview(query.queryKey) || previewCurrent(query.state.data, query.state.dataUpdatedAt, now())) &&
      persistScope(query.queryKey, query.state.data, userId, companyIds) !== undefined;

    // Reads saved before that aren't in memory any more (garbage-collected) are kept until they age out.
    const merged = new Map<string, SavedQuery>();
    for (const companyId of [null, ...companyIds]) {
      const entry = read(userId, companyId);
      if (entry) for (const query of valid(entry, companyIds)) merged.set(hashKey(query.queryKey), query);
    }
    for (const query of dehydrate(client, { shouldDehydrateQuery: eligible, shouldDehydrateMutation: () => false }).queries) {
      const saved = merged.get(query.queryHash);
      if (!saved || saved.dataUpdatedAt <= query.state.dataUpdatedAt) {
        merged.set(query.queryHash, { queryKey: [...query.queryKey], data: query.state.data, dataUpdatedAt: query.state.dataUpdatedAt });
      }
    }

    // The 20 tasks opened last, and the references (TES-12) that lead to them.
    const tasks = [...merged.entries()]
      .filter(([, query]) => isTaskDetail(query.queryKey))
      .sort(([a, x], [b, y]) => (visits.get(b) ?? y.dataUpdatedAt) - (visits.get(a) ?? x.dataUpdatedAt));
    const keptTasks = new Set(tasks.slice(0, QUERY_CACHE_MAX_TASKS).map(([, query]) => String(query.queryKey[2])));
    // The 100 pull request previews learned last.
    const keptPreviews = new Set(
      [...merged.entries()]
        .filter(([, query]) => isLinkPreview(query.queryKey))
        .sort(([, x], [, y]) => y.dataUpdatedAt - x.dataUpdatedAt)
        .slice(0, QUERY_CACHE_MAX_LINK_PREVIEWS)
        .map(([hash]) => hash),
    );
    const queries = [...merged.entries()]
      .filter(([hash, query]) => {
        if (isTaskDetail(query.queryKey)) return keptTasks.has(String(query.queryKey[2]));
        if (isLinkPreview(query.queryKey)) return keptPreviews.has(hash);
        return true;
      })
      .map(([, query]) => query);
    // A reference to a kept task goes in that task's company record.
    const refs = [...client.getQueryCache().getAll()]
      .filter((query) => isTaskRef(query.queryKey) && typeof query.state.data === "string" && keptTasks.has(query.state.data) && fresh(query.state.dataUpdatedAt))
      .map((query) => ({ queryKey: [...query.queryKey], data: query.state.data, dataUpdatedAt: query.state.dataUpdatedAt }));
    const taskCompany = new Map(queries.filter((query) => isTaskDetail(query.queryKey)).map((query) => [String(query.queryKey[2]), String(object(query.data)?.companyId)]));

    try {
      for (const companyId of [null, ...companyIds]) {
        const own = queries.filter((query) => persistScope(query.queryKey, query.data, userId, companyIds) === companyId);
        const ownRefs = companyId === null ? [] : refs.filter((query) => taskCompany.get(String(query.data)) === companyId);
        let saved = [...own, ...ownRefs].map((query) => ({ ...query, data: projected(query, userId) }));
        let serialized = JSON.stringify({ version: 1, userId, companyId, buildId, savedAt: now(), queries: saved } satisfies Envelope);
        // Too big: drop the task list first, then give up on the record.
        if (serialized.length > MAX_RECORD_CHARS) {
          saved = saved.filter((query) => !(query.queryKey[0] === "issues" && query.queryKey[2] === "view"));
          serialized = JSON.stringify({ version: 1, userId, companyId, buildId, savedAt: now(), queries: saved } satisfies Envelope);
        }
        if (serialized.length <= MAX_RECORD_CHARS) storage.setItem(recordKey(userId, companyId), serialized);
        else storage.removeItem(recordKey(userId, companyId));
      }
      // Companies you've lost access to go with their records.
      const kept = new Set([null, ...companyIds].map((companyId) => recordKey(userId, companyId)));
      const prefix = `${QUERY_CACHE_PREFIX}${encodeURIComponent(userId)}:`;
      for (const key of storageKeys(storage)) if (key.startsWith(prefix) && !kept.has(key)) storage.removeItem(key);
      storage.setItem(QUERY_CACHE_ACTIVE, userId);
    } catch {
      // Storage full: the saved reads are a convenience, so make room for everything else.
      try {
        removeRecords(storage, userId);
      } catch {
        // Nothing more to do.
      }
    }
  };

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, options.debounceMs ?? 1_000);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (disposed) return;
    const key = event.query.queryKey;
    if (event.type === "observerAdded" && isTaskDetail(key)) visits.set(String(key[2]), now());
    if (event.type !== "updated") return;
    const action = event.action;
    // Signed out, or the session ended on the server: forget this user's saved reads.
    if (key[0] === "auth" && key[1] === "session" && action.type === "success" && !userIdOf(action.data)) {
      clear();
      return;
    }
    // Someone else signed in: what's in memory from before isn't theirs.
    const signedIn = key[0] === "auth" && key[1] === "session" && action.type === "success" ? userIdOf(action.data) : null;
    if (signedIn && owner && signedIn !== owner) switchedAt = now();
    if (key[0] === "auth" && key[1] === "session" && action.type === "error" && ["auth", "forbidden"].includes(classifyError(action.error))) {
      clear();
      return;
    }
    if (action.type === "success") {
      blocked.delete(event.query.queryHash);
      schedule();
    } else if (action.type === "error" && !isTransientError(action.error)) {
      // A real refusal (no access, gone): it leaves storage at once.
      blocked.add(event.query.queryHash);
      flush();
    }
  });
  const onPageHide = () => flush();
  target?.addEventListener("pagehide", onPageHide);

  const dispose = () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe();
    target?.removeEventListener("pagehide", onPageHide);
    controllers.delete(client);
  };
  return { flush, clear, dispose };
}
