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
import type {
  CompanyImportTransferCreated,
  CompanyImportTransferDeclaration,
  CompanyImportTransferPartUploadResult,
  CompanyImportTransferStatus,
} from "@paperclipai/shared/company-import-transfer";
import type { ExportFidelityReport } from "@paperclipai/shared/portability-fidelity";
import { api, ApiError, errorMessage, readApiJson } from "./client";

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

  /*
   * Resumable transfers for large packages: declare the zip as content-addressed parts, upload the
   * parts the server is missing, then preview or apply against what it assembled. Declaring the
   * same zip again resumes the transfer, so only lost parts are sent again.
   */
  importTransferCreate: (declaration: CompanyImportTransferDeclaration) => api.post<CompanyImportTransferCreated>(TRANSFERS, declaration),
  importTransferUploadPart: (transferId: string, index: number, bytes: Blob) =>
    putBytes<CompanyImportTransferPartUploadResult>(`${transfer(transferId)}/parts/${index}`, bytes),
  importTransferStatus: (transferId: string) => api.get<CompanyImportTransferStatus>(transfer(transferId)),
  importTransferPreview: (transferId: string, meta: CompanyImportPreviewMeta) => api.post<CompanyPortabilityPreviewResult>(`${transfer(transferId)}/preview`, meta),
  /** Applies an uploaded transfer as a background job, like `importPackageAsync`. */
  importTransferApply: (transferId: string, meta: CompanyImportMeta) => api.post<CompanyImportJobAccepted>(`${transfer(transferId)}/apply?async=1`, meta),
};

/*
 * The transfer routes, as `@paperclipai/shared/company-import-transfer` builds them. That module
 * also carries zod schemas, so only its types are imported (decision 10).
 */
const TRANSFERS = "/companies/import/transfers";
const transfer = (transferId: string) => `${TRANSFERS}/${encodeURIComponent(transferId)}`;

/** A raw upload (`application/octet-stream`), which the JSON client doesn't send; errors as the client reports them. */
async function putBytes<T>(path: string, bytes: Blob): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    credentials: "include",
    body: bytes,
    headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
  });
  const body = await readApiJson<unknown>(res);
  if (!res.ok) throw new ApiError(errorMessage(body, res.status), res.status, body);
  return body as T;
}

/** One company's counts; stats leaves out companies with no agents or tasks yet. */
export function statsFor(stats: CompanyStats | undefined, companyId: string) {
  return stats ? (stats[companyId] ?? { agentCount: 0, issueCount: 0 }) : undefined;
}
