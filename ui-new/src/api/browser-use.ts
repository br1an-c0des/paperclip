import type { BrowserUseControl, BrowserUseSettings, BrowserUseViewportPreset, BrowserUseViewportRequest, BrowserUseViewportState, TaskBrowser } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Browser Use on a task (`/api/issues/:issueId/browsers/*`), as ui/src/api/browser-use.ts uses it:
 * the browsers an agent opened for the task, a short-lived viewer address for watching one live,
 * keeping an idle one open, stopping or ending it, and sizing its window.
 */

const enc = encodeURIComponent;
const browser = (issueId: string, browserId: string, rest: string) => `/issues/${enc(issueId)}/browsers/${enc(browserId)}${rest}`;

export const browserUseApi = {
  list: (issueId: string, signal?: AbortSignal) => api.get<TaskBrowser[]>(`/issues/${enc(issueId)}/browsers`, { signal }),
  /** The viewer address carries a bearer token: keep it in memory only. */
  viewer: (issueId: string, browserId: string, viewerId: string, signal?: AbortSignal) =>
    api.get<{ url: string; viewport: BrowserUseViewportPreset; viewportState?: BrowserUseViewportState }>(
      browser(issueId, browserId, `/viewer?viewerId=${enc(viewerId)}`),
      { signal },
    ),
  /** Someone is watching: an idle browser stays open a little longer. */
  presence: (issueId: string, browserId: string) => api.post<{ accepted: boolean }>(browser(issueId, browserId, "/presence"), {}),
  control: (issueId: string, browserId: string, action: BrowserUseControl) => api.post<unknown>(browser(issueId, browserId, "/control"), { action }),
  /** A preset size, or `fit` this viewer's pane (`takeControl` claims the size from other viewers). */
  resize: (issueId: string, browserId: string, viewport: BrowserUseViewportRequest) =>
    api.post<BrowserUseViewportState>(browser(issueId, browserId, "/viewport"), viewport),
  releaseViewport: (issueId: string, browserId: string, viewerId: string) =>
    api.post<unknown>(browser(issueId, browserId, "/viewport/release"), { viewerId }),

  /*
   * Browser Use Cloud settings for one credential (`/companies/:id/browser-use-cloud/grants/:grantId/*`),
   * on its connection's page: the saved profiles agents may use and a cost cap per browser run.
   */
  cloudProfiles: (companyId: string, grantId: string, signal?: AbortSignal) =>
    api.get<Array<{ id: string; name: string | null }>>(cloud(companyId, grantId, "/profiles"), { signal }),
  cloudSettings: (companyId: string, grantId: string, signal?: AbortSignal) => api.get<BrowserUseSettings>(cloud(companyId, grantId, "/settings"), { signal }),
  saveCloudSettings: (companyId: string, grantId: string, value: BrowserUseSettings) =>
    api.put<BrowserUseSettings>(cloud(companyId, grantId, "/settings"), value),
};

function cloud(companyId: string, grantId: string, rest: string) {
  return `/companies/${enc(companyId)}/browser-use-cloud/grants/${enc(grantId)}${rest}`;
}
