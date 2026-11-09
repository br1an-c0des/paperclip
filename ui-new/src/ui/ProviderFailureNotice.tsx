import { TriangleAlert } from "lucide-solid";
import { Show, type JSX } from "solid-js";
import { providerFailureFacts, providerFailureTitle, providerRetryLine, type ProviderFailure } from "./provider-failure";
import "./ProviderFailureNotice.css";

/*
 * A provider's refusal (provider-failure.ts) as a notice: who refused and why, the provider's own
 * message, when it failed (before work started or during it), the HTTP status and provider code,
 * and the request id to quote to the provider. The task panel shows it for an interrupted task
 * (tasks/TaskNotices.tsx), and the run modal for a run that ended on one (runs/RunModal.tsx).
 * `children` adds a line, such as the task's own countdown (`scheduledLine` in tasks/recovery.ts,
 * which reads "Resuming in 28s by itself." for a pending native resume, with no Retry, as the task's
 * recovery notice does); without one, it says when the provider will take requests again, when it
 * said. `action` is a button, such as Retry.
 */

export function ProviderFailureNotice(props: {
  failure: ProviderFailure;
  /** Red for a failure that needs someone; amber while it will try again by itself. */
  tone?: "red" | "amber";
  action?: JSX.Element;
  children?: JSX.Element;
}) {
  const tone = () => props.tone ?? "red";
  return (
    <section class="pf" data-tone={tone()} role={tone() === "red" ? "alert" : "status"}>
      <span class="pf-icon" aria-hidden="true">
        <TriangleAlert size={16} />
      </span>
      <div class="pf-text">
        <b>{providerFailureTitle(props.failure)}</b>
        <span class="pf-message">{props.failure.message}</span>
        <span class="pf-facts">{providerFailureFacts(props.failure)}</span>
        <Show when={props.failure.requestId}>{(id) => <span class="pf-facts mono">Request {id()}</span>}</Show>
        <Show when={props.children} fallback={<Show when={providerRetryLine(props.failure)}>{(line) => <span>{line()}</span>}</Show>}>
          <span>{props.children}</span>
        </Show>
      </div>
      <Show when={props.action}>
        <div class="pf-action">{props.action}</div>
      </Show>
    </section>
  );
}
