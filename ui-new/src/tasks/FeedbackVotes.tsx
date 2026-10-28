import type { FeedbackDataSharingPreference, FeedbackVote, FeedbackVoteValue } from "@paperclipai/shared";
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
 * Thumbs up and down under an agent's comment in the task thread (`tasks/feedback`), with the
 * data-sharing question the old UI asks (feedback-model.ts). Your votes on the task are read once
 * and shared by every comment; the sharing setting is the instance's, which App settings → General
 * edits.
 */

type Pending = { vote: FeedbackVoteValue; reason?: string; thenAskReason?: boolean };

export function FeedbackVotes(props: { taskId: string; commentId: string; youId: string | null }) {
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
  const mine = () => votesByComment(votes.data).get(props.commentId) ?? null;
  const [saving, setSaving] = createSignal(false);
  const [asking, setAsking] = createSignal<Pending | null>(null);
  const [reasonOpen, setReasonOpen] = createSignal(false);
  const [reason, setReason] = createSignal("");
  // The sharing answer given for this comment's vote, reused when its note is saved.
  const [sharing, setSharing] = createSignal<boolean | null>(null);

  const save = async (vote: FeedbackVoteValue, allowSharing: boolean, note?: string) => {
    const key = queryKeys.issues.feedbackVotes(props.taskId);
    const atSubmit = preference();
    const before = client.getQueryData<FeedbackVote[]>(key);
    client.setQueryData<FeedbackVote[]>(key, withVote(before, { taskId: props.taskId, commentId: props.commentId, vote, reason: note }, props.youId));
    setSaving(true);
    try {
      await feedbackVotesApi.save(props.taskId, {
        targetType: "issue_comment",
        targetId: props.commentId,
        vote,
        ...(note ? { reason: note } : {}),
        ...(allowSharing ? { allowSharing: true } : {}),
      });
      setSharing(allowSharing);
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

  /** Votes, asking about sharing first when the setting says to ask. */
  const vote = async (pending: Pending) => {
    const known = sharing();
    const rule = known === null ? voteSharing(preference()) : { allowSharing: known };
    if (rule === "ask") {
      setAsking(pending);
      return;
    }
    const saved = await save(pending.vote, rule.allowSharing, pending.reason);
    if (saved && pending.thenAskReason) openReason();
  };

  const openReason = () => {
    setReason("");
    setReasonOpen(true);
  };

  const answer = async (allowSharing: boolean) => {
    const pending = asking();
    if (!pending) return;
    const saved = await save(pending.vote, allowSharing, pending.reason);
    if (!saved) return;
    setAsking(null);
    if (pending.thenAskReason) openReason();
  };

  const saveNote = async () => {
    const note = reason().trim();
    if (!note) return;
    setReasonOpen(false);
    await vote({ vote: "down", reason: note });
  };

  return (
    <div class="fbv" role="group" aria-label="Feedback on this reply">
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
          disabled={saving()}
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
