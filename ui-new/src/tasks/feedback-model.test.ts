import type { FeedbackVote } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { savedVoteTitle, voteSharing, votesByComment, withVote } from "./feedback-model";

const vote = (overrides: Partial<FeedbackVote> = {}): FeedbackVote => ({
  id: "v1",
  companyId: "co1",
  issueId: "t1",
  targetType: "issue_comment",
  targetId: "c1",
  authorUserId: "me",
  vote: "up",
  reason: null,
  sharedWithLabs: false,
  sharedAt: null,
  consentVersion: null,
  redactionSummary: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

describe("feedback votes", () => {
  it("keys your votes by comment, leaving document votes out", () => {
    const map = votesByComment([vote(), vote({ id: "v2", targetType: "issue_document_revision", targetId: "d1" })]);
    expect([...map.keys()]).toEqual(["c1"]);
    expect([...votesByComment([vote(), vote({ id: "v2", targetType: "issue_document_revision", targetId: "d1" })], "issue_document_revision").keys()]).toEqual(["d1"]);
  });

  it("records a vote on a document revision under its own target", () => {
    const added = withVote([vote()], { taskId: "t1", commentId: "rev-1", vote: "up", targetType: "issue_document_revision" }, "me");
    expect(added.find((each) => each.targetId === "rev-1")?.targetType).toBe("issue_document_revision");
    expect(added).toHaveLength(2);
  });

  it("asks under 'Ask each time' and follows the setting otherwise", () => {
    expect(voteSharing("prompt")).toBe("ask");
    expect(voteSharing(undefined)).toBe("ask");
    expect(voteSharing("allowed")).toEqual({ allowSharing: true });
    expect(voteSharing("not_allowed")).toEqual({ allowSharing: false });
  });

  it("words the toast as the old UI does", () => {
    expect(savedVoteTitle("prompt", true)).toBe("Feedback saved. Future votes will share");
    expect(savedVoteTitle("prompt", false)).toBe("Feedback saved. Future votes will stay local");
    expect(savedVoteTitle("allowed", true)).toBe("Feedback saved and sharing enabled");
    expect(savedVoteTitle("not_allowed", false)).toBe("Feedback saved");
  });

  it("puts your vote in place before the server answers", () => {
    const changed = withVote([vote()], { taskId: "t1", commentId: "c1", vote: "down", reason: " Missed the tests " }, "me");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ vote: "down", reason: "Missed the tests" });
    const added = withVote([vote()], { taskId: "t1", commentId: "c2", vote: "up" }, "me");
    expect(added.map((entry) => entry.targetId)).toEqual(["c1", "c2"]);
  });
});
