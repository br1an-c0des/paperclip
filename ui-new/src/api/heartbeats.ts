import type { AgentAppearance } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Runs that are queued or running right now (`GET /companies/:id/live-runs`), for the nav's agent
 * states. The response type lives in the old UI (ui/src/api/heartbeats.ts); these are the fields
 * ui-new reads.
 */

export type LiveRun = {
  id: string;
  status: string;
  agentId: string;
  agentName: string;
  agentAppearance?: AgentAppearance | null;
  issueId?: string | null;
  startedAt: string | null;
  createdAt: string;
};

export const heartbeatsApi = {
  liveRuns: (companyId: string) => api.get<LiveRun[]>(`/companies/${companyId}/live-runs`),
};
