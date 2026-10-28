import type { AssetImage, CurrentUserProfile, UpdateCurrentUserProfile } from "@paperclipai/shared";
import { api, ApiError, errorMessage, readApiJson } from "./client";

/*
 * Your profile (ui/src/api/auth.ts `getProfile`, `updateProfile`; ui/src/api/assets.ts), for App
 * settings' Account section. `/api/auth/profile` answers on a local_trusted instance too, for the
 * local board user. An avatar is an image uploaded into one organization's file storage.
 */

async function authRequest<T>(method: "GET" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch("/api/auth/profile", {
    method,
    credentials: "include",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readApiJson<unknown>(res);
  if (!res.ok) throw new ApiError(errorMessage(payload, res.status), res.status, payload);
  return payload as T;
}

export const accountApi = {
  profile: () => authRequest<CurrentUserProfile>("GET"),
  /** The name is required: send the current one when only the image changes. */
  updateProfile: (input: UpdateCurrentUserProfile) => authRequest<CurrentUserProfile>("PATCH", input),
  /** Uploads an avatar image into the organization's storage; the profile then points at `contentPath`. */
  uploadAvatar: async (companyId: string, file: File, namespace: string) => {
    // Read the file first so the request body doesn't depend on a transient File.
    const safeFile = new File([await file.arrayBuffer()], file.name, { type: file.type });
    const form = new FormData();
    form.append("namespace", namespace);
    form.append("file", safeFile);
    return api.postForm<AssetImage>(`/companies/${encodeURIComponent(companyId)}/assets/images`, form);
  },
};
