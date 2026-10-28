import { Show } from "solid-js";
import { TaskBrowsers } from "./BrowserViewer";
import { ChatBinding } from "./ChatBinding";
import { EmailThread } from "./EmailThread";
import { isTaskId } from "./integrations-model";
import "./Integrations.css";

/*
 * What a task carries from outside Paperclip, drawn under its health notices (TaskNotices) in the
 * panel, the modal and the full page: the chat conversation it came from, its email thread, and a
 * browser its agent has open. Each is a row only while it applies; an ordinary task shows nothing.
 */

export function TaskIntegrations(props: { taskId: string }) {
  return (
    <Show when={isTaskId(props.taskId)}>
      <ChatBinding taskId={props.taskId} />
      <EmailThread taskId={props.taskId} />
      <TaskBrowsers taskId={props.taskId} />
    </Show>
  );
}
