import { z } from "zod";
import { McpToolError } from "../dispatch.js";
import { pathId, pick, rows, tool } from "./util.js";

const LABEL_FIELDS = ["id", "name", "color"] as const;
const labelName = z.string().trim().min(1).max(48);
const labelColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("#rrggbb");

export const LABEL_TOOLS = [
  tool({
    name: "paperclip_list_labels",
    description: "List your company's task labels. Set a task's labels with paperclip_update_task.",
    action: "tasks:read",
    input: z.object({}).strict(),
    run: async (caller, _args, api) => ({
      labels: rows(await api("GET", `/companies/${pathId(caller.companyId)}/labels`)).map(row => pick(row, LABEL_FIELDS)),
    }),
  }),
  tool({
    name: "paperclip_manage_labels",
    description: "Create, rename, recolour or delete the company's label definitions. Label names are unique in a company.",
    action: "labels:manage",
    input: z.object({
      create: z.array(z.object({ name: labelName, color: labelColor }).strict()).max(20).optional(),
      update: z.array(z.object({
        labelId: z.uuid(),
        name: labelName.optional().describe("New name"),
        color: labelColor.optional(),
      }).strict().refine(change => change.name !== undefined || change.color !== undefined, "Give a new name or color"))
        .max(20).optional().describe("Rename or recolour labels"),
      delete: z.array(z.uuid()).max(20).optional(),
    }).strict().refine(
      args => Boolean(args.create?.length || args.update?.length || args.delete?.length),
      "Supply labels to create, update or delete",
    ),
    run: async (caller, args, api) => {
      const created = [];
      for (const label of args.create ?? []) {
        created.push(pick(await api("POST", `/companies/${pathId(caller.companyId)}/labels`, label), LABEL_FIELDS));
      }
      const updated = [];
      for (const { labelId, ...change } of args.update ?? []) {
        try {
          updated.push(pick(await api("PATCH", `/labels/${pathId(labelId)}`, change), LABEL_FIELDS));
        } catch (error) {
          if (error instanceof McpToolError && error.code === "label_name_taken") {
            throw new McpToolError({
              status: 409, code: "label_name_taken",
              message: `Can't rename label ${labelId} to "${change.name}": another label in the company already has that name.`
                + ` Pick another name, or use the existing label (paperclip_list_labels).`
                + (created.length || updated.length ? ` Changes before this one were already made.` : ""),
            });
          }
          throw error;
        }
      }
      const deleted = [];
      for (const labelId of args.delete ?? []) {
        await api("DELETE", `/labels/${pathId(labelId)}`);
        deleted.push(labelId);
      }
      return { created, updated, deleted };
    },
  }),
];
