import { describe, expect, it } from "vitest";
import { TASK_TOOLS } from "./tasks.js";
import { TEST_AGENT_ID, TEST_TASK_ID, recordingDispatch, testCaller } from "./test-support.js";

const readTask = TASK_TOOLS.find(definition => definition.name === "paperclip_read_task")!;
const USER_ID = "user-brian";
const OTHER_AGENT_ID = "55555555-5555-4555-8555-555555555555";

const REQUEST = {
  id: "66666666-6666-4666-8666-666666666666", kind: "ask_user_questions", status: "answered", title: null, aboutPlan: false,
  questions: [{ id: "where", prompt: "Where should the switch go?", options: [{ id: "both", label: "Both places" }] }],
  answers: [{ questionId: "where", optionIds: ["both"], otherText: null }],
  outcome: null, note: null, summary: null,
  askedBy: { type: "agent", id: TEST_AGENT_ID }, decidedBy: { type: "user", id: USER_ID },
  askedAt: "2026-11-24T17:41:00.000Z", decidedAt: "2026-11-24T17:45:00.000Z",
};

function api() {
  return recordingDispatch(({ path }) => {
    if (path === `/issues/${TEST_TASK_ID}`) return { id: TEST_TASK_ID, identifier: "TES-45", title: "Theme switch", secret: "kept out" };
    if (path.startsWith(`/issues/${TEST_TASK_ID}/comments`)) return [
      { id: "c2", body: "Done.", authorAgentId: OTHER_AGENT_ID, authorUserId: null, createdAt: "2026-11-24T17:50:00.000Z" },
      { id: "c1", body: "Go with idea 2.", authorAgentId: null, authorUserId: USER_ID, createdAt: "2026-11-24T17:37:00.000Z" },
      { id: "c0", body: "Who am I?", authorAgentId: null, authorUserId: "unknown-user", createdAt: "2026-11-24T17:30:00.000Z" },
    ];
    if (path === `/issues/${TEST_TASK_ID}/request-history`) return {
      requests: [REQUEST],
      names: { [`agent:${TEST_AGENT_ID}`]: "Coder", [`agent:${OTHER_AGENT_ID}`]: "Reviewer", [`user:${USER_ID}`]: "Brian" },
    };
    return [];
  });
}

describe("paperclip_read_task", () => {
  it("reads requests when asked", async () => {
    const dispatch = api();
    const result = await readTask.run(testCaller(), readTask.input.parse({ taskId: TEST_TASK_ID, comments: 0, requests: true }), dispatch);
    expect(dispatch.calls.map(call => `${call.method} ${call.path}`)).toEqual([
      `GET /issues/${TEST_TASK_ID}`, `GET /issues/${TEST_TASK_ID}/request-history`,
    ]);
    expect(result).toEqual({
      task: { id: TEST_TASK_ID, identifier: "TES-45", title: "Theme switch" },
      comments: [],
      requests: [{ ...REQUEST, askedByName: "Coder", decidedByName: "Brian" }],
    });
  });

  it("adds authorName to comments", async () => {
    const dispatch = api();
    const result = await readTask.run(testCaller(), readTask.input.parse({ taskId: TEST_TASK_ID }), dispatch) as {
      comments: Array<Record<string, unknown>>;
    };
    expect(dispatch.calls.map(call => call.path)).toEqual([
      `/issues/${TEST_TASK_ID}`, `/issues/${TEST_TASK_ID}/comments?order=desc&limit=20`, `/issues/${TEST_TASK_ID}/request-history`,
    ]);
    expect(result.comments.map(comment => comment.authorName)).toEqual(["Reviewer", "Brian", undefined]);
    // An unknown author gets no authorName key at all.
    expect(result.comments[2]).not.toHaveProperty("authorName");
    expect(result).not.toHaveProperty("requests");
  });

  it("doesn't call the request history without requests or comments", async () => {
    const dispatch = api();
    const result = await readTask.run(testCaller(), readTask.input.parse({ taskId: TEST_TASK_ID, comments: 0 }), dispatch);
    expect(dispatch.calls.map(call => call.path)).toEqual([`/issues/${TEST_TASK_ID}`]);
    expect(result).toEqual({ task: { id: TEST_TASK_ID, identifier: "TES-45", title: "Theme switch" }, comments: [] });
  });

  it("an identifier goes into the path encoded, and history still reads the activity", async () => {
    const dispatch = recordingDispatch(() => []);
    await readTask.run(testCaller(), readTask.input.parse({ taskId: "TES-45", comments: 0, requests: true, history: true }), dispatch);
    expect(dispatch.calls.map(call => call.path)).toEqual([
      "/issues/TES-45", "/issues/TES-45/request-history", "/issues/TES-45/activity?limit=30",
    ]);
  });

  it("requests is a boolean, off by default", () => {
    expect(readTask.input.parse({ taskId: TEST_TASK_ID })).toMatchObject({ requests: false, history: false, comments: 20 });
    expect(() => readTask.input.parse({ taskId: TEST_TASK_ID, requests: "yes" })).toThrow();
  });
});
