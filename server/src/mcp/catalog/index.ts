import type { RunDisposition } from "@paperclipai/shared";
import { DIRECTORY_TOOLS } from "./directory.js";
import { DOCUMENT_TOOLS } from "./documents.js";
import { LABEL_TOOLS } from "./labels.js";
import { REQUEST_TOOLS } from "./requests.js";
import { TASK_TOOLS } from "./tasks.js";
import type { PaperclipTool } from "./types.js";

/** What the run tools need beyond the REST API: the run's task, and recording its disposition. */
export interface CatalogDeps {
  /** The task the run is bound to, and the comment that woke it, if any. */
  runTask(runId: string): Promise<{ taskId: string | null; wakeCommentId: string | null }>;
  recordDisposition(runId: string, disposition: RunDisposition): Promise<void>;
}

/** Every tool the Paperclip MCP serves, before filtering for a caller. */
export function createPaperclipCatalog(_deps: CatalogDeps): readonly PaperclipTool[] {
  return [...TASK_TOOLS, ...DOCUMENT_TOOLS, ...LABEL_TOOLS, ...DIRECTORY_TOOLS, ...REQUEST_TOOLS];
}
