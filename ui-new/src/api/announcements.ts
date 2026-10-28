import type { Announcement } from "@paperclipai/shared";
import { ApiError } from "./client";

/*
 * Paperclip's announcements (ui/src/api/announcements.ts): the one current announcement for the
 * signed-in person (`GET /api/announcements/current`, null when there's none or they dismissed it)
 * and dismissing it (`POST /api/announcements/:id/dismiss`, with the company it was seen in). Its
 * image is at `/api/announcements/:id/image`. Responses aren't cached: they depend on the account.
 */

async function request(path: string, init: RequestInit) {
  const response = await fetch(`/api/announcements/${path}`, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) throw new ApiError("Announcement request failed", response.status, null);
  return response;
}

export const announcementsApi = {
  current: async (signal?: AbortSignal): Promise<Announcement | null> => {
    const response = await request("current", { signal });
    return (await response.json()) as Announcement | null;
  },
  dismiss: async (id: string, companyId: string, signal?: AbortSignal) => {
    await request(`${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
  },
  imageUrl: (id: string) => `/api/announcements/${encodeURIComponent(id)}/image`,
};
