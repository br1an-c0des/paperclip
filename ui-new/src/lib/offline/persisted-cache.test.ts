import { QueryClient } from "@tanstack/solid-query";
import { afterEach, describe, expect, it } from "vitest";
import { memoryStorage } from "@/test/offline";
import { displayData, persistScope, previewCurrent, QUERY_CACHE_ACTIVE, QUERY_CACHE_MAX_AGE, QUERY_CACHE_MAX_LINK_PREVIEWS, QUERY_CACHE_MAX_TASKS, startPersistedQueryCache, type PersistedCache } from "./persisted-cache";

const COMPANY = "company-1";
const OTHER = "company-2";
const started: PersistedCache[] = [];
const clients: QueryClient[] = [];

function start(storage = memoryStorage(), options: { buildId?: string; now?: () => number } = {}) {
  const client = new QueryClient();
  clients.push(client);
  const cache = startPersistedQueryCache(client, { buildId: options.buildId ?? "build-1", storage, now: options.now, debounceMs: 60_000, target: null });
  started.push(cache);
  return { client, cache, storage };
}

/**
 * A board signed in as `userId`, with one company. A test with its own `now` passes it as
 * `updatedAt`: read at the real time, these reads could land a millisecond after that `now`, look
 * as if they came from the future, and be left out of the save, taking the company record with them.
 */
function signIn(client: QueryClient, userId: string, updatedAt?: number) {
  const at = updatedAt === undefined ? undefined : { updatedAt };
  client.setQueryData(["health"], { status: "ok", deploymentMode: "authenticated" }, at);
  client.setQueryData(["auth", "session"], { session: { id: "s1", token: "secret" }, user: { id: userId, name: "Ada", email: "ada@example.com" } }, at);
  client.setQueryData(["companies", "list", userId], [{ id: COMPANY, name: "Test" }], at);
}

afterEach(() => {
  for (const cache of started.splice(0)) cache.dispose();
  for (const client of clients.splice(0)) client.clear();
});

describe("persistScope", () => {
  const companies = [COMPANY];

  it("keeps the shell's reads in the user's record and company reads in the company's", () => {
    expect(persistScope(["health"], {}, "u1", companies)).toBeNull();
    expect(persistScope(["companies", "list", "u1"], [], "u1", companies)).toBeNull();
    expect(persistScope(["agents", COMPANY], [], "u1", companies)).toBe(COMPANY);
    expect(persistScope(["issues", COMPANY, "view", "__all__", "__all__"], [], "u1", companies)).toBe(COMPANY);
    expect(persistScope(["issues", "detail", "t1"], { companyId: COMPANY }, "u1", companies)).toBe(COMPANY);
  });

  it("keeps the nav's order and your stars, so a reload doesn't reshuffle the nav", () => {
    expect(persistScope(["sidebar-preferences", "company-order", "u1"], { orderedIds: [] }, "u1", companies)).toBeNull();
    expect(persistScope(["sidebar-preferences", "project-order", COMPANY, "u1"], { orderedIds: [] }, "u1", companies)).toBe(COMPANY);
    expect(persistScope(["resource-memberships", COMPANY, "me"], { starredProjectIds: [] }, "u1", companies)).toBe(COMPANY);
    expect(persistScope(["sidebar-preferences", "company-order", "u2"], { orderedIds: [] }, "u1", companies)).toBeUndefined();
    expect(persistScope(["sidebar-preferences", "project-order", COMPANY, "u2"], { orderedIds: [] }, "u1", companies)).toBeUndefined();
    expect(persistScope(["sidebar-preferences", "project-order", OTHER, "u1"], { orderedIds: [] }, "u1", companies)).toBeUndefined();
    expect(persistScope(["resource-memberships", OTHER, "me"], {}, "u1", companies)).toBeUndefined();
  });

  it("keeps nothing else, and nothing of another user or company", () => {
    expect(persistScope(["issues", "comments", "t1"], [], "u1", companies)).toBeUndefined();
    expect(persistScope(["issues", "documents", "t1"], [], "u1", companies)).toBeUndefined();
    expect(persistScope(["auth", "session"], { user: { id: "u2" } }, "u1", companies)).toBeUndefined();
    expect(persistScope(["companies", "list", "u2"], [], "u1", companies)).toBeUndefined();
    expect(persistScope(["agents", OTHER], [], "u1", companies)).toBeUndefined();
    expect(persistScope(["issues", "detail", "t1"], { companyId: OTHER }, "u1", companies)).toBeUndefined();
  });
});

describe("displayData", () => {
  it("strips what could hold someone's words, secrets or credentials", () => {
    const agent = { id: "a1", name: "Bob", adapterConfig: { model: "opus", apiKey: "sk", env: { TOKEN: "x" } }, runtimeConfig: { secret: 1 }, accessToken: "t" };
    expect(displayData([agent])).toEqual([{ id: "a1", name: "Bob", adapterConfig: { model: "opus" }, runtimeConfig: {} }]);
    expect(displayData({ id: "t1", title: "Task", planDocument: { body: "plan" }, comments: [] })).toEqual({ id: "t1", title: "Task" });
  });
});

describe("startPersistedQueryCache", () => {
  it("restores the allowlisted reads after a reload, stale so they refetch", () => {
    const first = start();
    signIn(first.client, "u1");
    first.client.setQueryData(["agents", COMPANY], [{ id: "a1", name: "Bob" }]);
    first.client.setQueryData(["issues", "detail", "t1"], { id: "t1", companyId: COMPANY, title: "Saved task" });
    first.client.setQueryData(["issues", "comments", "t1"], [{ body: "private" }]);
    first.cache.flush();

    const second = start(first.storage);
    expect(second.client.getQueryData(["agents", COMPANY])).toEqual([{ id: "a1", name: "Bob" }]);
    expect(second.client.getQueryData(["issues", "detail", "t1"])).toMatchObject({ title: "Saved task" });
    expect(second.client.getQueryData(["issues", "comments", "t1"])).toBeUndefined();
    expect(second.client.getQueryState(["agents", COMPANY])?.isInvalidated).toBe(true);
    // Only who you are survives from the session.
    expect(second.client.getQueryData(["auth", "session"])).toEqual({ session: { id: "s1", userId: "u1" }, user: { id: "u1", name: "Ada", email: "ada@example.com", image: null } });
  });

  it("keeps records per user: a reload restores only the last user's, and a new user replaces them", () => {
    const first = start();
    signIn(first.client, "u1");
    first.client.setQueryData(["agents", COMPANY], [{ id: "a1" }], { updatedAt: Date.now() - 1_000 });
    first.client.setQueryData(["issues", COMPANY, "inbox", "mine"], [{ id: "t1" }], { updatedAt: Date.now() - 1_000 });
    first.cache.flush();
    expect([...first.storage.data.keys()].filter((key) => key.includes(":u1:")).length).toBe(2);

    const second = start(first.storage);
    signIn(second.client, "u2");
    second.cache.flush();
    expect(first.storage.getItem(QUERY_CACHE_ACTIVE)).toBe("u2");
    expect([...first.storage.data.keys()].some((key) => key.includes(":u1:"))).toBe(false);

    // u1's reads, restored into memory before u2 signed in, weren't saved as u2's.
    const third = start(first.storage);
    expect(third.client.getQueryData(["agents", COMPANY])).toBeUndefined();
    expect(third.client.getQueryData(["issues", COMPANY, "inbox", "mine"])).toBeUndefined();
    expect(third.client.getQueryData(["companies", "list", "u2"])).toEqual([{ id: COMPANY, name: "Test" }]);
  });

  it("uses local-board without sign-in", () => {
    const first = start();
    first.client.setQueryData(["health"], { status: "ok", deploymentMode: "local_trusted" });
    first.client.setQueryData(["companies", "list", "anonymous"], [{ id: COMPANY }]);
    first.client.setQueryData(["projects", COMPANY, "list"], [{ id: "p1" }]);
    first.cache.flush();
    expect(first.storage.getItem(QUERY_CACHE_ACTIVE)).toBe("local-board");
    expect(start(first.storage).client.getQueryData(["projects", COMPANY, "list"])).toEqual([{ id: "p1" }]);
  });

  it("drops records from another build", () => {
    const first = start();
    signIn(first.client, "u1");
    first.cache.flush();
    const second = start(first.storage, { buildId: "build-2" });
    expect(second.client.getQueryData(["companies", "list", "u1"])).toBeUndefined();
    expect(first.storage.data.size).toBe(0);
  });

  it("keeps reads for 24 hours", () => {
    let time = 1_000_000;
    const first = start(memoryStorage(), { now: () => time });
    signIn(first.client, "u1");
    first.client.setQueryData(["agents", COMPANY], [{ id: "a1" }], { updatedAt: time });
    first.client.setQueryData(["health"], { status: "ok", deploymentMode: "authenticated" }, { updatedAt: time });
    first.client.setQueryData(["auth", "session"], { session: { id: "s1" }, user: { id: "u1" } }, { updatedAt: time });
    first.client.setQueryData(["companies", "list", "u1"], [{ id: COMPANY }], { updatedAt: time });
    first.cache.flush();

    time += QUERY_CACHE_MAX_AGE - 1;
    expect(start(first.storage, { now: () => time }).client.getQueryData(["agents", COMPANY])).toEqual([{ id: "a1" }]);
    time += 2;
    expect(start(first.storage, { now: () => time }).client.getQueryData(["agents", COMPANY])).toBeUndefined();
  });

  it("clears the user's records on sign-out and when the server ends the session", () => {
    const first = start();
    signIn(first.client, "u1");
    first.cache.flush();
    expect(first.storage.data.size).toBeGreaterThan(0);
    first.client.setQueryData(["auth", "session"], null);
    expect(first.storage.data.size).toBe(0);

    const second = start();
    signIn(second.client, "u1");
    second.cache.flush();
    second.cache.clear();
    expect(second.storage.data.size).toBe(0);
  });

  it("keeps the tasks opened last, up to the limit", () => {
    const first = start();
    signIn(first.client, "u1");
    for (let index = 0; index < QUERY_CACHE_MAX_TASKS + 5; index += 1) {
      first.client.setQueryData(["issues", "detail", `t${index}`], { id: `t${index}`, companyId: COMPANY }, { updatedAt: Date.now() - 1_000 + index });
    }
    first.cache.flush();
    const second = start(first.storage);
    const kept = second.client.getQueryCache().findAll({ queryKey: ["issues", "detail"] });
    expect(kept).toHaveLength(QUERY_CACHE_MAX_TASKS);
    expect(second.client.getQueryData(["issues", "detail", "t0"])).toBeUndefined();
    expect(second.client.getQueryData(["issues", "detail", `t${QUERY_CACHE_MAX_TASKS + 4}`])).toBeDefined();
  });
});

describe("pull request previews (U113, #20654)", () => {
  const PR = "https://github.com/acme/app/pull/12";
  const key = (userId: string | null, url = PR, company = COMPANY) => ["link-preview", company, userId, url];
  const found = (maxAgeMs = 300_000) => ({
    preview: { target: { provider: "github", kind: "pull_request", canonicalUrl: PR, label: "acme/app#12" }, title: "Fix the build", state: "merged", author: "octocat", updatedAt: null },
    maxAgeMs,
  });

  it("are kept per viewer, in their company's record", () => {
    expect(persistScope(key("u1"), found(), "u1", [COMPANY])).toBe(COMPANY);
    expect(persistScope(key("u2"), found(), "u1", [COMPANY])).toBeUndefined();
    expect(persistScope(key(null), found(), "u1", [COMPANY])).toBeUndefined();
    expect(persistScope(key("u1", PR, OTHER), found(), "u1", [COMPANY])).toBeUndefined();
    expect(persistScope(["link-preview", COMPANY, "u1"], found(), "u1", [COMPANY])).toBeUndefined();
  });

  it("count as current only within their maxAgeMs, and only when GitHub described the link", () => {
    expect(previewCurrent(found(1_000), 5_000, 5_999)).toBe(true);
    expect(previewCurrent(found(1_000), 5_000, 6_000)).toBe(false);
    expect(previewCurrent(found(1_000), 5_000, 4_000)).toBe(false);
    expect(previewCurrent({ preview: null, maxAgeMs: 60_000 }, 5_000, 5_001)).toBe(false);
    expect(previewCurrent({ preview: found().preview }, 5_000, 5_001)).toBe(false);
  });

  it("survive a reload without refetching, and an expired one isn't restored", () => {
    const base = 1_800_000_000_000;
    let time = base;
    const first = start(memoryStorage(), { now: () => time });
    signIn(first.client, "u1", time);
    first.client.setQueryData(key("u1"), found(300_000), { updatedAt: time });
    first.client.setQueryData(key("u1", "https://github.com/acme/app/pull/13"), found(60_000), { updatedAt: time });
    first.cache.flush();

    time += 59_999;
    const second = start(first.storage, { now: () => time });
    expect(second.client.getQueryData(key("u1"))).toMatchObject({ preview: { title: "Fix the build", state: "merged" }, maxAgeMs: 300_000 });
    expect(second.client.getQueryState(key("u1"))).toMatchObject({ isInvalidated: false, dataUpdatedAt: base });
    expect(second.client.getQueryData(key("u1", "https://github.com/acme/app/pull/13"))).toBeDefined();

    time += 1;
    const third = start(first.storage, { now: () => time });
    expect(third.client.getQueryData(key("u1"))).toBeDefined();
    expect(third.client.getQueryData(key("u1", "https://github.com/acme/app/pull/13"))).toBeUndefined();
    time += 240_000;
    expect(start(first.storage, { now: () => time }).client.getQueryData(key("u1"))).toBeUndefined();
  });

  it("leaves out the 60-second 'no preview', another viewer's, and expired ones at save", () => {
    const base = 1_800_000_000_000;
    let time = base;
    const first = start(memoryStorage(), { now: () => time });
    signIn(first.client, "u1", time);
    first.client.setQueryData(key("u1"), { preview: null, maxAgeMs: 60_000 }, { updatedAt: time });
    first.client.setQueryData(key("u2", "https://github.com/acme/app/pull/2"), found(), { updatedAt: time });
    first.client.setQueryData(key("u1", "https://github.com/acme/app/pull/3"), found(1_000), { updatedAt: time - 1_000 });
    first.cache.flush();
    const saved = [...first.storage.data.values()].join("");
    expect(saved).not.toContain("link-preview");
  });

  it("keeps the ones learned last, up to the limit", () => {
    const first = start();
    signIn(first.client, "u1");
    for (let index = 0; index < QUERY_CACHE_MAX_LINK_PREVIEWS + 3; index += 1) {
      first.client.setQueryData(key("u1", `https://github.com/acme/app/pull/${index + 1}`), found(), { updatedAt: Date.now() - 1_000 + index });
    }
    first.cache.flush();
    const second = start(first.storage);
    expect(second.client.getQueryCache().findAll({ queryKey: ["link-preview"] })).toHaveLength(QUERY_CACHE_MAX_LINK_PREVIEWS);
    expect(second.client.getQueryData(key("u1", "https://github.com/acme/app/pull/1"))).toBeUndefined();
    expect(second.client.getQueryData(key("u1", `https://github.com/acme/app/pull/${QUERY_CACHE_MAX_LINK_PREVIEWS + 3}`))).toBeDefined();
  });
});
