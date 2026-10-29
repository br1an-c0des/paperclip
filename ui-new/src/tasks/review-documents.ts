import type { AttachmentArtifactWorkProductMetadata, IssueWorkProduct } from "@paperclipai/shared";

/*
 * Markdown outputs read as documents. An artifact output that is a Markdown attachment can be opened
 * as a review document: the server copies it into the task's `artifact-review-<outputId>` document
 * (POST …/work-products/:id/review-document), where it reads and takes notes like any other. Those
 * documents show only through their output, never in the Documents list.
 *
 * Copied from @paperclipai/shared's markdown-work-products.ts (decision 10: runtime helpers are copied,
 * types imported), so the server and this page agree on which files qualify.
 */

const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown", "application/markdown", "application/x-markdown"]);
const FALLBACK_TYPES = new Set(["text/plain", "application/octet-stream", "binary/octet-stream", "application/x-binary"]);
const REVIEW_PREFIX = "artifact-review-";

/** The largest file the server will copy into a review document: the document body limit. */
export const REVIEW_DOCUMENT_MAX_BYTES = 512 * 1024;

export function isMarkdownContent(input: { contentType: string | null | undefined; originalFilename?: string | null }) {
  const type = (input.contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (MARKDOWN_TYPES.has(type)) return true;
  const name = (input.originalFilename ?? "").toLowerCase();
  if (!name.endsWith(".md") && !name.endsWith(".markdown")) return false;
  return FALLBACK_TYPES.has(type);
}

/** The attachment behind a Markdown artifact output, or null when the output isn't one. */
export function markdownOutput(output: Pick<IssueWorkProduct, "type" | "provider" | "metadata">): AttachmentArtifactWorkProductMetadata | null {
  if (output.type !== "artifact" || output.provider !== "paperclip" || !output.metadata) return null;
  const meta = output.metadata as Partial<AttachmentArtifactWorkProductMetadata>;
  if (typeof meta.attachmentId !== "string" || typeof meta.contentType !== "string" || typeof meta.byteSize !== "number") return null;
  if (typeof meta.contentPath !== "string") return null;
  const found = meta as AttachmentArtifactWorkProductMetadata;
  return isMarkdownContent(found) ? found : null;
}

export const reviewDocumentKey = (outputId: string) => `${REVIEW_PREFIX}${outputId}`;

export const isReviewDocumentKey = (key: string) => key.startsWith(REVIEW_PREFIX) && key.length > REVIEW_PREFIX.length;

/** Why a Markdown output can't be reviewed, from the file or the server's answer; null when it can. */
export function reviewProblem(meta: AttachmentArtifactWorkProductMetadata, status?: number) {
  if (meta.byteSize > REVIEW_DOCUMENT_MAX_BYTES) return "Too large to review here. Open the file instead.";
  if (status === 413) return "Too large to review here. Open the file instead.";
  if (status === 415 || status === 422) return "This file can't be read as a document. Open the file instead.";
  return null;
}
