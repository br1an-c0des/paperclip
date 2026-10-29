import { ShieldQuestion } from "lucide-solid";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { requestStatusLabel, unanswerableReason, type RequestAnswer } from "./runtime-requests";
import type { RuntimeRequest } from "./transcript-model";

/*
 * A runtime request in the transcript: the harness asking for permission or input mid-turn. While
 * it's pending and the run goes, its choices (or its fields and Send) answer it, which resumes the
 * run (runtime-requests.ts has the rules). Once answered, expired or cancelled, it says so.
 */

export type AnswerRequest = (request: RuntimeRequest, answer: RequestAnswer) => Promise<void>;

export function RunRequest(props: { request: RuntimeRequest; live: boolean; onAnswer?: AnswerRequest }) {
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal<string | null>(null);
  const id = createUniqueId();
  const pending = () => props.request.status === "pending";
  const blocked = () => unanswerableReason(props.request, props.live);
  const answerable = () => pending() && !blocked() && !!props.onAnswer;

  const answer = async (key: string, value: RequestAnswer) => {
    if (!props.onAnswer) return;
    setBusy(key);
    try {
      await props.onAnswer(props.request, value);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="rt-card rt-req" data-pending={pending() || undefined} aria-label={props.request.requestType === "permission" ? "Permission request" : "Input request"}>
      <div class="rt-input-head">
        <ShieldQuestion size={14} aria-hidden="true" />
        <span class="rt-tag">{props.request.requestType === "permission" ? "Permission" : "Input"}</span>
        <span class="rt-req-status">{requestStatusLabel(props.request)}</span>
      </div>
      <p class="rt-req-prompt">{props.request.prompt}</p>
      <Show when={pending() && blocked()}>{(reason) => <p class="cap">{reason()}</p>}</Show>
      <Show when={answerable()}>
        <Show
          when={props.request.requestType === "input"}
          fallback={
            <div class="rt-actions">
              <For each={props.request.choices}>
                {(choice) => (
                  <Button
                    size="compact"
                    variant={choice.key === "accept" ? "primary" : choice.key === "decline" ? "danger" : "secondary"}
                    disabled={busy() !== null}
                    onClick={() => void answer(choice.key, { action: choice.key })}
                  >
                    {busy() === choice.key ? "Sending…" : choice.label}
                  </Button>
                )}
              </For>
            </div>
          }
        >
          <form
            class="rt-req-form"
            onSubmit={(event) => {
              event.preventDefault();
              void answer("submit", { action: "submit", values: values() });
            }}
          >
            <For each={props.request.fields}>
              {(field, index) => (
                <Field label={field.label} for={`${id}-${index()}`}>
                  <TextInput
                    id={`${id}-${index()}`}
                    placeholder={field.placeholder ?? undefined}
                    value={values()[field.name] ?? ""}
                    onInput={(event) => setValues({ ...values(), [field.name]: event.currentTarget.value })}
                  />
                </Field>
              )}
            </For>
            <div class="rt-actions">
              <Button size="compact" variant="primary" type="submit" disabled={busy() !== null}>
                {busy() === "submit" ? "Sending…" : "Send"}
              </Button>
              <Button size="compact" variant="quiet" disabled={busy() !== null} onClick={() => void answer("cancel", { action: "cancel" })}>
                {busy() === "cancel" ? "Cancelling…" : "Cancel"}
              </Button>
            </div>
          </form>
        </Show>
      </Show>
    </section>
  );
}
