import type {
  AgentObservabilitySettingsResponse,
  AgentObservabilityTestReceipt,
  Company,
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportRequest,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
  InteractionResolverGovernance,
  UpdateAgentObservabilityRequest,
} from "@paperclipai/shared";
import type { ExportFidelityReport } from "@paperclipai/shared/portability-fidelity";
import { api } from "./client";

/*
 * Companies, as ui/src/api/companies.ts uses them. The board lists only companies the user can
 * enter (`scope=accessible`); the unscoped list also includes companies visible only through
 * instance admin.
 *
 * Company settings (src/settings/company/) add the rest: the settings patch, the logo, archiving,
 * agent observability (run telemetry), and the company package's export and import.
 */

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

/** The fields company settings change with `PATCH /companies/:id`. */
export type CompanyPatch = Partial<
  Pick<
    Company,
    | "name"
    | "description"
    | "status"
    | "requireBoardApprovalForNewAgents"
    | "feedbackDataSharingEnabled"
    | "logoAssetId"
    | "defaultResponsibleUserId"
  > & { interactionResolverGovernance: InteractionResolverGovernance }
>;

/** Import fields sent beside an uploaded zip (`meta`): the JSON request without its source. */
export type CompanyImportPreviewMeta = Omit<CompanyPortabilityPreviewRequest, "source">;
export type CompanyImportMeta = Omit<CompanyPortabilityImportRequest, "source">;

export type CompanyImportJobState = "running" | "succeeded" | "failed";

/** The 202 from an async import (and the 409 body when a job is already running). */
export type CompanyImportJobAccepted = {
  job: { id: string; status: CompanyImportJobState };
  statusUrl: string;
  retryAfterMs?: number;
};

export type CompanyImportJobStatus = {
  job: {
    id: string;
    status: CompanyImportJobState;
    error?: { message: string };
    result?: { companyId: string; agentCount?: number; warningCount?: number };
    importResult?: CompanyPortabilityImportResult;
  };
  retryAfterMs?: number;
};

function packageForm(file: File, meta: CompanyImportPreviewMeta | CompanyImportMeta) {
  const form = new FormData();
  form.append("package", file);
  form.append("meta", JSON.stringify(meta));
  return form;
}

const company = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies?scope=accessible"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),

  update: (companyId: string, patch: CompanyPatch) => api.patch<Company>(company(companyId), patch),
  /** Uploads a logo image; the returned asset becomes the logo with `update({ logoAssetId })`. */
  uploadLogo: (companyId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<{ assetId: string }>(`${company(companyId)}/logo`, form);
  },
  archive: (companyId: string) => api.post<Company>(`${company(companyId)}/archive`, {}),

  /** Agent observability: where managed Claude Code and Codex runs send OpenTelemetry logs and traces. */
  observability: (companyId: string, signal?: AbortSignal) =>
    api.get<AgentObservabilitySettingsResponse>(`${company(companyId)}/observability`, { signal }),
  updateObservability: (companyId: string, input: UpdateAgentObservabilityRequest) =>
    api.put<AgentObservabilitySettingsResponse>(`${company(companyId)}/observability`, input),
  removeObservability: (companyId: string, expectedRevision: string) =>
    api.delete<AgentObservabilitySettingsResponse>(`${company(companyId)}/observability`, { expectedRevision }),
  testObservability: (companyId: string, expectedRevision: string) =>
    api.post<AgentObservabilityTestReceipt>(`${company(companyId)}/observability/test`, { expectedRevision }),

  exportPreview: (companyId: string, data: CompanyPortabilityExportRequest, signal?: AbortSignal) =>
    api.post<CompanyPortabilityExportPreviewResult>(`${company(companyId)}/exports/preview`, data, { signal }),
  exportBundle: (companyId: string, data: CompanyPortabilityExportRequest) =>
    api.post<CompanyPortabilityExportResult>(`${company(companyId)}/exports`, data),
  exportFidelity: (companyId: string, signal?: AbortSignal) =>
    api.get<ExportFidelityReport>(`${company(companyId)}/export/fidelity`, { signal }),

  /** Previews a zip package upload; nothing is written. */
  importPreviewPackage: (file: File, meta: CompanyImportPreviewMeta) =>
    api.postForm<CompanyPortabilityPreviewResult>("/companies/import/preview", packageForm(file, meta)),
  /** Starts an import of a zip package as a background job (`?async=1`, as the old UI does). */
  importPackageAsync: (file: File, meta: CompanyImportMeta) =>
    api.postForm<CompanyImportJobAccepted>("/companies/import?async=1", packageForm(file, meta)),
  importJob: (jobId: string) => api.get<CompanyImportJobStatus>(`/companies/import/jobs/${encodeURIComponent(jobId)}`),
};

/** One company's counts; stats leaves out companies with no agents or tasks yet. */
export function statsFor(stats: CompanyStats | undefined, companyId: string) {
  return stats ? (stats[companyId] ?? { agentCount: 0, issueCount: 0 }) : undefined;
}
