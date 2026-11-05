import { TriangleAlert } from "lucide-solid";
import { Show, type JSX } from "solid-js";
import { providerFailureFacts, providerFailureTitle, type ProviderFailure } from "./provider-failure";
import "./TaskNotices.css";

/*
 * A provider's refusal (provider-failure.ts) as a notice: who refused and why, the provider's own
 * message, when it failed (before work started or during it), the HTTP status and provider code,
 * and the request id to quote to the provider. The task panel shows it for an interrupted task
 * (TaskNotices.tsx); a run's result carries the same failure, so run detail can show it too.
 * `children` adds a line, such as when it tries again; `action` is a button, such as Retry.
 */

export function ProviderFailureNotice(props: {
  failure: ProviderFailure;
  /** Red for a failure that needs someone; amber while it will try again by itself. */
  tone?: "red" | "amber";
  action?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <section class="tn-row" data-tone={props.tone ?? "red"} role={(props.tone ?? "red") === "red" ? "alert" : "status"}>
      <span class="tn-icon" aria-hidden="true">
        <TriangleAlert size={16} />
      </span>
      <div class="tn-text">
        <b>{providerFailureTitle(props.failure)}</b>
        <span class="tn-message">{props.failure.message}</span>
        <span class="tn-facts">{providerFailureFacts(props.failure)}</span>
        <Show when={props.failure.requestId}>{(id) => <span class="tn-facts mono">Request {id()}</span>}</Show>
        <Show when={props.children}>
          <span>{props.children}</span>
        </Show>
      </div>
      <Show when={props.action}>
        <div class="tn-action">{props.action}</div>
      </Show>
    </section>
  );
}
