import { useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { createContext, createEffect, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js";
import { api } from "@/api/client";
import { casesApi } from "@/api/cases";
import { randomId } from "@/lib/random-id";
import { pushToast } from "@/ui/Toast";
import { connectivity } from "./connectivity";
import { describeError } from "./errors";
import { createWriteQueue, type WriteQueue } from "./write-runner";
import { rebaseDocumentSaves, type QueuedWrite, type WriteRequest } from "./write-queue";

/*
 * The write queue for the signed-in user, inside the session gate (U13). One queue per page; it
 * sends as the user the session gate has checked with the server since the page loaded.
 *
 * When a queued write lands, what shows it is refreshed before its pending copy goes, so a comment
 * doesn't blink out of the thread between the two. A new task says so in a toast with a link.
 */

const ISSUE_PATH = (prefix: string | undefined, identifier: string | null | undefined, id: string) =>
  prefix && identifier ? `/${prefix}/issues/${identifier}` : `/issues/${identifier ?? id}`;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const transport = {
  send: (request: WriteRequest) =>
    request.method === "POST"
      ? api.post(request.path, request.body)
      : request.method === "PUT"
        ? api.put(request.path, request.body)
        : api.patch(request.path, request.body),
  get: (path: string) => api.get(path),
};

/** Refreshes what shows a landed write, waiting a few seconds at most. */
async function refreshAfter(client: QueryClient, write: QueuedWrite, result: unknown) {
  if (write.store && result && typeof result === "object") client.setQueryData(write.store, result);
  const refreshes = write.refresh.map((queryKey) => client.invalidateQueries({ queryKey }));
  await Promise.race([Promise.allSettled(refreshes), new Promise((resolve) => setTimeout(resolve, 4_000))]);
}

function onLanded(client: QueryClient, write: QueuedWrite, result: unknown, storage: Storage | null) {
  const row = (result ?? {}) as Record<string, unknown>;
  if (write.kind === "document" && storage) rebaseDocumentSaves(storage, write, typeof row.latestRevisionId === "string" ? row.latestRevisionId : null);
  if (write.kind === "task" && typeof row.id === "string") {
    const ref = typeof row.identifier === "string" ? row.identifier : "the task";
    const prefix = write.after?.issuePrefix;
    pushToast({
      tone: "success",
      title: `Created ${ref}`,
      body: typeof row.title === "string" ? `Saved while offline: ${row.title}` : undefined,
      action: { label: `Open ${ref}`, href: ISSUE_PATH(prefix, row.identifier as string | null, row.id) },
    });
    const link = write.after?.caseLink;
    if (link) {
      void casesApi
        .link(link.caseId, row.id, link.role as Parameters<typeof casesApi.link>[2])
        .then(() => client.invalidateQueries({ queryKey: ["cases", write.companyId] }))
        .catch((error: unknown) => pushToast({ tone: "warn", title: `Created ${ref}, but couldn't add it to the case`, body: describeError(error) }));
    }
  }
  return refreshAfter(client, write, result);
}

const QueueContext = createContext<WriteQueue>();

export function WriteQueueProvider(props: ParentProps<{ userId: Accessor<string | null>; verified: Accessor<boolean> }>) {
  const client = useQueryClient();
  const storage = browserStorage();
  const queue = createWriteQueue({
    storage,
    transport,
    connectivity,
    onLanded: (write, result) => onLanded(client, write, result, storage),
    // A write that failed for good: what showed it as done (a document's offline edit) goes back
    // to what the server has.
    onFailed: (write) => {
      for (const queryKey of [...write.refresh, ...(write.store ? [write.store] : [])]) void client.invalidateQueries({ queryKey });
    },
  });
  createEffect(() => queue.setUser(props.userId(), props.verified()));
  onCleanup(() => queue.dispose());
  return <QueueContext.Provider value={queue}>{props.children}</QueueContext.Provider>;
}

export function useWriteQueue() {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useWriteQueue must be used inside <WriteQueueProvider>");
  return queue;
}

/** The queue, or null outside the session gate (a component rendered on its own in a test). */
export function useOptionalWriteQueue() {
  return useContext(QueueContext) ?? null;
}

/**
 * A screen's write: sent as before (`direct`), or, when it can't reach the server, kept in the
 * queue as `build` describes it. Without a queue (outside the session gate) it's just `direct`.
 */
export async function sendOrQueue<T>(
  queue: WriteQueue | null,
  build: (userId: string) => QueuedWrite,
  direct: () => Promise<T>,
): Promise<{ queued: false; result: T } | { queued: true; write: QueuedWrite }> {
  const userId = queue?.userId();
  if (!queue || !userId) return { queued: false, result: await direct() };
  return queue.sendOrQueue(build(userId), direct);
}

/** The writes waiting for one thing (`issue:<id>`, `document:<path>`, `interaction:<id>`…), oldest first. */
export function useWritesFor(target: Accessor<string | null>) {
  const queue = useOptionalWriteQueue();
  return () => {
    const key = target();
    return key && queue ? queue.writes().filter((write) => write.target === key) : [];
  };
}

/** The fields every new write starts with. */
export function newWrite(fields: Omit<QueuedWrite, "id" | "status" | "uncertain" | "attempts" | "error" | "createdAt" | "updatedAt">): QueuedWrite {
  const at = Date.now();
  return { ...fields, id: randomId(), status: "queued", uncertain: false, attempts: 0, error: null, createdAt: at, updatedAt: at };
}
