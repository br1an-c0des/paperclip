import { z } from "zod";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@paperclipai/shared";
import { COMMENT_FIELDS, TASK_FIELDS, TASK_ROW_FIELDS, pathId, pick, rows, taskId, tool } from "./util.js";

const uuid = z.uuid();
const status = z.enum(ISSUE_STATUSES);
const priority = z.enum(ISSUE_PRIORITIES);
const UPDATE_TASK = ["tasks:update_own", "tasks:update_any"] as const;

/** Maps the tool's `blockedByTaskIds` onto the API's `blockedByIssueIds`, dropping unset fields. */
function taskBody(args: Record<string, unknown>) {
  const { blockedByTaskIds, ...rest } = args;
  return Object.fromEntries(Object.entries({
    ...rest, ...(blockedByTaskIds !== undefined ? { blockedByIssueIds: blockedByTaskIds } : {}),
  }).filter(([, value]) => value !== undefined));
}

const taskChanges = {
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(524288).nullable().optional(),
  status: status.optional(),
  priority: priority.optional(),
  assigneeAgentId: uuid.nullable().optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  projectId: uuid.nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  labelIds: z.array(uuid).max(50).optional().describe("Replaces the task's labels"),
  blockedByTaskIds: z.array(uuid).max(100).optional().describe("Replaces the task's blockers"),
};

export const TASK_TOOLS = [
  tool({
    name: "paperclip_search_tasks",
    description: "Find tasks in your company by text, status, assignee, project or label.",
    action: "tasks:read",
    input: z.object({
      query: z.string().trim().max(300).optional(),
      status: z.array(status).max(ISSUE_STATUSES.length).optional(),
      assigneeAgentId: uuid.optional(),
      projectId: uuid.optional(),
      labelId: uuid.optional(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    run: async (caller, args, api) => {
      const query = new URLSearchParams({ limit: String(args.limit), offset: String(args.offset) });
      if (args.query) query.set("q", args.query);
      if (args.status?.length) query.set("status", args.status.join(","));
      for (const key of ["assigneeAgentId", "projectId", "labelId"] as const) if (args[key]) query.set(key, args[key]);
      const tasks = rows(await api("GET", `/companies/${pathId(caller.companyId)}/issues?${query}`));
      return { tasks: tasks.map(row => pick(row, TASK_ROW_FIELDS)) };
    },
  }),
  tool({
    name: "paperclip_read_task",
    description: "Read a task and its latest comments.",
    action: "tasks:read",
    input: z.object({ taskId, comments: z.number().int().min(0).max(100).default(20) }).strict(),
    run: async (_caller, args, api) => {
      const task = await api("GET", `/issues/${pathId(args.taskId)}`);
      const comments = args.comments === 0 ? []
        : rows(await api("GET", `/issues/${pathId(args.taskId)}/comments?order=desc&limit=${args.comments}`));
      return { task: pick(task, TASK_FIELDS), comments: comments.map(row => pick(row, COMMENT_FIELDS)) };
    },
  }),
  tool({
    name: "paperclip_create_task",
    description: "Create a task, such as a subtask (parentId) or a handoff to another agent. Assigning it to an agent may start work.",
    action: "tasks:create",
    input: z.object({
      title: z.string().trim().min(1).max(240),
      description: z.string().max(524288).optional(),
      parentId: z.string().min(1).optional(),
      projectId: uuid.optional(),
      assigneeAgentId: uuid.optional(),
      assigneeUserId: z.string().min(1).optional(),
      priority: priority.optional(),
      status: z.enum(["backlog", "todo"]).optional(),
      labelIds: z.array(uuid).max(50).optional(),
      blockedByTaskIds: z.array(uuid).max(100).optional(),
    }).strict(),
    run: async (caller, args, api) => ({
      task: pick(await api("POST", `/companies/${pathId(caller.companyId)}/issues`, taskBody(args)), TASK_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_update_task",
    description: "Change a task's fields, status, assignee, labels, parent or blockers; an optional comment is posted with the change.",
    action: UPDATE_TASK,
    input: z.object({ taskId, ...taskChanges, comment: z.string().trim().min(1).max(50000).optional() })
      .strict()
      .refine(args => Object.keys(args).some(key => key !== "taskId"), "Supply at least one change"),
    run: async (_caller, { taskId: id, ...changes }, api) => ({
      task: pick(await api("PATCH", `/issues/${pathId(id)}`, taskBody(changes)), TASK_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_archive_task",
    description: "Archive a task (hide it from lists), or restore it with archived: false.",
    action: UPDATE_TASK,
    input: z.object({ taskId, archived: z.boolean().default(true) }).strict(),
    run: async (_caller, args, api) => ({
      task: pick(await api("PATCH", `/issues/${pathId(args.taskId)}`, { hiddenAt: args.archived ? new Date().toISOString() : null }), TASK_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_delete_task",
    description: "Permanently delete a task. Prefer paperclip_archive_task unless deletion is really meant.",
    action: "tasks:delete",
    input: z.object({ taskId }).strict(),
    run: async (_caller, args, api) => {
      await api("DELETE", `/issues/${pathId(args.taskId)}`);
      return { deleted: true, taskId: args.taskId };
    },
  }),
  tool({
    name: "paperclip_add_comment",
    description: "Comment on a task. A comment can wake the task's assignee.",
    action: "tasks:comment",
    input: z.object({ taskId, body: z.string().trim().min(1).max(50000) }).strict(),
    run: async (_caller, args, api) => ({
      comment: pick(await api("POST", `/issues/${pathId(args.taskId)}/comments`, { body: args.body }), COMMENT_FIELDS),
    }),
  }),
];
