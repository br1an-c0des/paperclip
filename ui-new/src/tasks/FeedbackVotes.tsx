import type { FeedbackDataSharingPreference, FeedbackTargetType, FeedbackVote, FeedbackVoteValue } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ThumbsDown, ThumbsUp } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { feedbackVotesApi } from "@/api/feedback-votes";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextArea } from "@/ui/Field";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { FEEDBACK_TERMS_URL, savedVoteTitle, voteSharing, votesByComment, withVote } from "./feedback-model";
import "./FeedbackVotes.css";

/*
 * Thumbs up and down under an agent's comment in the task thread, or on a document revision an
 * agent wrote (`targetType: "issue_document_revision"`, the revision's id as `commentId`;
 * `tasks/feedback`), with the
 * data-sharing question the old UI asks (feedback-model.ts). Your votes on the task are read once
 * and shared by every comment; the sharing setting is the instance's, which App settings → General
 * edits.
 */

type Pending = { vote: FeedbackVoteValue; reason?: string; thenAskReason?: boolean };

// The open question and note live outside the component, by comment: the thread redraws its
// comments when its data refreshes, which would otherwise close them under the reader.
const [askFor, setAskFor] = createSignal<{ commentId: string; pending: Pending } | null>(null);
/** The note after a thumbs down, with the vote's sharing, which the note is saved with. */
const [noteFor, setNoteFor] = createSignal<{ commentId: string; allowSharing: boolean } | null>(null);
const [noteText, setNoteText] = createSignal("");

export function FeedbackVotes(props: {
  taskId: string;
  /** The comment's id, or the document revision's. */
  commentId: string;
  youId: string | null;
  targetType?: FeedbackTargetType;
  label?: string;
}) {
  const targetType = () => props.targetType ?? "issue_comment";
  const client = useQueryClient();
  const company = useCompany();
  const votes = createQuery(() => ({
    queryKey: queryKeys.issues.feedbackVotes(props.taskId),
    queryFn: ({ signal }) => feedbackVotesApi.list(props.taskId, signal),
    staleTime: 30_000,
  }));
  const general = createQuery(() => ({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: instanceSettingsApi.general,
    retry: false,
    staleTime: 60_000,
  }));
  const preference = (): FeedbackDataSharingPreference => general.data?.feedbackDataSharingPreference ?? "prompt";
  const mine = () => votesByComment(votes.data, targetType()).get(props.commentId) ?? null;
  const [saving, setSaving] = createSignal(false);
  const asking = () => {
    const open = askFor();
    return open?.commentId === props.commentId ? open.pending : null;
  };
  const setAsking = (pending: Pending | null) => setAskFor(pending ? { commentId: props.commentId, pending } : null);
  const reasonOpen = () => noteFor()?.commentId === props.commentId;
  const setReasonOpen = (open: boolean) => {
    if (!open) setNoteFor(null);
  };
  const reason = noteText;
  const setReason = setNoteText;

  const save = async (vote: FeedbackVoteValue, allowSharing: boolean, note?: string) => {
    const key = queryKeys.issues.feedbackVotes(props.taskId);
    const atSubmit = preference();
    const before = client.getQueryData<FeedbackVote[]>(key);
    client.setQueryData<FeedbackVote[]>(key, withVote(before, { taskId: props.taskId, commentId: props.commentId, vote, reason: note, targetType: targetType() }, props.youId));
    setSaving(true);
    try {
      await feedbackVotesApi.save(props.taskId, {
        targetType: targetType(),
        targetId: props.commentId,
        vote,
        ...(note ? { reason: note } : {}),
        ...(allowSharing ? { allowSharing: true } : {}),
      });
      pushToast({ tone: "success", title: savedVoteTitle(atSubmit, allowSharing) });
      void client.invalidateQueries({ queryKey: key });
      // Answering the question saves the instance's setting; sharing can also turn the company's on.
      if (atSubmit === "prompt") void client.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
      if (allowSharing) void client.invalidateQueries({ queryKey: queryKeys.companies.detail(company().id) });
      return true;
    } catch (error) {
      client.setQueryData(key, before);
      pushToast({ tone: "error", title: "Couldn't save your feedback", body: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Votes, asking about sharing first when the setting says to ask. A thumbs down then asks what
   * could have been better, at once when nothing needs asking first.
   */
  const vote = async (pending: Pending) => {
    const rule = voteSharing(preference());
    if (rule === "ask") {
      setAsking(pending);
      return;
    }
    if (pending.thenAskReason) openReason(rule.allowSharing);
    await save(pending.vote, rule.allowSharing, pending.reason);
  };

  const openReason = (allowSharing: boolean) => {
    setReason("");
    setNoteFor({ commentId: props.commentId, allowSharing });
  };

  const answer = async (allowSharing: boolean) => {
    const pending = asking();
    if (!pending) return;
    const saved = await save(pending.vote, allowSharing, pending.reason);
    if (!saved) return;
    setAsking(null);
    if (pending.thenAskReason) openReason(allowSharing);
  };

  const saveNote = async () => {
    const note = reason().trim();
    const open = noteFor();
    if (!note || !open) return;
    setNoteFor(null);
    await save("down", open.allowSharing, note);
  };

  return (
    <div class="fbv" role="group" aria-label={props.label ?? "Feedback on this reply"}>
      <button
        type="button"
        class="fbv-btn"
        data-on={mine()?.vote === "up" ? "up" : undefined}
        aria-pressed={mine()?.vote === "up"}
        aria-label="Helpful"
        title="Helpful"
        disabled={saving()}
        onClick={() => void vote({ vote: "up" })}
      >
        <ThumbsUp size={14} aria-hidden="true" />
      </button>
      <Popover
        open={reasonOpen()}
        onOpenChange={(open) => {
          if (!open) setReasonOpen(false);
          else if (!saving()) void vote({ vote: "down", thenAskReason: true });
        }}
        placement="top-start"
      >
        <Popover.Trigger
          class="fbv-btn"
          data-on={mine()?.vote === "down" ? "down" : undefined}
          aria-pressed={mine()?.vote === "down"}
          aria-label="Needs work"
          title="Needs work"
        >
          <ThumbsDown size={14} aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content title="What could have been better?" width={340}>
          <div class="fbv-note">
            <TextArea rows={3} value={reason()} placeholder="Add a short note" aria-label="What could have been better?" onInput={(event) => setReason(event.currentTarget.value)} />
            <div class="fbv-note-actions">
              <Button size="compact" onClick={() => setReasonOpen(false)}>
                Dismiss
              </Button>
              <Button size="compact" variant="primary" disabled={saving() || !reason().trim()} onClick={() => void saveNote()}>
                {saving() ? "Saving…" : "Save note"}
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover>
      <Show when={mine()?.sharedWithLabs}>
        <span class="fbv-shared">Shared with Paperclip Labs</span>
      </Show>

      <Dialog
        open={!!asking()}
        onOpenChange={(open) => {
          if (!open && !saving()) setAsking(null);
        }}
        title="Share your feedback with Paperclip Labs?"
        description="Choose whether voted AI outputs can be shared with Paperclip Labs. Your answer becomes the default for future thumbs up and thumbs down."
        width={520}
        hideClose
        footer={
          <>
            <Button disabled={saving()} onClick={() => void answer(false)}>
              {saving() ? "Saving…" : "Don't allow"}
            </Button>
            <Button variant="primary" disabled={saving()} onClick={() => void answer(true)}>
              {saving() ? "Saving…" : "Always allow"}
            </Button>
          </>
        }
      >
        <div class="fbv-terms">
          <p>This vote is always saved here.</p>
          <p>
            <b>Always allow</b> shares this vote and future voted AI outputs. <b>Don't allow</b> keeps this vote and future votes on this
            instance.
          </p>
          <p>You can change this later in App settings → General.</p>
          <a href={FEEDBACK_TERMS_URL} target="_blank" rel="noreferrer">
            Read the terms of service
          </a>
        </div>
      </Dialog>
    </div>
  );
}
