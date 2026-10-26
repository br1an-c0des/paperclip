import type { Goal } from "@paperclipai/shared";
import { api } from "./client";

/* Goals, as ui/src/api/goals.ts lists them. In the redesign they become a project's lists (decision C). */
export const goalsApi = {
  list: (companyId: string) => api.get<Goal[]>(`/companies/${companyId}/goals`),
};
