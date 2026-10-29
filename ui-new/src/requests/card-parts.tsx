import { CornerDownRight, Users } from "lucide-solid";
import { createSignal, Show, type JSX } from "solid-js";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import type { Request } from "./request-model";

/*
 * Pieces every request card's controls share: the footer (what happens next, the actions, who can
 * answer) and a decline button that can ask for a reason.
 */

/** The "what happens next" line, the action row and who can answer. `extra` shows either way. */
export function Footer(props: { request: Request; children?: JSX.Element; extra?: JSX.Element; error?: string | null }) {
  return (
    <>
      <div class="rq-next">
        <CornerDownRight size={14} aria-hidden="true" />
        <span>{props.request.next}</span>
      </div>
      <Show when={props.error}>
        <p class="rq-error" role="alert">
          {props.error}
        </p>
      </Show>
      <div class="rq-acts">
        <Show when={props.request.respond.allowed} fallback={<Show when={props.request.respond.reason}>{(reason) => <p class="rq-note">{reason()}</p>}</Show>}>
          {props.children}
        </Show>
        {props.extra}
        <span class="rq-who">
          <Users size={13} aria-hidden="true" />
          {props.request.audience.label}
        </span>
      </div>
    </>
  );
}

/** A decline that may need a reason: the first press asks for one, the second sends it. */
export function DeclineButton(props: { label: string; needsReason: boolean; allowReason: boolean; placeholder?: string | null; busy: boolean; onReject: (reason?: string) => void }) {
  const [asking, setAsking] = createSignal(false);
  const [reason, setReason] = createSignal("");
  return (
    <Show
      when={asking()}
      fallback={
        <Button size="compact" disabled={props.busy} onClick={() => (props.needsReason || props.allowReason ? setAsking(true) : props.onReject())}>
          {props.label}
        </Button>
      }
    >
      <TextInput
        aria-label="Reason"
        placeholder={props.placeholder ?? (props.needsReason ? "Why? (required)" : "Why? (optional)")}
        value={reason()}
        onInput={(event) => setReason(event.currentTarget.value)}
        ref={(element) => queueMicrotask(() => element.focus())}
      />
      <Button size="compact" variant="danger" disabled={props.busy || (props.needsReason && !reason().trim())} onClick={() => props.onReject(reason().trim() || undefined)}>
        {props.label}
      </Button>
      <Button size="compact" variant="quiet" onClick={() => setAsking(false)}>
        Back
      </Button>
    </Show>
  );
}
