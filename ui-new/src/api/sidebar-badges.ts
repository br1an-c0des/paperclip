import type { SidebarBadges } from "@paperclipai/shared";
import { api } from "./client";

/* The nav's counts (`GET /companies/:id/sidebar-badges`): `inbox` is what the Inbox badge shows. */
export const sidebarBadgesApi = {
  get: (companyId: string) => api.get<SidebarBadges>(`/companies/${companyId}/sidebar-badges`),
};
