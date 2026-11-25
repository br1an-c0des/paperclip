import { describe, expect, it } from "vitest";
import { McpToolError } from "../dispatch.js";
import { REQUEST_TOOLS } from "./requests.js";
import { TEST_TASK_ID, recordingDispatch, testCaller, type RecordedCall } from "./test-support.js";

const review = REQUEST_TOOLS.find(definition => definition.name === "paperclip_request_plan_review")!;
const DOCUMENT = "55555555-5555-4555-8555-555555555555";
const REVISION = "66666666-6666-4666-8666-666666666666";
const CARD = "77777777-7777-4777-8777-777777777777";

const plan = { id: DOCUMENT, issueId: TEST_TASK_ID, key: "plan", latestRevisionId: REVISION, latestRevisionNumber: 3, latestBody: "# Plan" };

function api(respond: (call: RecordedCall) => unknown = () => ({})) {
  return recordingDispatch(call => {
    if (call.method === "GET" && call.path === "/issues/TES-1/documents/plan") return plan;
    return respond(call);
  });
}

const run = (args: unknown, dispatch: ReturnType<typeof api>) => review.run(testCaller(), review.input.parse(args), dispatch);

describe("paperclip_request_plan_review", () => {
  it("creates a plan review for the latest revision and puts the task in review", async () => {
    const dispatch = api(({ method }) => method === "POST" ? { id: CARD, kind: "request_confirmation", status: "pending" } : {});
    const result = await run({ taskId: "TES-1", note: "Check the migration step." }, dispatch);
    expect(result).toEqual({ interactionId: CARD, revisionNumber: 3, status: "pending" });
    expect(dispatch.calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /issues/TES-1/documents/plan",
      `POST /issues/${TEST_TASK_ID}/interactions`,
      `PATCH /issues/${TEST_TASK_ID}`,
    ]);
    expect(dispatch.calls[1].body).toEqual({
      kind: "request_confirmation",
      idempotencyKey: `mcp-plan-review:${TEST_TASK_ID}:${REVISION}`,
      resolverPolicy: "human_only",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        prompt: "Review the plan (revision 3): accept it, or request changes.",
        acceptLabel: "Accept plan",
        rejectLabel: "Request changes",
        rejectRequiresReason: true,
        rejectReasonLabel: "What should change?",
        detailsMarkdown: "Check the migration step.",
        // The target plan-review-context.ts readPlanTarget reads, and the plan_accepted wake follows.
        target: { type: "issue_document", key: "plan", issueId: TEST_TASK_ID, documentId: DOCUMENT, revisionId: REVISION, revisionNumber: 3 },
      },
    });
    expect(dispatch.calls[2].body).toEqual({ status: "in_review" });
    expect(review.action).toBe("requests:create");
  });

  it("the same revision twice gives one card", async () => {
    // The route answers a matching retry with the same card; a call that differs (another note,
    // another run) gets a 409 for the key, and the tool returns the card that key already made.
    const dispatch = api(({ method, path }) => {
      if (method === "POST") throw new McpToolError({ status: 409, message: "Interaction idempotency key already exists for a different request" });
      if (method === "GET" && path === `/issues/${TEST_TASK_ID}/interactions`) {
        return [
          { id: "other", idempotencyKey: `mcp-plan-review:${TEST_TASK_ID}:another-revision`, status: "rejected" },
          { id: CARD, idempotencyKey: `mcp-plan-review:${TEST_TASK_ID}:${REVISION}`, status: "pending" },
        ];
      }
      return {};
    });
    expect(await run({ taskId: "TES-1", note: "Another note" }, dispatch)).toEqual({ interactionId: CARD, revisionNumber: 3, status: "pending" });
    expect(dispatch.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(dispatch.calls.at(-1)).toEqual({ method: "PATCH", path: `/issues/${TEST_TASK_ID}`, body: { status: "in_review" } });
  });

  it("a revision already decided keeps the task's status", async () => {
    const dispatch = api(({ method }) => method === "POST" ? { id: CARD, status: "accepted" } : {});
    expect(await run({ taskId: "TES-1" }, dispatch)).toEqual({ interactionId: CARD, revisionNumber: 3, status: "accepted" });
    expect(dispatch.calls.map(call => call.method)).toEqual(["GET", "POST"]);
    expect((dispatch.calls[1].body as { payload: Record<string, unknown> }).payload).not.toHaveProperty("detailsMarkdown");
  });

  it("no plan document is refused, and nothing is created", async () => {
    const missing = recordingDispatch(() => { throw new McpToolError({ status: 404, message: "Document not found" }); });
    const error = await review.run(testCaller(), review.input.parse({ taskId: "TES-1" }), missing).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ status: 409, code: "plan_missing" });
    expect((error as Error).message).toMatch(/no plan document.*paperclip_write_document/);
    expect(missing.calls).toHaveLength(1);

    // A task that isn't there (or can't be read) keeps the route's own answer.
    const noTask = new McpToolError({ status: 404, message: "Issue not found" });
    await expect(review.run(testCaller(), review.input.parse({ taskId: "TES-9" }), recordingDispatch(() => { throw noTask; }))).rejects.toBe(noTask);
  });

  it("a conflict that isn't the same revision's card passes through", async () => {
    const closed = new McpToolError({ status: 409, message: "Cannot create an interaction on a closed issue" });
    const dispatch = api(({ method }) => {
      if (method === "POST") throw closed;
      return [];
    });
    await expect(run({ taskId: "TES-1" }, dispatch)).rejects.toBe(closed);
    expect(dispatch.calls.some(call => call.method === "PATCH")).toBe(false);
  });

  it("the note is optional and bounded", () => {
    expect(() => review.input.parse({ taskId: "TES-1", note: "x".repeat(2001) })).toThrow();
    expect(() => review.input.parse({ taskId: "TES-1", extra: true })).toThrow();
  });
});
