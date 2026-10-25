import type { Company } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Companies, as ui/src/api/companies.ts uses them. The board lists only companies the user can
 * enter (`scope=accessible`); the unscoped list also includes companies visible only through
 * instance admin.
 */

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies?scope=accessible"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
};

/** One company's counts; stats leaves out companies with no agents or tasks yet. */
export function statsFor(stats: CompanyStats | undefined, companyId: string) {
  return stats ? (stats[companyId] ?? { agentCount: 0, issueCount: 0 }) : undefined;
}
