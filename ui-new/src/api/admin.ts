import type { Company } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Instance administration (ui/src/api/access.ts and companies.ts), for App settings' Organizations
 * and Admins sections: every organization on the instance, and the people on it with their
 * instance-admin role and organization access. Instance admins only.
 *
 * The response types live in the old UI, not in @paperclipai/shared, so the fields ui-new reads are
 * declared here.
 */

/** One person in `GET /admin/users`. */
export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  isInstanceAdmin: boolean;
  activeCompanyMembershipCount: number;
};

export type UserCompanyAccessEntry = {
  id: string;
  companyId: string;
  status: "pending" | "active" | "suspended" | "archived";
  membershipRole: "owner" | "admin" | "operator" | "viewer" | "member" | null;
  companyName: string | null;
  companyStatus: "active" | "paused" | "archived" | null;
  updatedAt: string;
};

/** `GET|PUT /admin/users/:id/company-access`. */
export type UserCompanyAccess = {
  user: { id: string; email: string | null; name: string | null; image: string | null; isInstanceAdmin: boolean } | null;
  companyAccess: UserCompanyAccessEntry[];
};

export const adminApi = {
  users: (query: string) => api.get<AdminUser[]>(`/admin/users?query=${encodeURIComponent(query)}`),
  promote: (userId: string) => api.post(`/admin/users/${encodeURIComponent(userId)}/promote-instance-admin`, {}),
  demote: (userId: string) => api.post(`/admin/users/${encodeURIComponent(userId)}/demote-instance-admin`, {}),
  companyAccess: (userId: string) => api.get<UserCompanyAccess>(`/admin/users/${encodeURIComponent(userId)}/company-access`),
  /** Sets the organizations the person belongs to: new ones join as an active operator. */
  setCompanyAccess: (userId: string, companyIds: string[]) =>
    api.put<UserCompanyAccess>(`/admin/users/${encodeURIComponent(userId)}/company-access`, { companyIds }),

  /** Every organization on the instance, archived ones too (the unscoped `GET /companies`). */
  companies: () => api.get<Company[]>("/companies"),
  createCompany: (data: { name: string; description?: string | null }) => api.post<Company>("/companies", data),
  updateCompany: (companyId: string, data: Partial<Pick<Company, "name" | "status">>) =>
    api.patch<Company>(`/companies/${encodeURIComponent(companyId)}`, data),
  /** Only when the server allows it (`features.companyDeletionEnabled` in `/health`). */
  deleteCompany: (companyId: string) => api.delete<{ ok: true }>(`/companies/${encodeURIComponent(companyId)}`),
};
