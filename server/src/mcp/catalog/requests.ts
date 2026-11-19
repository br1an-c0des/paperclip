import { createHash } from "node:crypto";
import { z } from "zod";
import { object, pathId, pick, rows, taskId, tool } from "./util.js";

const APPROVAL_FIELDS = ["id", "type", "status", "createdAt"] as const;

function questionSet(question: string, choices: string[] | undefined, multiple: boolean) {
  const base = { id: "answer", prompt: question, required: true };
  return {
    schema: "paperclip.question_set.v1",
    questions: [choices?.length
      ? { ...base, answerMode: multiple ? "multi_select" : "single_select", customAnswer: { enabled: true },
        options: choices.map((label, index) => ({ id: `choice-${index + 1}`, label })) }
      : { ...base, answerMode: "text" }],
  };
}

/** Questions to the board and approval requests. */
export const REQUEST_TOOLS = [
  tool({
    name: "paperclip_list_requests",
    description: "List the company's pending requests for the board (approvals, permission requests). Only the board decides them, in Paperclip.",
    action: "tasks:read",
    input: z.object({}).strict(),
    run: async (caller, _args, api) => ({
      requests: rows(await api("GET", `/companies/${pathId(caller.companyId)}/approvals?status=pending`)).map(row => {
        const payload = object(object(row).payload);
        const title = typeof payload.title === "string" ? payload.title : typeof payload.summary === "string" ? payload.summary : null;
        return { ...pick(row, ["id", "type", "status", "requestedByAgentId", "requestedByUserId", "createdAt"]), title };
      }),
    }),
  }),
  tool({
    name: "paperclip_ask_board",
    description: "Ask the board a question on a task, as a card in its thread, and put the task in review to wait for the answer (wait: false keeps its status).",
    action: "requests:create",
    input: z.object({
      taskId,
      question: z.string().trim().min(1).max(4000),
      choices: z.array(z.string().trim().min(1).max(200)).min(2).max(10).optional(),
      multiple: z.boolean().default(false),
      wait: z.boolean().default(true),
    }).strict(),
    run: async (_caller, args, api) => {
      const digest = createHash("sha256").update(JSON.stringify([args.question, args.choices ?? [], args.multiple])).digest("hex").slice(0, 16);
      const interaction = await api("POST", `/issues/${pathId(args.taskId)}/interactions`, {
        kind: "ask_user_questions",
        idempotencyKey: `mcp-ask:${args.taskId}:${digest}`,
        resolverPolicy: "human_only",
        continuationPolicy: "wake_assignee",
        payload: { version: 1, questionSet: questionSet(args.question, args.choices, args.multiple) },
      });
      if (args.wait) await api("PATCH", `/issues/${pathId(args.taskId)}`, { status: "in_review" });
      return { interaction: pick(interaction, ["id", "kind", "status"]), waiting: args.wait };
    },
  }),
  tool({
    name: "paperclip_request_approval",
    description: "Ask the board to approve a proposed action. You're woken with the decision.",
    action: "requests:create",
    input: z.object({
      title: z.string().trim().min(1).max(200),
      summary: z.string().trim().min(1).max(10000),
      recommendedAction: z.string().trim().max(2000).optional(),
      risks: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
      taskIds: z.array(z.uuid()).max(20).optional().describe("Tasks to link the approval to"),
    }).strict(),
    run: async (caller, { taskIds, ...payload }, api) => ({
      approval: pick(object(await api("POST", `/companies/${pathId(caller.companyId)}/approvals`, {
        type: "request_board_approval",
        payload: Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
        ...(taskIds?.length ? { issueIds: taskIds } : {}),
      })), APPROVAL_FIELDS),
    }),
  }),
];
