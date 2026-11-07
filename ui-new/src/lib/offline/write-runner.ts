import { createSignal, type Accessor } from "solid-js";
import type { ConnectivityStore } from "./connectivity";
import { classifySendFailure, describeError } from "./errors";
import { performWrite, type Transport } from "./writes";
import { addWrite, nextWrite, readWrites, removeWrite, updateWrite, type QueuedWrite, type WriteStorage } from "./write-queue";

/*
 * The write queue at runtime: what's waiting for the signed-in user, sending it in order when the
 * connection allows, and Retry and Discard (U13, after useDurableSubmit.ts in #17960).
 *
 * - A screen sends a write itself as it always has, and hands it here only when that fails for a
 *   reason that can pass (`sendOrQueue`), or straight away while the app is offline. Online
 *   behavior, its errors and its conflicts stay the screen's own.
 * - Writes go one at a time, oldest first, and only once the session has been checked with the
 *   server since the page loaded (`ready`): a reload offline shows a saved session, which can't
 *   be trusted to send as that user.
 * - While offline nothing is sent. When the app comes back, sending starts at once. A write that
 *   keeps failing while the app looks online (one route down) is tried with backoff, then marked
 *   failed so its Retry is in the person's hands.
 * - A failed write stays, with its error, until Retry or Discard. Nothing is dropped quietly.
 * - Another tab of the same user can send the same queue; a Web Lock lets one send at a time.
 */

export const RESEND_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000] as const;
/** Tries while the app looks online before a write waits for Retry. Coming back from offline starts over. */
export const MAX_ONLINE_ATTEMPTS = 6;

export type WriteQueue = {
  /** The signed-in user's writes, oldest first. */
  writes: Accessor<QueuedWrite[]>;
  /** Some writes are only in memory: storage refused them. */
  unsaved: Accessor<boolean>;
  /** Whose writes these are: the signed-in user, or `local-board` without sign-in. */
  userId: Accessor<string | null>;
  /** Who's signed in, and whether that's been checked with the server since the page loaded. */
  setUser: (userId: string | null, ready: boolean) => void;
  /** Queues a write; `uncertain` when an attempt may already have reached the server. */
  add: (write: QueuedWrite) => QueuedWrite;
  /**
   * Sends a write the way the screen always has (`direct`), and queues it if that can't reach the
   * server, or right away while offline. A refusal is thrown back to the screen, as before.
   */
  sendOrQueue: <T>(write: QueuedWrite, direct: () => Promise<T>) => Promise<{ queued: false; result: T } | { queued: true; write: QueuedWrite }>;
  retry: (id: string) => void;
  discard: (id: string) => void;
  /** Starts sending, if anything waits and the connection allows. */
  drain: () => void;
  dispose: () => void;
};

export type WriteQueueOptions = {
  storage: WriteStorage | null;
  transport: Transport;
  connectivity: Pick<ConnectivityStore, "status" | "onRecovered" | "reportFailure">;
  /** After a write lands, with the server's answer: refresh what shows it. Resolves once that's done. */
  onLanded?: (write: QueuedWrite, result: unknown) => Promise<void> | void;
  /** After a write fails for good. */
  onFailed?: (write: QueuedWrite) => void;
  now?: () => number;
  lock?: (name: string, run: () => Promise<void>) => Promise<void>;
  target?: Window | null;
};

/** One sender at a time per user across tabs, where the browser has Web Locks. */
function webLock(name: string, run: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return run();
  return locks.request(name, { ifAvailable: true }, async (lock) => {
    if (lock) await run();
  }) as Promise<void>;
}

export function createWriteQueue(options: WriteQueueOptions): WriteQueue {
  const now = options.now ?? Date.now;
  const lock = options.lock ?? webLock;
  const storage = options.storage;
  const target = options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
  let userId: string | null = null;
  let ready = false;
  let draining = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const inFlight = new Set<string>();
  // Writes storage refused, kept for as long as the tab is open.
  let memory: QueuedWrite[] = [];

  const [writes, setWrites] = createSignal<QueuedWrite[]>([]);
  const [unsaved, setUnsaved] = createSignal(false);
  const [currentUser, setCurrentUser] = createSignal<string | null>(null);

  const refresh = () => {
    if (!userId) {
      setWrites([]);
      setUnsaved(false);
      return;
    }
    const stored = storage ? readWrites(storage, userId) : [];
    const mine = memory.filter((row) => row.userId === userId);
    setWrites([...stored, ...mine].sort((a, b) => a.createdAt - b.createdAt));
    setUnsaved(mine.length > 0);
  };

  const inMemory = (id: string) => memory.some((row) => row.id === id);
  const save = (write: QueuedWrite) => {
    const next = { ...write, updatedAt: now() };
    if (inMemory(next.id)) memory = memory.map((row) => (row.id === next.id ? next : row));
    else if (!storage || !updateWrite(storage, next)) {
      // Gone from storage (discarded in another tab), or storage refused the update.
      if (storage && !readWrites(storage, next.userId).some((row) => row.id === next.id)) return refresh();
      memory = [...memory.filter((row) => row.id !== next.id), next];
    }
    refresh();
  };
  const drop = (write: QueuedWrite) => {
    memory = memory.filter((row) => row.id !== write.id);
    if (storage) removeWrite(storage, write);
    refresh();
  };
  const find = (id: string) => writes().find((row) => row.id === id);

  const schedule = (attempts: number) => {
    if (timer !== undefined) clearTimeout(timer);
    const delay = RESEND_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RESEND_BACKOFF_MS.length - 1)]!;
    timer = setTimeout(() => {
      timer = undefined;
      drain();
    }, delay);
  };

  const sendNext = async (): Promise<"more" | "stop"> => {
    if (!userId || !ready || options.connectivity.status() === "offline") return "stop";
    const next = nextWrite(writes(), inFlight);
    if (!next) return "stop";
    const owner = userId;
    inFlight.add(next.id);
    save({ ...next, status: "sending" });
    const outcome = await performWrite(next, options.transport);
    if (outcome.kind === "done") {
      try {
        await options.onLanded?.(next, outcome.result);
      } finally {
        inFlight.delete(next.id);
        drop(next);
      }
      return "more";
    }
    inFlight.delete(next.id);
    if (!find(next.id) || owner !== userId) return "more";
    if (outcome.kind === "failed") {
      const failed: QueuedWrite = { ...next, status: "failed", error: outcome.message, settled: outcome.settled };
      save(failed);
      options.onFailed?.(failed);
      return "more";
    }
    options.connectivity.reportFailure(outcome.error);
    const attempts = next.attempts + 1;
    const error = describeError(outcome.error);
    if (options.connectivity.status() !== "offline" && attempts >= MAX_ONLINE_ATTEMPTS) {
      const failed: QueuedWrite = { ...next, status: "failed", uncertain: true, attempts, error: "Paperclip didn't take this after several tries.", settled: false };
      save(failed);
      options.onFailed?.(failed);
      return "more";
    }
    save({ ...next, status: "queued", uncertain: true, attempts, error });
    if (options.connectivity.status() !== "offline") schedule(attempts);
    return "stop";
  };

  const drain = () => {
    if (disposed || !userId || !ready) return;
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    void lock(`paperclip.ui-new.writes:${userId}`, async () => {
      refresh();
      while ((await sendNext()) === "more") {
        // One at a time, oldest first.
      }
    })
      .catch(() => {})
      .finally(() => {
        draining = false;
        if (again) {
          again = false;
          drain();
        }
      });
  };

  const add = (write: QueuedWrite): QueuedWrite => {
    const stored = storage ? addWrite(storage, write) : { write, stored: false };
    if (!stored.stored) memory = [...memory.filter((row) => row.id !== stored.write.id), stored.write];
    refresh();
    drain();
    return stored.write;
  };

  const offRecovered = options.connectivity.onRecovered(() => {
    // Back from an outage: every waiting write gets a fresh round of tries.
    for (const row of writes()) if (row.status === "queued" && row.attempts > 0) save({ ...row, attempts: 0 });
    drain();
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key && !event.key.startsWith("paperclip.ui-new.writes.")) return;
    refresh();
    drain();
  };
  target?.addEventListener("storage", onStorage);

  return {
    writes,
    unsaved,
    userId: currentUser,
    setUser: (next, nextReady) => {
      const changed = next !== userId;
      userId = next;
      setCurrentUser(next);
      ready = nextReady;
      if (changed) refresh();
      drain();
    },
    add,
    sendOrQueue: async (write, direct) => {
      if (options.connectivity.status() === "offline") return { queued: true, write: add({ ...write, uncertain: false }) };
      try {
        return { queued: false, result: await direct() };
      } catch (error) {
        if (classifySendFailure(error) !== "pending") throw error;
        options.connectivity.reportFailure(error);
        return { queued: true, write: add({ ...write, uncertain: true, attempts: 1, error: describeError(error) }) };
      }
    },
    retry: (id) => {
      const row = find(id);
      if (!row || inFlight.has(id)) return;
      save({ ...row, status: "queued", attempts: 0, error: null, settled: false });
      drain();
    },
    discard: (id) => {
      const row = find(id);
      if (!row || inFlight.has(id)) return;
      drop(row);
    },
    drain,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      offRecovered();
      target?.removeEventListener("storage", onStorage);
    },
  };
}
