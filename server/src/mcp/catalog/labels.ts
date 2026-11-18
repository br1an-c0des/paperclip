import { z } from "zod";
import { pathId, pick, rows, tool } from "./util.js";

const LABEL_FIELDS = ["id", "name", "color"] as const;

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
    description: "Create or delete label definitions for the company.",
    action: "labels:manage",
    input: z.object({
      create: z.array(z.object({
        name: z.string().trim().min(1).max(48),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("#rrggbb"),
      }).strict()).max(20).optional(),
      delete: z.array(z.uuid()).max(20).optional(),
    }).strict().refine(args => Boolean(args.create?.length || args.delete?.length), "Supply labels to create or delete"),
    run: async (caller, args, api) => {
      const created = [];
      for (const label of args.create ?? []) {
        created.push(pick(await api("POST", `/companies/${pathId(caller.companyId)}/labels`, label), LABEL_FIELDS));
      }
      const deleted = [];
      for (const labelId of args.delete ?? []) {
        await api("DELETE", `/labels/${pathId(labelId)}`);
        deleted.push(labelId);
      }
      return { created, deleted };
    },
  }),
];
