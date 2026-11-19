import type { RunDisposition } from "@paperclipai/shared";
import { AGENT_TOOLS } from "./agents.js";
import { API_TOOLS } from "./api.js";
import { DELIVERABLE_TOOLS } from "./deliverables.js";
import { DIRECTORY_TOOLS } from "./directory.js";
import { DOCUMENT_TOOLS } from "./documents.js";
import { createFileTools, type CatalogFiles } from "./files.js";
import { LABEL_TOOLS } from "./labels.js";
import { REQUEST_TOOLS } from "./requests.js";
import { createRunTools } from "./run.js";
import { SKILL_TOOLS } from "./skills.js";
import { TASK_TOOLS } from "./tasks.js";
import type { PaperclipTool } from "./types.js";

export type { CatalogFiles } from "./files.js";

/** What the tools need beyond the REST API: the run's task, recording its disposition, file links. */
export interface CatalogDeps {
  /** The task the run is bound to, and the comment that woke it, if any. */
  runTask(runId: string): Promise<{ taskId: string | null; wakeCommentId: string | null }>;
  recordDisposition(runId: string, disposition: RunDisposition): Promise<void>;
  /** File links for outside connections (the public MCP's transfer tickets). */
  files?: CatalogFiles;
}

/** Every tool the Paperclip MCP serves, before filtering for a caller. */
export function createPaperclipCatalog(deps: CatalogDeps): readonly PaperclipTool[] {
  const catalog: PaperclipTool[] = [];
  catalog.push(
    ...createRunTools(deps, () => catalog),
    ...TASK_TOOLS, ...DOCUMENT_TOOLS, ...DELIVERABLE_TOOLS, ...LABEL_TOOLS, ...DIRECTORY_TOOLS, ...REQUEST_TOOLS,
    ...AGENT_TOOLS, ...SKILL_TOOLS, ...createFileTools(deps.files), ...API_TOOLS,
  );
  return catalog;
}
