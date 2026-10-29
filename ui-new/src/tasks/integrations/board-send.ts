import type { ChatPublicationState, ChatPublicationSummary } from "@paperclipai/shared";
import { ApiError, api } from "@/api/client";

/*
 * A board message sent to a task's chat conversation (ChatBinding.tsx), kept in session storage from
 * just before it's sent until it's confirmed, after the old UI's board-send-draft.ts. What's kept is
 * the send's identity, not a convenience draft: its idempotency key goes with every retry, so a
 * reload can't turn an unconfirmed send into a second message. When it can't be saved, it isn't sent.
 */

export type BoardSendRejection = { code: "chat_board_send_attachments_already_bound"; attachmentIds: string[] };

export type RetainedSend = {
  body: string;
  attachmentIds: string[];
  /** The files' names, so they show while the task's attachments load. */
  attachmentNames: { id: string; name: string }[];
  idempotencyKey: string;
  /** Set once the server took the send and gave it an id to follow. */
  publication: Pick<ChatPublicationSummary, "id" | "state" | "attempts"> | null;
  /** The server turned the send down because a picked file already went out with a comment. */
  rejection?: BoardSendRejection;
};

const STATES: readonly ChatPublicationState[] = [
  "pending",
  "awaiting_consent",
  "streaming",
  "published",
  "retry",
  "delivery_unknown",
  "failed",
  "cancelled",
];

export function boardSendKey(companyId: string, taskId: string, endpointId: string, conversationId: string) {
  return `ui-new:board-send:v1:${JSON.stringify([companyId, taskId, endpointId, conversationId])}`;
}

function isRejection(value: unknown, picked: readonly string[]): value is BoardSendRejection {
  if (!value || typeof value !== "object") return false;
  const found = value as Partial<BoardSendRejection>;
  return (
    found.code === "chat_board_send_attachments_already_bound" &&
    Array.isArray(found.attachmentIds) &&
    found.attachmentIds.length > 0 &&
    found.attachmentIds.every((id) => typeof id === "string" && picked.includes(id))
  );
}

/** Parses a kept send; throws when something is kept but unreadable, which blocks a new send. */
export function parseRetainedSend(raw: string | null): RetainedSend | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<RetainedSend> | null;
  const ids = value?.attachmentIds;
  const publication = value?.publication;
  const valid =
    value &&
    typeof value.body === "string" &&
    value.body.trim().length > 0 &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.length >= 16 &&
    Array.isArray(ids) &&
    ids.length <= 20 &&
    ids.every((id) => typeof id === "string") &&
    (publication === null ||
      (publication !== undefined &&
        typeof publication.id === "string" &&
        publication.id.length > 0 &&
        STATES.includes(publication.state) &&
        Number.isSafeInteger(publication.attempts))) &&
    (value.rejection === undefined || (publication === null && isRejection(value.rejection, ids)));
  if (!valid) throw new Error("The kept send couldn't be read.");
  const names = Array.isArray(value.attachmentNames)
    ? value.attachmentNames.filter((file): file is { id: string; name: string } => typeof file?.id === "string" && typeof file?.name === "string")
    : [];
  return { ...(value as RetainedSend), attachmentNames: names };
}

export function readRetainedSend(key: string) {
  return parseRetainedSend(sessionStorage.getItem(key));
}

/** Throws when storage refuses; the caller must not send then. */
export function writeRetainedSend(key: string, value: RetainedSend) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function clearRetainedSend(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // A kept send that can't be cleared is rechecked on the next load.
  }
}

/**
 * The server's refusal of this exact send because picked files already belong to a comment (409
 * with `details`); anything else stays an unconfirmed send, retried with the same key.
 */
export function readRejection(
  error: unknown,
  request: { endpointId: string; conversationId: string; idempotencyKey: string; attachmentIds: readonly string[] },
): BoardSendRejection | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.body || typeof error.body !== "object") return null;
  const details = (error.body as { details?: unknown }).details as (BoardSendRejection & Record<string, unknown>) | undefined;
  if (!isRejection(details, request.attachmentIds)) return null;
  if (details.endpointId !== request.endpointId || details.conversationId !== request.conversationId || details.idempotencyKey !== request.idempotencyKey) {
    return null;
  }
  return { code: details.code, attachmentIds: [...details.attachmentIds] };
}

/** Posts the board message, with the task files picked to go with it. */
export function publishBoardMessage(endpointId: string, conversationId: string, input: { body: string; idempotencyKey: string; attachmentIds: readonly string[] }) {
  const enc = encodeURIComponent;
  return api.post<ChatPublicationSummary>(`/chat-endpoints/${enc(endpointId)}/conversations/${enc(conversationId)}/publications`, {
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    ...(input.attachmentIds.length > 0 ? { attachmentIds: [...input.attachmentIds] } : {}),
  });
}
