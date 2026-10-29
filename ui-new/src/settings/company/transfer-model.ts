import type {
  CompanyPortabilityCollisionStrategy,
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
} from "@paperclipai/shared";
import type { CompanyImportTransferCreated, CompanyImportTransferDeclaration } from "@paperclipai/shared/company-import-transfer";

/*
 * Import and export (board 30's outline): move an organization between Paperclip instances as a
 * company package (a zip of markdown and YAML files). An import makes a new organization or merges
 * into this one; packages over 48 MB upload as a resumable transfer.
 */

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 agents · 2 projects · 14 tasks · 5 skills · 41 files". */
export function exportCounts(counts: CompanyPortabilityExportPreviewResult["counts"]) {
  return [
    plural(counts.agents, "agent", "agents"),
    plural(counts.projects, "project", "projects"),
    plural(counts.issues, "task", "tasks"),
    plural(counts.skills, "skill", "skills"),
    plural(counts.files, "file", "files"),
  ].join(" · ");
}

/** What an import would do, line by line: "Creates 3 agents", "Skips 1 project"… */
export function importPlanLines(plan: CompanyPortabilityPreviewResult["plan"]) {
  const lines: string[] = [];
  if (plan.companyAction === "create") lines.push("Creates a new organization");
  if (plan.companyAction === "update") lines.push("Updates the organization's details");
  const tally = (items: readonly { action: string }[], one: string, many: string) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
    for (const [action, count] of counts) {
      const verb = action === "create" ? "Creates" : action === "update" ? "Updates" : "Skips";
      lines.push(`${verb} ${plural(count, one, many)}`);
    }
  };
  tally(plan.agentPlans, "agent", "agents");
  tally(plan.projectPlans, "project", "projects");
  tally(plan.issuePlans, "task", "tasks");
  return lines;
}

/** A package file must be a zip. */
export function packageProblem(file: File | null | undefined): string | null {
  if (!file) return "Choose a .zip package.";
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") return "Choose a .zip package.";
  return null;
}

/** The download's file name: the package's root folder. */
export function exportFileName(rootPath: string) {
  const base = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "company";
  return `${base}.zip`;
}

// ---------------------------------------------------------------------------------------------
// Where an import goes

export type ImportTarget = "new" | "existing";

/** What happens when a package's agent, project or skill has the same name as one here. */
export const COLLISION_OPTIONS: readonly { value: CompanyPortabilityCollisionStrategy; label: string; help: string }[] = [
  { value: "rename", label: "Keep both", help: "Imported ones get a new name." },
  { value: "skip", label: "Skip", help: "Keep what's here; leave the package's out." },
  { value: "replace", label: "Replace", help: "Overwrite what's here with the package's." },
];

/** The preview's import fields: a new organization, or this one with a rule for same-named items. */
export function importTarget(
  target: ImportTarget,
  companyId: string,
  newName: string,
  collision: CompanyPortabilityCollisionStrategy,
): Pick<CompanyPortabilityPreviewRequest, "target" | "collisionStrategy"> {
  return target === "new"
    ? { target: { mode: "new_company", newCompanyName: newName.trim() || null }, collisionStrategy: "rename" }
    : { target: { mode: "existing_company", companyId }, collisionStrategy: collision };
}

/**
 * The files to import into this organization. As in the old page, the package's company file
 * (its name, description and settings) is left out unless asked for, so a merge doesn't rename or
 * redescribe this organization. Undefined means every file.
 */
export function importedFiles(preview: CompanyPortabilityPreviewResult, updateDetails: boolean): string[] | undefined {
  const companyPath = preview.manifest.company?.path;
  if (updateDetails || preview.plan.companyAction !== "update" || !companyPath) return undefined;
  const skip = companyPath.endsWith(".md") ? companyPath : `${companyPath}.md`;
  return Object.keys(preview.files)
    .filter((path) => path !== skip)
    .sort();
}

// ---------------------------------------------------------------------------------------------
// Resumable transfers for large packages (ui/src/lib/import-transfer.ts)

/** Packages larger than this upload in parts that survive a dropped connection. */
export const CHUNKED_IMPORT_THRESHOLD_BYTES = 48 * 1024 * 1024;
/** Every part but the last. */
export const IMPORT_TRANSFER_PART_SIZE_BYTES = 32 * 1024 * 1024;
/** Tries per part before the upload stops; a retry resumes from the parts already sent. */
export const IMPORT_TRANSFER_PART_ATTEMPTS = 3;

export function usesChunkedTransfer(file: Pick<File, "size">, threshold = CHUNKED_IMPORT_THRESHOLD_BYTES) {
  return file.size > threshold;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Describes a zip as content-addressed parts: the whole file's sha256 and each part's. The server
 * keys transfers by content, so declaring the same zip again resumes it.
 */
export async function transferDeclaration(buffer: ArrayBuffer, partSize = IMPORT_TRANSFER_PART_SIZE_BYTES): Promise<CompanyImportTransferDeclaration> {
  const parts: CompanyImportTransferDeclaration["parts"] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += partSize) {
    const byteSize = Math.min(partSize, buffer.byteLength - offset);
    parts.push({ index: parts.length, byteSize, sha256: await sha256Hex(new Uint8Array(buffer, offset, byteSize)) });
  }
  return { totalBytes: buffer.byteLength, zipSha256: await sha256Hex(buffer), partSizeBytes: partSize, parts };
}

export type TransferProgress = { uploadedParts: number; totalParts: number; uploadedBytes: number; totalBytes: number };

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** "Uploading part 2 of 4: 32 MB of 120 MB." */
export function transferProgressLine(progress: TransferProgress) {
  const part = Math.min(progress.uploadedParts + 1, progress.totalParts);
  return `Uploading part ${part} of ${progress.totalParts}: ${megabytes(progress.uploadedBytes)} of ${megabytes(progress.totalBytes)}.`;
}

/** A declaration the server answered with `alreadyCompleted`: this zip was imported before. */
export function alreadyImportedMessage(company: CompanyImportTransferCreated["company"]) {
  const where = company ? ` It went into ${company.name ?? company.id}${company.issuePrefix ? ` (${company.issuePrefix})` : ""}.` : "";
  return `This exact package was already imported.${where} Export it again to import it once more.`;
}

/**
 * Declares (or resumes) a transfer and uploads the parts the server is missing, each tried up to
 * three times. Resolves the transfer's id once the server holds every part.
 */
export async function uploadTransfer(
  file: Blob,
  declaration: CompanyImportTransferDeclaration,
  calls: {
    create: (declaration: CompanyImportTransferDeclaration) => Promise<CompanyImportTransferCreated>;
    upload: (transferId: string, index: number, bytes: Blob) => Promise<unknown>;
  },
  onProgress: (progress: TransferProgress) => void,
): Promise<string> {
  const created = await calls.create(declaration);
  if (created.alreadyCompleted) throw new Error(alreadyImportedMessage(created.company));
  const missing = new Set(created.missingParts);
  const progress: TransferProgress = {
    uploadedParts: declaration.parts.length - missing.size,
    totalParts: declaration.parts.length,
    uploadedBytes: declaration.parts.reduce((sum, part) => (missing.has(part.index) ? sum : sum + part.byteSize), 0),
    totalBytes: declaration.totalBytes,
  };
  onProgress({ ...progress });
  for (const part of declaration.parts) {
    if (!missing.has(part.index)) continue;
    const offset = part.index * declaration.partSizeBytes;
    const bytes = file.slice(offset, offset + part.byteSize);
    let lastError: unknown = null;
    let sent = false;
    for (let attempt = 0; attempt < IMPORT_TRANSFER_PART_ATTEMPTS && !sent; attempt += 1) {
      try {
        await calls.upload(created.transferId, part.index, bytes);
        sent = true;
      } catch (caught) {
        lastError = caught;
      }
    }
    if (!sent) throw lastError instanceof Error ? lastError : new Error(`Part ${part.index + 1} of ${declaration.parts.length} didn't upload.`);
    progress.uploadedParts += 1;
    progress.uploadedBytes += part.byteSize;
    onProgress({ ...progress });
  }
  return created.transferId;
}
