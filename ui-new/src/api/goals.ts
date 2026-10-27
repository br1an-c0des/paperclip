import type { Goal } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Goals, as ui/src/api/goals.ts uses them. There's no Goals page (decision 14): goals are a task
 * property, and a project's goals are kept in its settings, which create and edit them here and link
 * them through the project's `goalIds`.
 */
export const goalsApi = {
  list: (companyId: string) => api.get<Goal[]>(`/companies/${companyId}/goals`),
  create: (companyId: string, data: Record<string, unknown>) => api.post<Goal>(`/companies/${encodeURIComponent(companyId)}/goals`, data),
  update: (goalId: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${encodeURIComponent(goalId)}`, data),
};
