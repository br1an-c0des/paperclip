import { z } from "zod";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@paperclipai/shared";
import { COMMENT_FIELDS, TASK_FIELDS, TASK_ROW_FIELDS, object, pathId, pick, rows, taskId, tool } from "./util.js";

const uuid = z.uuid();
const status = z.enum(ISSUE_STATUSES);
const priority = z.enum(ISSUE_PRIORITIES);
const UPDATE_TASK = ["tasks:update_own", "tasks:update_any"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who must act on a blocked task: "board", an agent id (UUID), or a user id. */
function unblockOwner(owner: string) {
  if (owner === "board") return "board";
  return UUID.test(owner) ? { agentId: owner } : { userId: owner };
}

/**
 * Maps the tool's `blockedByTaskIds` onto the API's `blockedByIssueIds` and `unblock` onto its
 * `unblockDescriptor`, dropping unset fields.
 */
function taskBody(args: Record<string, unknown>) {
  const { blockedByTaskIds, unblock, ...rest } = args;
  const descriptor = unblock && typeof unblock === "object"
    ? { owner: unblockOwner(String((unblock as Record<string, unknown>).owner)), action: (unblock as Record<string, unknown>).action }
    : undefined;
  return Object.fromEntries(Object.entries({
    ...rest,
    ...(blockedByTaskIds !== undefined ? { blockedByIssueIds: blockedByTaskIds } : {}),
    ...(descriptor ? { unblockDescriptor: descriptor } : {}),
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
  unblock: z.object({
    owner: z.string().trim().min(1).max(200).describe('"board", an agent id or a user id'),
    action: z.string().trim().min(1).max(2000),
  }).strict().optional().describe("With status blocked: who must act and what unblocks it"),
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
    description: "Read a task and its latest comments (and, with history: true, its activity).",
    action: "tasks:read",
    input: z.object({ taskId, comments: z.number().int().min(0).max(100).default(20), history: z.boolean().default(false) }).strict(),
    run: async (_caller, args, api) => {
      const task = await api("GET", `/issues/${pathId(args.taskId)}`);
      const comments = args.comments === 0 ? []
        : rows(await api("GET", `/issues/${pathId(args.taskId)}/comments?order=desc&limit=${args.comments}`));
      const history = args.history
        ? rows(await api("GET", `/issues/${pathId(args.taskId)}/activity?limit=30`)).slice(0, 30).map(row => pick(row, ["id", "action", "actorType", "actorId", "createdAt"]))
        : undefined;
      return { task: pick(task, TASK_FIELDS), comments: comments.map(row => pick(row, COMMENT_FIELDS)), ...(history ? { history } : {}) };
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
      initialPlan: z.string().trim().min(1).max(200000).optional()
        .describe("Markdown saved as the new task's plan document, before its assignee starts"),
    }).strict(),
    run: async (caller, args, api) => ({
      task: pick(await api("POST", `/companies/${pathId(caller.companyId)}/issues`, taskBody(args)), TASK_FIELDS),
    }),
  }),
  tool({
    name: "paperclip_update_task",
    description: "Change a task's fields, status, assignee, labels, parent or blockers; an optional comment is posted with the change. With onlyIfProvisional, sets only a provisional title (your run's own task).",
    action: UPDATE_TASK,
    input: z.object({
      taskId, ...taskChanges, comment: z.string().trim().min(1).max(50000).optional(),
      onlyIfProvisional: z.boolean().optional()
        .describe("true: set only the title, and only while it's still the provisional one taken from the prompt. Send it with title alone"),
    })
      .strict()
      .refine(args => Object.keys(args).some(key => key !== "taskId" && key !== "onlyIfProvisional"), "Supply at least one change")
      .refine(args => !args.onlyIfProvisional || (args.title !== undefined
        && Object.keys(args).every(key => key === "taskId" || key === "title" || key === "onlyIfProvisional")),
      "onlyIfProvisional goes with title alone; send other changes in a separate call"),
    run: async (_caller, { taskId: id, onlyIfProvisional, ...changes }, api) => {
      // The title route keeps a title someone already chose, and reports whether it changed it.
      if (onlyIfProvisional) {
        const result = object(await api("PUT", `/issues/${pathId(id)}/title`, { title: changes.title, onlyIfProvisional: true }));
        return { task: pick(result, ["id", "title", "titleNeedsGeneration"]), changed: result.changed === true };
      }
      return { task: pick(await api("PATCH", `/issues/${pathId(id)}`, taskBody(changes)), TASK_FIELDS) };
    },
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
