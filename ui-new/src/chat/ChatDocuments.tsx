import type { IssueDocumentSummary } from "@paperclipai/shared";
import { FileText, NotebookPen } from "lucide-solid";
import { For, lazy, Show, Suspense } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { documentName, isPlanKey, sortDocuments } from "@/documents/document-model";
import type { DocumentHost } from "@/documents/host";
import { dayLabel } from "@/runs/run-model";
import type { TaskPeople } from "@/tasks/people";
import { Dialog } from "@/ui/Dialog";
import { messageTime, type ChatDocument } from "./chat-model";

/*
 * The chat's documents. A chat is a task underneath (decision 8), and the agent plans in its `plan`
 * document and saves notes there, so they show in three places, all opening the same viewer and
 * editor as the task panel's Docs and files (src/documents/):
 *
 * - a Documents group in the Activity column, the plan first;
 * - a card in the thread where each was first saved;
 * - a Plan button in the header while the chat has a plan (not on a phone, whose header is full).
 *
 * The open document is in the address (`#document-<key>`, as task links write it), so links agents
 * post, like `/TES/issues/TES-13#document-plan`, land on the chat with it open.
 */

const DocumentView = lazy(() => import("@/documents/DocumentView").then((module) => ({ default: module.DocumentView })));

/** What the document editor needs to edit the chat task's documents. */
export function chatDocumentHost(chatId: string, people: TaskPeople): DocumentHost {
  return {
    owner: { kind: "issue", id: chatId },
    root: queryKeys.issues.section(chatId, "documents"),
    nameOf: (agentId, userId) => {
      const agent = people.agent(agentId);
      if (agent) return agent.name;
      if (userId) return userId === people.youId() ? "You" : people.personName(userId);
      return null;
    },
    youId: () => people.youId(),
  };
}

/** "4:08 pm" today, else "Oct 26". */
function when(value: string | Date) {
  const day = dayLabel(value);
  return day === "Today" ? messageTime(value) : day;
}

function Icon(props: { plan: boolean; size: number }) {
  return props.plan ? <NotebookPen size={props.size} aria-hidden="true" /> : <FileText size={props.size} aria-hidden="true" />;
}

/** The Activity column's Documents group. Shows only once the chat has a document. */
export function ChatDocumentList(props: { documents: readonly IssueDocumentSummary[]; href: (key: string) => string; onOpen: (key: string) => void; headingId: string }) {
  const sorted = () => sortDocuments(props.documents);
  return (
    <Show when={sorted().length > 0}>
      <section class="ch-side-sec" aria-labelledby={props.headingId}>
        <h3 class="disp" id={props.headingId}>
          Documents
        </h3>
        <ul class="ch-next">
          <For each={sorted()}>
            {(doc) => (
              <li>
                <a
                  class="ch-next-row ch-doc-row"
                  href={props.href(doc.key)}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    props.onOpen(doc.key);
                  }}
                >
                  <span class="ch-doc-icon" classList={{ "ch-doc-icon--plan": isPlanKey(doc.key) }}>
                    <Icon plan={isPlanKey(doc.key)} size={13} />
                  </span>
                  <span class="ch-ellipsis">{documentName(doc)}</span>
                  <time class="ch-muted ch-push" datetime={new Date(doc.updatedAt).toISOString()}>
                    {when(doc.updatedAt)}
                  </time>
                </a>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

/** A document in the thread, where it was first saved. */
export function ChatDocumentCard(props: { document: ChatDocument; people: TaskPeople; href: string; onOpen: () => void }) {
  const plan = () => isPlanKey(props.document.key);
  const author = () => {
    const agent = props.people.agent(props.document.createdByAgentId);
    if (agent) return agent.name;
    const userId = props.document.createdByUserId;
    return userId ? (userId === props.people.youId() ? "you" : props.people.personName(userId)) : null;
  };
  const meta = () =>
    [
      author() ? `Saved by ${author()}` : "Saved",
      props.document.latestRevisionNumber > 1 ? `revision ${props.document.latestRevisionNumber}, updated ${when(props.document.updatedAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <a
      class="ch-task ch-doc-card"
      href={props.href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        props.onOpen();
      }}
    >
      <span class="ch-doc-icon ch-doc-icon--card" classList={{ "ch-doc-icon--plan": plan() }}>
        <Icon plan={plan()} size={16} />
      </span>
      <span class="ch-task-text">
        <span class="ch-task-kicker">{plan() ? "Plan" : "Document"}</span>
        <span class="ch-task-title">
          <span class="ch-ellipsis">{plan() ? "The plan for this chat" : documentName(props.document)}</span>
        </span>
        <span class="ch-task-meta">{meta()}</span>
      </span>
    </a>
  );
}

/** The open document over the chat, in the task panel's viewer and editor. */
export function ChatDocumentDialog(props: { host: DocumentHost | null; docKey: string | null; title: string; onClose: () => void }) {
  return (
    <Dialog
      open={props.host !== null && props.docKey !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      titleHidden
      width={1000}
      class="ch-doc-dialog"
    >
      <Show when={props.host && props.docKey !== null ? { host: props.host, key: props.docKey } : null}>
        {(open) => (
          <Suspense fallback={<p class="ch-muted">Loading the document…</p>}>
            <DocumentView host={open().host} docKey={open().key} backLabel="Back to the chat" onBack={props.onClose} onDeleted={props.onClose} />
          </Suspense>
        )}
      </Show>
    </Dialog>
  );
}
