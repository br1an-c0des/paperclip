import type { AiConnectionPool, AiConnectionPoolConfig, AiConnectionUsage } from "@paperclipai/shared";
import { api } from "./client";

/*
 * AI connection pools (`/api/companies/:companyId/ai-connection-pools`), as
 * ui/src/api/ai-connection-pools.ts uses them. A pool is a plugin-provided AI connection that hands
 * each new task to one of several existing AI connections, in turn or skipping those near their
 * usage limit. Saves and removals carry the revision they were made against.
 */

/** Why each member was skipped last, and its cached usage, keyed by member ID. */
export type PoolInspection = Record<string, { reason: string; checkedAt: string | null; usage?: AiConnectionUsage }>;

export type SavePoolInput = { pluginKey: string; id?: string; expectedRevision?: number; config: AiConnectionPoolConfig };

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/ai-connection-pools`;

export const aiConnectionPoolsApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<AiConnectionPool[]>(base(companyId), { signal }),
  save: (companyId: string, input: SavePoolInput) => api.post<AiConnectionPool>(base(companyId), input),
  inspect: (companyId: string, id: string, signal?: AbortSignal) =>
    api.get<PoolInspection>(`${base(companyId)}/${encodeURIComponent(id)}/inspection`, { signal }),
  /** The connections in the pool are kept. */
  remove: (companyId: string, id: string, expectedRevision: number) =>
    api.delete<unknown>(`${base(companyId)}/${encodeURIComponent(id)}`, { expectedRevision }),
};
