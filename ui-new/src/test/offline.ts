import type { QueuedWrite, WriteStorage } from "@/lib/offline/write-queue";

/* Helpers for the offline tests (lib/offline): storage held in a map, and a queued write to vary. */

export function memoryStorage(): WriteStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

let seq = 0;
export function write(fields: Partial<QueuedWrite> = {}): QueuedWrite {
  seq += 1;
  return {
    id: `w${seq}`,
    userId: "user-1",
    companyId: "company-1",
    kind: "comment",
    target: "issue:i1",
    label: "Comment on TES-1",
    request: { method: "POST", path: "/issues/i1/comments", body: { body: "hi", clientRequestId: `c${seq}` } },
    idempotencyKey: `c${seq}`,
    recovery: { kind: "resend" },
    refresh: [],
    status: "queued",
    uncertain: false,
    attempts: 0,
    error: null,
    createdAt: seq,
    updatedAt: seq,
    ...fields,
  };
}

