import { z } from "zod";
import { AGENT_ACCESS_ACTIONS, type RunDisposition } from "@paperclipai/shared";
import { McpToolError } from "../dispatch.js";
import type { CatalogDeps } from "./index.js";
import type { McpCaller, PaperclipTool } from "./types.js";
import { COMMENT_FIELDS, DOCUMENT_FIELDS, pathId, pick, rows, tool } from "./util.js";
import { toolVisibility } from "./visibility.js";

const UPDATE_TASK = ["tasks:update_own", "tasks:update_any"] as const;
const summary = z.string().trim().min(1).max(50000);

function requireRun(caller: McpCaller): string {
  if (!caller.runId) {
    throw new McpToolError({ status: 403, code: "run_required", message: "This tool works only during a run, with the run's own token." });
  }
  return caller.runId;
}

/** The run's task id, or a clear refusal when the run isn't task-bound. */
async function runTaskId(deps: CatalogDeps, caller: McpCaller): Promise<string> {
  const { taskId } = await deps.runTask(requireRun(caller));
  if (!taskId) {
    throw new McpToolError({ status: 409, code: "run_without_task", message: "This run isn't bound to a task; use paperclip_update_task on the task you mean." });
  }
  return taskId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The unblock owner: "me", "board", an agent id (UUID), or else a user id. */
function blockOwner(owner: string, caller: McpCaller): "board" | { agentId: string } | { userId: string } {
  if (owner === "me") return { agentId: caller.agentId! };
  if (owner === "board") return "board";
  return UUID.test(owner) ? { agentId: owner } : { userId: owner };
}

function disposition(input: Omit<RunDisposition, "at" | "via">): RunDisposition {
  return { ...input, at: new Date().toISOString(), via: "tool" };
}

/**
 * Identity, the current task's context, and how a run ends its work. `catalog` is the full catalog,
 * read by `paperclip_me` to explain hidden tools.
 */
export function createRunTools(deps: CatalogDeps, catalog: () => readonly PaperclipTool[]): PaperclipTool[] {
  return [
    tool({
      name: "paperclip_me",
      description: "Who you are, your company and access, and which Paperclip tools are hidden from you or need approval, and why.",
      action: "tasks:read",
      input: z.object({}).strict(),
      run: async (caller, _args, api) => {
        const visibility = catalog().map(definition => ({ name: definition.name, visibility: toolVisibility(caller, definition) }));
        return {
          kind: caller.kind,
          // A connection acting as the person has no agent: it acts as them, and assigning a task
          // to an agent never impersonates that agent.
          ...(caller.agentId
            ? { agent: pick(await api("GET", "/agents/me"), ["id", "name", "role", "title", "status", "reportsTo"]) }
            : { user: { id: caller.userId } }),
          ...(caller.grantId ? { connectionId: caller.grantId } : {}),
          companyId: caller.companyId,
          runId: caller.runId,
          access: {
            allowed: AGENT_ACCESS_ACTIONS.filter(action => caller.access[action] !== false),
            scoped: Object.fromEntries(AGENT_ACCESS_ACTIONS.flatMap(action => {
              const value = caller.access[action];
              return typeof value === "object" ? [[action, value.scope]] : [];
            })),
          },
          hiddenTools: visibility.flatMap(({ name, visibility: v }) => v.state === "hidden" ? [{ name, reason: v.reason }] : []),
          needsApproval: visibility.flatMap(({ name, visibility: v }) => v.state === "needs_approval" ? [name] : []),
        };
      },
    }),
    tool({
      name: "paperclip_task_context",
      description: "Start here in a run: the run's task, its ancestors, project and goal, the comment that woke you, recent comments and the documents index.",
      action: "tasks:read",
      needsRun: true,
      input: z.object({}).strict(),
      run: async (caller, _args, api) => {
        const run = await deps.runTask(requireRun(caller));
        if (!run.taskId) return { taskId: null, note: "This run isn't bound to a task." };
        const base = `/issues/${pathId(run.taskId)}`;
        const wake = run.wakeCommentId ? `?wakeCommentId=${pathId(run.wakeCommentId)}` : "";
        const context = await api("GET", `${base}/heartbeat-context${wake}`);
        const comments = rows(await api("GET", `${base}/comments?order=desc&limit=10`));
        const documents = rows(await api("GET", `${base}/documents`));
        return {
          taskId: run.taskId,
          context,
          recentComments: comments.map(row => pick(row, COMMENT_FIELDS)),
          documents: documents.map(row => pick(row, DOCUMENT_FIELDS.filter(field => field !== "body"))),
        };
      },
    }),
    tool({
      name: "paperclip_report_progress",
      description: "Post a progress comment on the run's task. With continue: true it also ends this run, saying the work carries on in a later run.",
      action: "tasks:comment",
      needsRun: true,
      requestable: false,
      input: z.object({ summary, continue: z.boolean().default(false) }).strict(),
      run: async (caller, args, api) => {
        const taskId = await runTaskId(deps, caller);
        const comment = await api("POST", `/issues/${pathId(taskId)}/comments`, { body: args.summary });
        if (args.continue) {
          await deps.recordDisposition(caller.runId!, disposition({ kind: "continuing", tool: "paperclip_report_progress", summary: args.summary }));
        }
        return { comment: pick(comment, ["id", "createdAt"]), continuing: args.continue };
      },
    }),
    tool({
      name: "paperclip_finish",
      description: "End the run's work: set its task to done (or in_review) with a summary comment. Every run ends with this or paperclip_block.",
      action: UPDATE_TASK,
      needsRun: true,
      requestable: false,
      input: z.object({ summary, status: z.enum(["done", "in_review"]).default("done") }).strict(),
      run: async (caller, args, api) => {
        const taskId = await runTaskId(deps, caller);
        const task = await api("PATCH", `/issues/${pathId(taskId)}`, { status: args.status, comment: args.summary });
        await deps.recordDisposition(caller.runId!, disposition({ kind: "finished", tool: "paperclip_finish", taskStatus: args.status, summary: args.summary }));
        return { task: pick(task, ["id", "identifier", "status"]), disposition: "finished" };
      },
    }),
    tool({
      name: "paperclip_block",
      description: "End the run's work as blocked: say who must act (owner, default you) and exactly what unblocks it.",
      action: UPDATE_TASK,
      needsRun: true,
      requestable: false,
      input: z.object({
        summary,
        unblockAction: z.string().trim().min(1).max(2000),
        owner: z.string().trim().min(1).max(200).default("me").describe('Who must act: "me", "board", an agent id, or a user id'),
        blockedByTaskIds: z.array(z.uuid()).max(100).optional(),
      }).strict(),
      run: async (caller, args, api) => {
        const taskId = await runTaskId(deps, caller);
        const owner = blockOwner(args.owner, caller);
        const blockedOwner = owner === "board" ? "board" : "agentId" in owner ? `agent:${owner.agentId}` : `user:${owner.userId}`;
        const task = await api("PATCH", `/issues/${pathId(taskId)}`, {
          status: "blocked",
          comment: args.summary,
          unblockDescriptor: { owner, action: args.unblockAction },
          ...(args.blockedByTaskIds ? { blockedByIssueIds: args.blockedByTaskIds } : {}),
        });
        await deps.recordDisposition(caller.runId!, disposition({
          kind: "blocked", tool: "paperclip_block", taskStatus: "blocked", summary: args.summary, blockedOwner, unblockAction: args.unblockAction,
        }));
        return { task: pick(task, ["id", "identifier", "status"]), disposition: "blocked" };
      },
    }),
  ];
}
