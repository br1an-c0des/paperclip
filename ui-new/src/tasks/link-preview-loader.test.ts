import { recognizeLinkPreview, type LinkPreviewBatchResult, type LinkPreviewResult, type LinkPreviewTarget } from "@paperclipai/shared";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLinkPreviewPageLoader,
  linkPreviewQueryOptions,
  MAX_PAGE_LINK_PREVIEWS,
  retryAfterOf,
  type LinkPreviewPageEnvironment,
  type LinkPreviewSource,
} from "./link-preview-loader";

// After the old UI's lib/link-preview-page-loader.test.ts (upstream #21746), plus the 429 wait.

const target = recognizeLinkPreview("https://github.com/acme/web/pull/42")!;
const result: LinkPreviewResult = { preview: { target, title: "Saved status", state: "merged", author: null, updatedAt: null }, maxAgeMs: 60_000 };
const rateLimited = (retryAfterMs: number) => Object.assign(new Error("Link preview rate limit exceeded"), { status: 429, retryAfterMs });

const disposers: Array<() => void> = [];

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let loaded = false;
  let onLoad = () => {};
  const idle = new Set<() => void>();
  const environment: LinkPreviewPageEnvironment = {
    loaded: () => loaded,
    onLoad: (callback) => {
      onLoad = callback;
      return () => (onLoad = () => {});
    },
    idle: (callback) => {
      idle.add(callback);
      return () => idle.delete(callback);
    },
    later: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  };
  const source = {
    companyId: "company-a",
    userId: "alice",
    pausedUntil: 0,
    load: vi.fn(async (_target: LinkPreviewTarget): Promise<LinkPreviewResult> => result),
    readCached: vi.fn(async (_targets: LinkPreviewTarget[]): Promise<LinkPreviewBatchResult> => ({ results: {} })),
  } satisfies LinkPreviewSource;
  const loader = createLinkPreviewPageLoader(client, source, environment);
  disposers.push(() => {
    loader.dispose();
    client.clear();
  });
  const key = (of = target) => linkPreviewQueryOptions(client, source, of).queryKey;
  return {
    client,
    source,
    loader,
    idle,
    key,
    data: (of = target) => client.getQueryData<LinkPreviewResult>(key(of)),
    loaded() {
      loaded = true;
      onLoad();
    },
    runIdle() {
      const callbacks = [...idle];
      idle.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(1);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

describe("pull request status on page load (U175)", () => {
  it("reads every copy of a link's saved status in one request, then reuses a current one without asking GitHub", async () => {
    const f = fixture();
    f.source.readCached.mockResolvedValue({ results: { [target.canonicalUrl]: result } });
    for (let i = 0; i < 500; i++) f.loader.register(target);
    expect(f.source.readCached).not.toHaveBeenCalled();
    await settle();
    expect(f.source.readCached).toHaveBeenCalledExactlyOnceWith([target]);
    expect(f.data()).toEqual(result);
    expect(f.idle.size).toBe(0);
    f.loaded();
    f.runIdle();
    await settle();
    expect(f.source.load).not.toHaveBeenCalled();
  });

  it("skips the saved-status read for a link already cached (a reload's restored preview)", async () => {
    const f = fixture();
    f.client.setQueryData(f.key(), result);
    f.loader.register(target);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.readCached).not.toHaveBeenCalled();
    expect(f.source.load).not.toHaveBeenCalled();
  });

  it("refreshes on idle only after load and the page's own reads, once per mount", async () => {
    const f = fixture();
    let finish!: (value: number) => void;
    const core = f.client.fetchQuery({ queryKey: ["issues", "detail", "42"], queryFn: () => new Promise<number>((done) => (finish = done)) });
    f.loader.register(target);
    await settle();
    expect(f.idle.size).toBe(0); // not loaded yet
    f.loaded();
    await settle();
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.idle.size).toBe(0); // the task is still loading
    finish(1);
    await core;
    expect(f.idle.size).toBe(1);
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
    expect(f.data()).toEqual(result);
    await vi.advanceTimersByTimeAsync(120_000);
    f.loaded();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
  });

  it("shows a stale saved status at once, and shares one request between a hover and the refresh", async () => {
    const f = fixture();
    f.source.readCached.mockResolvedValue({ results: { [target.canonicalUrl]: { ...result, maxAgeMs: 0 } } });
    let finish!: (value: LinkPreviewResult) => void;
    f.source.load.mockImplementation(() => new Promise((done) => (finish = done)));
    f.loader.register(target);
    f.loaded();
    await settle();
    expect(f.data()?.preview?.state).toBe("merged");
    const hover = f.client.fetchQuery(linkPreviewQueryOptions(f.client, f.source, target));
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
    finish({ ...result, preview: { ...result.preview!, state: "open" } });
    await hover;
    await settle();
    expect(f.data()?.preview?.state).toBe("open");
    expect(f.idle.size).toBe(0);
  });

  it("doesn't replace a newer hover answer with a slower saved-status read", async () => {
    const f = fixture();
    let finish!: (value: LinkPreviewBatchResult) => void;
    f.source.readCached.mockImplementation(() => new Promise((done) => (finish = done)));
    f.loader.register(target);
    await settle();
    await f.client.fetchQuery(linkPreviewQueryOptions(f.client, f.source, target));
    finish({ results: { [target.canonicalUrl]: { ...result, preview: { ...result.preview!, state: "open" }, maxAgeMs: 0 } } });
    await settle();
    expect(f.data()?.preview?.state).toBe("merged");
  });

  it("tracks at most 200 links, reads saved status in batches of 50, and refreshes three at a time", async () => {
    const f = fixture();
    f.source.load.mockImplementation(() => new Promise(() => {}));
    for (let i = 0; i < 1000; i++) f.loader.register(recognizeLinkPreview(`${target.canonicalUrl}${i}`)!);
    await vi.advanceTimersByTimeAsync(10);
    const asked = f.source.readCached.mock.calls.map(([targets]) => targets);
    expect(asked.flat()).toHaveLength(MAX_PAGE_LINK_PREVIEWS);
    expect(asked.every((targets) => targets.length <= 50)).toBe(true);
    expect(asked).toHaveLength(4);
    f.loaded();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(3);
    expect(f.idle.size).toBe(0);
  });

  it("refreshes the next links as earlier ones finish, never more than three at once", async () => {
    const f = fixture();
    const finishers: Array<() => void> = [];
    f.source.load.mockImplementation(() => new Promise((done) => finishers.push(() => done(result))));
    for (let i = 1; i <= 5; i++) f.loader.register(recognizeLinkPreview(`https://github.com/acme/web/pull/${i}`)!);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(3);
    finishers.shift()!();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(4);
    finishers.splice(0).forEach((finish) => finish());
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(5);
  });

  it("keeps saved-status batches within a URL budget for long names", async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.loader.register(recognizeLinkPreview(`https://github.com/acme/${"a".repeat(1900)}/pull/${i + 1}`)!);
    await vi.advanceTimersByTimeAsync(100);
    const asked = f.source.readCached.mock.calls.map(([targets]) => targets);
    expect(asked.flat()).toHaveLength(100);
    expect(asked.every((targets) => targets.reduce((size, one) => size + encodeURIComponent(one.canonicalUrl).length + 5, 0) <= 6_000)).toBe(true);
  });

  it("forgets departed links, and ignores a late answer after the loader is gone", async () => {
    const f = fixture();
    const unregister = f.loader.register(target);
    unregister();
    f.loaded();
    await settle();
    f.runIdle();
    expect(f.source.readCached).not.toHaveBeenCalled();
    expect(f.source.load).not.toHaveBeenCalled();
    let finish!: (value: LinkPreviewBatchResult) => void;
    f.source.readCached.mockImplementation(() => new Promise((done) => (finish = done)));
    f.loader.register(target);
    await settle();
    f.loader.dispose();
    finish({ results: { [target.canonicalUrl]: result } });
    await settle();
    expect(f.data()).toBeUndefined();
  });

  it("shares a pending saved-status read when the same link remounts", async () => {
    const f = fixture();
    let finish!: (value: LinkPreviewBatchResult) => void;
    f.source.readCached.mockImplementation(() => new Promise((done) => (finish = done)));
    const unregister = f.loader.register(target);
    await settle();
    unregister();
    f.loader.register(target);
    await settle();
    finish({ results: { [target.canonicalUrl]: result } });
    await settle();
    expect(f.source.readCached).toHaveBeenCalledTimes(1);
    expect(f.data()).toEqual(result);
  });

  it("keeps the last preview when a refresh fails", async () => {
    const f = fixture();
    f.client.setQueryData(f.key(), { ...result, maxAgeMs: 0 });
    f.source.load.mockImplementation(() => Promise.reject(new Error("network unavailable")));
    f.loader.register(target);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
    expect(f.data()?.preview).toEqual(result.preview);
    expect(f.data()?.maxAgeMs).toBe(60_000);
  });

  it("stays quiet when the saved-status read fails, and the refresh still runs", async () => {
    const f = fixture();
    f.source.readCached.mockImplementation(() => Promise.reject(new Error("cache unavailable")));
    f.loader.register(target);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
    expect(f.data()).toEqual(result);
  });

  it("doesn't spend a refresh slot on a link whose status is current", async () => {
    const f = fixture();
    f.source.load.mockImplementation(() => new Promise(() => {}));
    f.client.setQueryData(f.key(), result);
    f.loader.register(target);
    for (let i = 1; i <= 4; i++) f.loader.register(recognizeLinkPreview(`https://github.com/acme/web/pull/${i}`)!);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(3);
    expect(f.source.load.mock.calls.map(([one]) => one.canonicalUrl)).not.toContain(target.canonicalUrl);
  });

  it("doesn't ask for saved status again when a link with none redraws", async () => {
    const f = fixture();
    f.source.load.mockImplementation(() => new Promise(() => {}));
    const unregister = f.loader.register(target);
    await settle();
    expect(f.source.readCached).toHaveBeenCalledTimes(1);
    unregister();
    f.loader.register(target);
    await settle();
    expect(f.source.readCached).toHaveBeenCalledTimes(1);
    // It's still refreshed.
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
  });
});

describe("the rate limit (429, Retry-After)", () => {
  it("reads the wait off the error, a minute without one, and nothing for other failures", () => {
    expect(retryAfterOf(rateLimited(5_000))).toBe(5_000);
    expect(retryAfterOf(Object.assign(new Error("slow down"), { status: 429 }))).toBe(60_000);
    expect(retryAfterOf(Object.assign(new Error("bad gateway"), { status: 502 }))).toBeNull();
    expect(retryAfterOf(new Error("network"))).toBeNull();
  });

  it("pauses the refresh for the wait, keeps the last preview, then picks up with the refused link", async () => {
    const f = fixture();
    const second = recognizeLinkPreview("https://github.com/acme/web/pull/43")!;
    f.client.setQueryData(f.key(), { ...result, maxAgeMs: 0 });
    f.source.load.mockImplementationOnce(() => Promise.reject(rateLimited(30_000)));
    f.loader.register(target);
    f.loaded();
    await settle();
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(1);
    expect(f.data()?.preview).toEqual(result.preview);
    expect(f.source.pausedUntil).toBeGreaterThan(Date.now());

    // A new link during the wait: its saved status is read (that never contacts GitHub), but no refresh.
    f.loader.register(second);
    await settle();
    expect(f.source.readCached).toHaveBeenCalledWith([second]);
    expect(f.idle.size).toBe(0);
    // A hover during the wait doesn't ask either: it gets what's known.
    expect((await f.client.fetchQuery(linkPreviewQueryOptions(f.client, f.source, target))).preview).toEqual(result.preview);
    expect(f.source.load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.idle.size).toBe(1);
    f.runIdle();
    await settle();
    expect(f.source.load.mock.calls.map(([one]) => one.canonicalUrl).sort()).toEqual([target.canonicalUrl, target.canonicalUrl, second.canonicalUrl].sort());
    expect(f.data()).toEqual(result);
  });

  it("holds a hover's read too: a 429 there pauses the page's refresh", async () => {
    const f = fixture();
    f.source.load.mockImplementationOnce(() => Promise.reject(rateLimited(10_000)));
    const answer = await f.client.fetchQuery(linkPreviewQueryOptions(f.client, f.source, target));
    expect(answer).toEqual({ preview: null, maxAgeMs: 10_000 });
    f.loader.register(recognizeLinkPreview("https://github.com/acme/web/pull/7")!);
    f.loaded();
    await settle();
    expect(f.idle.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    f.runIdle();
    await settle();
    expect(f.source.load).toHaveBeenCalledTimes(2);
  });
});
