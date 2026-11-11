import type { LinkPreviewResult } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Link previews (U113, since the 2026-11-10 sync, upstream #20593): what a GitHub pull request link
 * in a message points at, its title, state (open, draft, merged, closed, or blocked by merge
 * conflicts), author and last update. `GET /companies/:companyId/link-preview?url=` is for board
 * users only and answers `private, no-store`, read with the viewer's own GitHub access, so it's
 * asked only when someone shows interest in a link (hover, keyboard focus, a tap on its mark) and
 * kept in the query cache per viewer, company and link (`queryKeys.linkPreview`) for the
 * `maxAgeMs` the answer gives. `preview` is null for a link the server can't describe.
 */

export const linkPreviewsApi = {
  get: (companyId: string, url: string, signal?: AbortSignal) =>
    api.get<LinkPreviewResult>(`/companies/${encodeURIComponent(companyId)}/link-preview?${new URLSearchParams({ url })}`, { signal }),
};
