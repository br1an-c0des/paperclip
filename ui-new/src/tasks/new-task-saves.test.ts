import { QueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWriteQueue } from "@/lib/offline/write-runner";
import type { WriteRequest } from "@/lib/offline/write-queue";
import { memoryStorage } from "@/test/offline";
import { clearToasts, toasts } from "@/ui/Toast";
import { emptyDraft, loadDraft, saveDraft } from "./new-task";
import {
  canReopen,
  draftFingerprint,
  holdSubmitted,
  landNewTask,
  loadSubmission,
  newTaskFailed,
  onNewTaskFailed,
  resetNewTaskSaves,
  restoreDraft,
  saveSubmission,
  takeRestoring,
} from "./new-task-saves";
import { taskWrite } from "./task-write";

// U153 (#20831): new tasks saved in the background.

const COMPANY = "company-1";
const ISSUE = { id: "33333333-3333-4333-8333-333333333333", identifier: "TES-9", title: "Write the report" };

function makeWrite(overrides: { title?: string; files?: string[]; openAfter?: boolean; key?: string } = {}) {
  const draft = emptyDraft({ title: overrides.title ?? "Write the report", projectId: "project-1" });
  return taskWrite({
    userId: "user-1",
    companyId: COMPANY,
    issuePrefix: "TES",
    payload: { title: draft.title, projectId: draft.projectId, idempotencyKey: overrides.key ?? "key-1" },
    idempotencyKey: overrides.key ?? "key-1",
    caseLink: null,
    draft,
    fingerprint: draftFingerprint(draft),
    fileNames: overrides.files,
    openAfter: overrides.openAfter,
  });
}

const file = (name: string) => new File(["x"], name, { type: "text/plain" });

beforeEach(() => {
  localStorage.clear();
  resetNewTaskSaves();
  clearToasts();
});
afterEach(() => clearToasts());

describe("the draft's fingerprint and creation key", () => {
  it("is the same for the same draft in any field order", () => {
    const draft = emptyDraft({ title: "A", labelIds: ["b", "a"] });
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as typeof draft;
    expect(draftFingerprint(reordered)).toBe(draftFingerprint(draft));
    expect(draftFingerprint({ ...draft, title: "B" })).not.toBe(draftFingerprint(draft));
  });

  it("keeps the key beside the draft, per company", () => {
    saveSubmission(COMPANY, { fingerprint: "f", key: "k" });
    expect(loadSubmission(COMPANY)).toEqual({ fingerprint: "f", key: "k" });
    expect(loadSubmission("company-2")).toBeNull();
    saveSubmission(COMPANY, null);
    expect(loadSubmission(COMPANY)).toBeNull();
  });

  it("keeps the draft and the key in the write", () => {
    const write = makeWrite({ files: ["a.png"], openAfter: true });
    expect(write.idempotencyKey).toBe("key-1");
    expect(write.request.body.idempotencyKey).toBe("key-1");
    expect(write.restore?.draft.title).toBe("Write the report");
    expect(write.after).toMatchObject({ fileNames: ["a.png"], openAfter: true, issuePrefix: "TES" });
  });
});

describe("landing", () => {
  const client = () => new QueryClient();

  it("uploads the held files once the task exists, then says so", async () => {
    const write = makeWrite({ files: ["a.txt", "b.txt"] });
    holdSubmitted(write.id, [file("a.txt"), file("b.txt")]);
    const upload = vi.fn(async (_company: string, _issue: string, _file: File) => ({}) as never);
    await landNewTask(client(), write, ISSUE, undefined, upload);
    expect(upload.mock.calls.map((call) => [call[0], call[1], (call[2] as File).name])).toEqual([
      [COMPANY, ISSUE.id, "a.txt"],
      [COMPANY, ISSUE.id, "b.txt"],
    ]);
    expect(toasts()[0]).toMatchObject({ tone: "success", title: "Created TES-9", body: "Write the report" });
  });

  it("names files a reload lost", async () => {
    const write = makeWrite({ files: ["a.txt"] });
    const upload = vi.fn();
    await landNewTask(client(), write, ISSUE, undefined, upload);
    expect(upload).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatchObject({ tone: "warn", body: expect.stringContaining("Attach them again: a.txt") });
  });

  it("opens it after Create and open only while it's the last task created here", async () => {
    const navigate = vi.fn();
    const first = makeWrite({ openAfter: true, key: "key-1" });
    holdSubmitted(first.id, []);
    const second = makeWrite({ title: "Next", key: "key-2" });
    holdSubmitted(second.id, []);
    await landNewTask(client(), first, ISSUE, navigate);
    expect(navigate).not.toHaveBeenCalled();

    const third = makeWrite({ openAfter: true, key: "key-3" });
    holdSubmitted(third.id, []);
    await landNewTask(client(), third, ISSUE, navigate);
    expect(navigate).toHaveBeenCalledWith("/TES/issues/TES-9");
  });
});

describe("a failed save", () => {
  it("reopens only into a free dialog in the same company", () => {
    const write = makeWrite();
    expect(canReopen(write, { companyId: COMPANY, dialogOpen: false })).toBe(true);
    expect(canReopen(write, { companyId: COMPANY, dialogOpen: true })).toBe(false);
    expect(canReopen(write, { companyId: "company-2", dialogOpen: false })).toBe(false);
    saveDraft(COMPANY, emptyDraft({ title: "Another draft" }));
    expect(canReopen(write, { companyId: COMPANY, dialogOpen: false })).toBe(false);
  });

  it("puts back its draft, key, error and files", () => {
    const write = { ...makeWrite({ files: ["a.txt"] }), status: "failed" as const, error: "Title is too long" };
    const held = [file("a.txt")];
    holdSubmitted(write.id, held);
    restoreDraft(write);
    expect(loadDraft(COMPANY)?.title).toBe("Write the report");
    expect(loadSubmission(COMPANY)).toEqual({ fingerprint: write.restore!.fingerprint, key: "key-1" });
    // The reopened draft, unchanged, fingerprints the same, so it's sent again with the same key.
    expect(draftFingerprint(loadDraft(COMPANY)!)).toBe(write.restore!.fingerprint);
    expect(takeRestoring(COMPANY)).toEqual({ error: "Title is too long", files: held, missingFiles: [] });
    expect(takeRestoring(COMPANY)).toBeNull();
  });

  it("reaches the dialog's listener from the write queue, keeping its key through Retry", async () => {
    const [status] = createSignal<"online" | "offline">("online");
    const sent: WriteRequest[] = [];
    let refuse = true;
    const send = vi.fn(async (request: WriteRequest) => {
      sent.push(request);
      if (refuse) throw Object.assign(new Error("Title is too long"), { status: 422 });
      return ISSUE;
    });
    const failed = vi.fn();
    const off = onNewTaskFailed(failed);
    const queue = createWriteQueue({
      storage: memoryStorage(),
      transport: { send, get: vi.fn() },
      connectivity: { status, reportFailure: vi.fn(), onRecovered: () => () => {} },
      lock: (_name, run) => run(),
      target: null,
      onFailed: (write) => write.kind === "task" && newTaskFailed(write),
    });
    queue.setUser("user-1", true);
    queue.add(makeWrite());
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(failed.mock.calls[0]![0]).toMatchObject({ status: "failed", error: "Title is too long", idempotencyKey: "key-1" });

    refuse = false;
    queue.retry(queue.writes()[0]!.id);
    await vi.waitFor(() => expect(queue.writes()).toHaveLength(0));
    expect(sent.map((request) => request.body.idempotencyKey)).toEqual(["key-1", "key-1"]);
    off();
    queue.dispose();
  });
});
