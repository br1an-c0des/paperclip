import type { IssueComment } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { EARLIER_PAGE, firstPage, historyComments, isChatWindow, listPage, oldestLoadedAt } from "./history-model";

const comment = (id: string, createdAt = "2026-10-28T10:00:00Z") => ({ id, createdAt, body: id }) as unknown as IssueComment;

describe("chat history pages", () => {
  it("reads the chat window's oldest message as the cursor for earlier pages", () => {
    const recent = { latestCommentId: "c20", oldestCommentId: "c1", hasMore: true, comments: [comment("c20"), comment("c1")] };
    expect(isChatWindow(recent)).toBe(true);
    expect(firstPage(recent)).toEqual({ comments: recent.comments, next: "c1" });
  });

  it("stops when the window holds the whole chat", () => {
    expect(firstPage({ latestCommentId: "c2", oldestCommentId: "c1", hasMore: false, comments: [comment("c2"), comment("c1")] }).next).toBeNull();
    expect(firstPage({ latestCommentId: null, oldestCommentId: null, hasMore: false, comments: [] }).next).toBeNull();
  });

  it("tells a server from before #18358 by the missing oldestCommentId", () => {
    expect(isChatWindow({ latestCommentId: "c5", hasMore: true, comments: [comment("c5")] })).toBe(false);
  });

  it("pages on while a page comes back full", () => {
    const full = Array.from({ length: EARLIER_PAGE }, (_, index) => comment(`e${index}`));
    expect(listPage(full, EARLIER_PAGE).next).toBe(`e${EARLIER_PAGE - 1}`);
    expect(listPage(full.slice(0, 3), EARLIER_PAGE).next).toBeNull();
  });

  it("flattens pages newest first and draws a message that moved between pages once", () => {
    const pages = [
      { comments: [comment("c3"), comment("c2")], next: "c2" },
      { comments: [comment("c2"), comment("c1", "2026-10-01T09:00:00Z")], next: null },
    ];
    expect(historyComments(pages).map((row) => row.id)).toEqual(["c3", "c2", "c1"]);
    expect(oldestLoadedAt(pages)).toBe("2026-10-01T09:00:00Z");
    expect(historyComments(undefined)).toEqual([]);
  });
});
