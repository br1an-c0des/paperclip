import type { DocumentOwner } from "@/api/documents";

/*
 * What the document editor needs from the page it's on: whose documents they are, where their
 * queries live in the cache, and how to name the people and agents who wrote them. The task panel
 * builds one for a task (TaskFiles.tsx); project documents would build their own.
 */

export type DocumentHost = {
  owner: DocumentOwner;
  /** Query key prefix for the owner's documents. Each document, its revisions and its threads sit under it. */
  root: readonly unknown[];
  /** An agent's or person's name; "You" for the signed-in user. */
  nameOf: (agentId: string | null | undefined, userId: string | null | undefined) => string | null;
  youId: () => string | null;
};

export const documentKeys = {
  list: (host: DocumentHost) => [...host.root] as const,
  doc: (host: DocumentHost, key: string) => [...host.root, key] as const,
  revisions: (host: DocumentHost, key: string) => [...host.root, key, "revisions"] as const,
  annotations: (host: DocumentHost, key: string) => [...host.root, key, "annotations"] as const,
};
