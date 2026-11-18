import { z } from "zod";
import { DOCUMENT_FIELDS, pathId, pick, rows, taskId, tool } from "./util.js";

const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/).describe("Document key, e.g. plan or report");

export const DOCUMENT_TOOLS = [
  tool({
    name: "paperclip_read_document",
    description: "Read a task document by key, or list the task's documents when no key is given.",
    action: "tasks:read",
    input: z.object({ taskId, key: key.optional() }).strict(),
    run: async (_caller, args, api) => {
      if (args.key) return { document: pick(await api("GET", `/issues/${pathId(args.taskId)}/documents/${pathId(args.key)}`), DOCUMENT_FIELDS) };
      const documents = rows(await api("GET", `/issues/${pathId(args.taskId)}/documents`));
      return { documents: documents.map(row => pick(row, DOCUMENT_FIELDS.filter(field => field !== "body"))) };
    },
  }),
  tool({
    name: "paperclip_write_document",
    description: "Create or replace a task document. Pass the latestRevisionId you read as baseRevisionId (null for a new document); a stale one is refused.",
    action: ["tasks:update_own", "tasks:update_any"],
    input: z.object({
      taskId,
      key,
      title: z.string().trim().max(200).optional(),
      body: z.string().max(524288),
      baseRevisionId: z.uuid().nullable(),
      changeSummary: z.string().trim().max(500).optional(),
    }).strict(),
    run: async (_caller, { taskId: id, key: documentKey, ...document }, api) => ({
      document: pick(await api("PUT", `/issues/${pathId(id)}/documents/${pathId(documentKey)}`, {
        ...(document.title !== undefined ? { title: document.title } : {}),
        format: "markdown",
        body: document.body,
        ...(document.changeSummary !== undefined ? { changeSummary: document.changeSummary } : {}),
        baseRevisionId: document.baseRevisionId,
      }), DOCUMENT_FIELDS.filter(field => field !== "body")),
    }),
  }),
];
