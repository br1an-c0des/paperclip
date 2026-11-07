import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, write } from "@/test/offline";
import type { Connectivity } from "./connectivity";
import { createWriteQueue, MAX_ONLINE_ATTEMPTS, type WriteQueueOptions } from "./write-runner";
import { readWrites, type WriteRequest } from "./write-queue";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const receipt = (request: WriteRequest) => ({ id: "22222222-2222-4222-8222-222222222222", issueId: ISSUE, body: String(request.body.body) });
const outage = () => Object.assign(new Error("Request failed: 503"), { status: 503 });

function setup(options: Partial<WriteQueueOptions> = {}) {
  const [status, setStatus] = createSignal<Connectivity>("online");
  const recovered = new Set<() => void>();
  const connectivity = {
    status,
    reportFailure: vi.fn(),
    onRecovered: (listener: () => void) => {
      recovered.add(listener);
      return () => recovered.delete(listener);
    },
  };
  const sent: WriteRequest[] = [];
  const send = vi.fn(async (request: WriteRequest) => {
    sent.push(request);
    return receipt(request);
  });
  const storage = memoryStorage();
  const queue = createWriteQueue({
    storage,
    transport: { send, get: vi.fn(async () => []) },
    connectivity,
    lock: (_name, run) => run(),
    target: null,
    ...options,
  });
  const goOnline = () => {
    setStatus("online");
    for (const listener of [...recovered]) listener();
  };
  return { queue, storage, send, sent, setStatus, goOnline, connectivity };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const comment = (text: string, createdAt: number) =>
  write({ createdAt, request: { method: "POST", path: `/issues/${ISSUE}/comments`, body: { body: text, clientRequestId: `key-${text}` } }, idempotencyKey: `key-${text}` });

afterEach(() => {
  vi.useRealTimers();
});

describe("createWriteQueue", () => {
  it("waits while offline, then sends everything once, in order, when it's back", async () => {
    vi.useFakeTimers();
    const { queue, storage, sent, setStatus, goOnline } = setup();
    queue.setUser("user-1", true);
    setStatus("offline");
    queue.add(comment("second", 2));
    queue.add(comment("first", 1));
    await flush();
    expect(sent).toEqual([]);
    expect(readWrites(storage, "user-1")).toHaveLength(2);

    goOnline();
    await flush();
    expect(sent.map((request) => request.body.body)).toEqual(["first", "second"]);
    expect(queue.writes()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it("sends only for the signed-in user, once the session is checked", async () => {
    vi.useFakeTimers();
    const { queue, storage, sent } = setup();
    storage.setItem(`paperclip.ui-new.writes.v1:user-2:company-1`, JSON.stringify([write({ userId: "user-2" })]));
    queue.setUser("user-1", false);
    queue.add(comment("mine", 1));
    await flush();
    expect(sent).toEqual([]);
    expect(queue.writes().map((row) => row.userId)).toEqual(["user-1"]);

    queue.setUser("user-1", true);
    await flush();
    expect(sent).toHaveLength(1);
    expect(readWrites(storage, "user-2")).toHaveLength(1);
  });

  it("queues a send that hits an outage, keeping its key, and resends it with backoff", async () => {
    vi.useFakeTimers();
    const { queue, send, sent, connectivity } = setup();
    send.mockRejectedValueOnce(outage());
    queue.setUser("user-1", true);
    const row = comment("hello", 1);
    const direct = vi.fn(async () => Promise.reject(outage()));
    const result = await queue.sendOrQueue(row, direct);
    expect(result.queued).toBe(true);
    expect(connectivity.reportFailure).toHaveBeenCalled();
    await flush();
    // The resend after the first outage failed too: it waits, unknown, for the backoff.
    expect(queue.writes()[0]).toMatchObject({ status: "queued", uncertain: true, idempotencyKey: row.idempotencyKey });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(queue.writes()).toEqual([]);
    expect(sent.every((request) => request.body.clientRequestId === row.request.body.clientRequestId)).toBe(true);
  });

  it("throws a refusal back to the screen without queueing it", async () => {
    const { queue } = setup();
    queue.setUser("user-1", true);
    const refusal = Object.assign(new Error("Comments are closed"), { status: 422 });
    await expect(queue.sendOrQueue(comment("no", 1), async () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(queue.writes()).toEqual([]);
  });

  it("queues straight away while offline, without trying", async () => {
    const { queue, setStatus } = setup();
    queue.setUser("user-1", true);
    setStatus("offline");
    const direct = vi.fn(async () => "sent");
    expect((await queue.sendOrQueue(comment("later", 1), direct)).queued).toBe(true);
    expect(direct).not.toHaveBeenCalled();
  });

  it("marks a refused write failed, keeps the rest moving, and Retry sends it", async () => {
    vi.useFakeTimers();
    const onFailed = vi.fn();
    const { queue, send, sent } = setup({ onFailed });
    send.mockRejectedValueOnce(Object.assign(new Error("Comments are closed"), { status: 422 }));
    queue.setUser("user-1", true);
    queue.add(comment("refused", 1));
    queue.add(comment("next", 2));
    await flush();
    expect(queue.writes()).toMatchObject([{ status: "failed", error: "Comments are closed" }]);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([request]) => request.body.body)).toEqual(["refused", "next"]);

    queue.retry(queue.writes()[0]!.id);
    await flush();
    expect(queue.writes()).toEqual([]);
    expect(sent.map((request) => request.body.body)).toEqual(["next", "refused"]);
  });

  it("discards a failed write", async () => {
    vi.useFakeTimers();
    const { queue, send, storage } = setup();
    send.mockRejectedValueOnce(Object.assign(new Error("no"), { status: 422 }));
    queue.setUser("user-1", true);
    queue.add(comment("refused", 1));
    await flush();
    queue.discard(queue.writes()[0]!.id);
    expect(queue.writes()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it("stops after repeated failures while online and leaves Retry to the person", async () => {
    vi.useFakeTimers();
    const { queue, send } = setup();
    send.mockRejectedValue(Object.assign(new Error("busy"), { status: 429 }));
    queue.setUser("user-1", true);
    queue.add(comment("stuck", 1));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(MAX_ONLINE_ATTEMPTS);
    expect(queue.writes()[0]).toMatchObject({ status: "failed", uncertain: true, attempts: MAX_ONLINE_ATTEMPTS });
  });

  it("waits for what shows it to refresh before dropping a landed write", async () => {
    vi.useFakeTimers();
    let finish = () => {};
    const onLanded = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { queue } = setup({ onLanded });
    queue.setUser("user-1", true);
    queue.add(comment("shown", 1));
    await flush();
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(queue.writes()).toHaveLength(1);
    finish();
    await flush();
    expect(queue.writes()).toEqual([]);
  });

  it("keeps writes in memory when storage refuses them", async () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const { queue, setStatus } = setup({ storage });
    queue.setUser("user-1", true);
    setStatus("offline");
    queue.add(comment("held", 1));
    expect(queue.writes()).toHaveLength(1);
    expect(queue.unsaved()).toBe(true);
  });
});
