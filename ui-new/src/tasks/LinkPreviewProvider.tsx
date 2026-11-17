import type { LinkPreviewTarget } from "@paperclipai/shared";
import { QueryClientContext } from "@tanstack/solid-query";
import { createContext, createMemo, onCleanup, useContext, type ParentProps } from "solid-js";
import { linkPreviewsApi } from "@/api/link-previews";
import { useOptionalCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { createLinkPreviewPageLoader, type LinkPreviewPageLoader, type LinkPreviewSource } from "./link-preview-loader";

/*
 * The page's pull request status loader (U175, link-preview-loader.ts), one per company and
 * viewer, as the old UI's LinkPreviewContext.tsx. Mounted by the company layout
 * (routes/CompanyLayout.tsx), so every message and streaming reply on the board shares it: their
 * status marks register here (LinkPreview.tsx) and read the same cached answers.
 *
 * Outside it (a component rendered on its own in a test), a mark reads its preview only when its
 * card opens, as before.
 */

export type LinkPreviewPage = { source: LinkPreviewSource; loader: LinkPreviewPageLoader };

const LinkPreviewContext = createContext<() => LinkPreviewPage | null>();

/** Whose preview this is: the signed-in user, or `local-board` without sign-in, as the saved reads name them (persisted-cache.ts). */
export function useViewerId(): () => string | null {
  try {
    return useSession().youId;
  } catch {
    return () => null;
  }
}

export function createLinkPreviewSource(companyId: string, userId: string | null): LinkPreviewSource {
  return {
    companyId,
    userId,
    pausedUntil: 0,
    load: (target: LinkPreviewTarget) => linkPreviewsApi.get(companyId, target.canonicalUrl),
    readCached: (targets: LinkPreviewTarget[]) => linkPreviewsApi.cached(companyId, targets.map((target) => target.canonicalUrl)),
  };
}

export function LinkPreviewProvider(props: ParentProps) {
  const client = useContext(QueryClientContext);
  const company = useOptionalCompany();
  const viewer = useViewerId();
  // Only a change of company or viewer starts a new loader, not a refetch of either.
  const companyId = createMemo(() => company?.().id ?? null);
  const userId = createMemo(() => viewer());
  const page = createMemo((): LinkPreviewPage | null => {
    const queryClient = client?.();
    const id = companyId();
    if (!queryClient || !id) return null;
    const source = createLinkPreviewSource(id, userId());
    const loader = createLinkPreviewPageLoader(queryClient, source);
    onCleanup(() => loader.dispose());
    return { source, loader };
  });
  return <LinkPreviewContext.Provider value={page}>{props.children}</LinkPreviewContext.Provider>;
}

/** The page's loader, or null outside a provider. */
export function useLinkPreviewPage(): () => LinkPreviewPage | null {
  return useContext(LinkPreviewContext) ?? (() => null);
}
