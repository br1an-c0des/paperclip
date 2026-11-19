import { z } from "zod";
import { createIssueWorkProductSchema, updateIssueWorkProductSchema } from "@paperclipai/shared";
import { McpToolError } from "../dispatch.js";
import type { CatalogDispatch } from "./types.js";
import { object, pathId, pick, rows, taskId, tool } from "./util.js";

const ATTACHMENT_FIELDS = ["id", "originalFilename", "contentType", "byteSize", "sha256", "createdAt"] as const;
const DELIVERABLE_FIELDS = ["id", "type", "provider", "externalId", "title", "url", "status", "isPrimary", "summary", "metadata", "updatedAt"] as const;
const fields = { type: true, provider: true, externalId: true, title: true, url: true, status: true, isPrimary: true, summary: true } as const;
// Deciding a review isn't open here: no reviewState.
const status = z.enum(["active", "ready_for_review", "closed", "failed", "archived", "draft"]);

/** A deliverable pointing at a file attached to the task, with the attachment's links. */
async function withAttachment(api: CatalogDispatch, task: string, deliverable: Record<string, unknown>, attachmentId: string | undefined) {
  if (!attachmentId) return deliverable;
  const attachment = rows(await api("GET", `/issues/${pathId(task)}/attachments`)).find(row => object(row).id === attachmentId);
  if (!attachment) throw new McpToolError({ status: 404, code: "attachment_not_found", message: "That file isn't attached to this task." });
  const contentPath = `/api/attachments/${attachmentId}/content`;
  return {
    ...deliverable, type: "artifact", provider: "paperclip", externalId: attachmentId,
    metadata: { ...pick(attachment, ["contentType", "byteSize", "originalFilename"]), attachmentId, contentPath, openPath: contentPath, downloadPath: `${contentPath}?download=1` },
  };
}

export const DELIVERABLE_TOOLS = [
  tool({
    name: "paperclip_deliverables",
    description: "A task's deliverables and attached files; register a deliverable (a link, or an attachmentId) or update one.",
    action: ["tasks:update_own", "tasks:update_any"],
    writes: args => Boolean(args.register || args.update),
    input: z.object({
      taskId,
      register: createIssueWorkProductSchema.pick(fields).extend({ status: status.default("active"), attachmentId: z.uuid().optional() }).strict().optional(),
      update: updateIssueWorkProductSchema.pick(fields).extend({ deliverableId: z.uuid(), status: status.optional(), attachmentId: z.uuid().optional() }).strict().optional(),
    }).strict().refine(args => !(args.register && args.update), "Register or update, not both"),
    run: async (_caller, args, api) => {
      const base = `/issues/${pathId(args.taskId)}`;
      if (args.register) {
        const { attachmentId, ...deliverable } = args.register;
        return { deliverable: pick(await api("POST", `${base}/work-products`, await withAttachment(api, args.taskId, deliverable, attachmentId)), DELIVERABLE_FIELDS) };
      }
      if (args.update) {
        const { deliverableId, attachmentId, ...changes } = args.update;
        if (!rows(await api("GET", `${base}/work-products`)).some(row => object(row).id === deliverableId)) {
          throw new McpToolError({ status: 404, code: "deliverable_not_found", message: "That deliverable doesn't belong to this task." });
        }
        return { deliverable: pick(await api("PATCH", `/work-products/${pathId(deliverableId)}`, await withAttachment(api, args.taskId, changes, attachmentId)), DELIVERABLE_FIELDS) };
      }
      return {
        deliverables: rows(await api("GET", `${base}/work-products`)).map(row => pick(row, DELIVERABLE_FIELDS)),
        attachments: rows(await api("GET", `${base}/attachments`)).map(row => pick(row, ATTACHMENT_FIELDS)),
      };
    },
  }),
];
