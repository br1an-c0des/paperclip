import type { IssueComment } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import type { PluginSlotContext } from "./model";
import { PluginSlotOutlet } from "./PluginSlot";
import "./plugins.css";

/*
 * What plugins add to a comment in a task's thread (ui/src/components/CommentThread.tsx):
 * `commentContextMenuItem` slots as small actions in the comment's head, and `commentAnnotation`
 * slots under its body. The context is the comment, with its task as the parent entity. Neither
 * shows on a deleted comment, and nothing renders (or loads React) without a plugin for comments.
 */

type CommentRef = Pick<IssueComment, "id" | "issueId" | "deletedAt">;

function useCommentContext(comment: () => CommentRef): () => PluginSlotContext {
  const company = useCompany();
  // The task is already loaded by the panel; this only reads its project from the cache.
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(comment().issueId),
    queryFn: ({ signal }) => issuesApi.get(comment().issueId, signal),
    staleTime: 60_000,
  }));
  return () => ({
    companyId: company().id,
    companyPrefix: company().issuePrefix,
    projectId: task.data?.projectId ?? null,
    entityId: comment().id,
    entityType: "comment",
    parentEntityId: comment().issueId,
  });
}

export function CommentPluginActions(props: { comment: CommentRef }) {
  const context = useCommentContext(() => props.comment);
  return (
    <Show when={!props.comment.deletedAt}>
      <PluginSlotOutlet slotTypes={["commentContextMenuItem"]} entityType="comment" context={context()} class="plugin-comment-actions" missing="placeholder" errorBehavior="hidden" />
    </Show>
  );
}

export function CommentPluginAnnotations(props: { comment: CommentRef }) {
  const context = useCommentContext(() => props.comment);
  return (
    <Show when={!props.comment.deletedAt}>
      <PluginSlotOutlet slotTypes={["commentAnnotation"]} entityType="comment" context={context()} class="plugin-comment-annotations" missing="placeholder" errorBehavior="hidden" />
    </Show>
  );
}
