import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { documentsApi } from "@/api/documents";
import { documentKeys, type DocumentHost } from "./host";

/*
 * Queries the document list and the editor share. Kept apart from the editor's components, which
 * load on demand, so a list can show comment counts without loading the editor.
 */

/** A document's annotation threads, all statuses, with their comments. */
export function useThreads(host: Accessor<DocumentHost>, docKey: Accessor<string>) {
  return createQuery(() => ({
    queryKey: documentKeys.annotations(host(), docKey()),
    queryFn: ({ signal }) => documentsApi.annotations.list(host().owner, docKey(), { status: "all", includeComments: true }, signal),
    staleTime: 30_000,
  }));
}
