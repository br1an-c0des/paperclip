import { ChevronRight, Copy, Info } from "lucide-solid";
import { For, Show } from "solid-js";
import type { RunDetail } from "@/api/runs";
import { pushToast } from "@/ui/Toast";
import type { RunInvocation } from "./invocation";
import { capitalize, isActiveRun, shortId } from "./run-model";
import "./RunInput.css";

/*
 * "What the agent was sent" (board 17). Paperclip keeps the prompt it rendered, the wake context,
 * the command and the environment; the harness adds its own system prompt, tool definitions and
 * session history before calling the model. Following decision 4, the view shows what exists and
 * says plainly what it doesn't: the exact model input is only in a provider trace.
 */

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ tone: "success", title: `Copied the ${what}` });
  } catch {
    pushToast({ tone: "error", title: `Couldn't copy the ${what}` });
  }
}

export function RunInput(props: {
  run: RunDetail;
  invocation: RunInvocation | null;
  loading: boolean;
  harness: string;
  isAdmin: boolean;
  onShowTrace: () => void;
}) {
  return (
    <div class="ri">
      <p class="rm-note">
        <Info size={15} aria-hidden="true" />
        <span>
          What Paperclip sent {props.harness} to start this run. Before it calls the model, {props.harness} adds its own system prompt,
          tool definitions and session history, so this isn't the model's full input. Only a{" "}
          <Show when={props.isAdmin} fallback={<>provider trace</>}>
            <button type="button" class="ri-link" onClick={() => props.onShowTrace()}>
              provider trace
            </button>
          </Show>{" "}
          records those exact requests, when it's turned on
          {props.isAdmin ? "." : ", and only instance admins can see one."}
        </span>
      </p>

      <Show
        when={props.invocation}
        fallback={
          <div class="rm-empty">
            <h3 class="disp">{props.loading ? "Loading…" : "Nothing recorded yet"}</h3>
            <Show when={!props.loading}>
              <p>
                {isActiveRun(props.run.status)
                  ? `Paperclip records what it sends once ${props.harness} starts. This run hasn't started it yet.`
                  : "Paperclip didn't record what it sent for this run. Runs that ended before their harness started have nothing here."}
              </p>
            </Show>
          </div>
        }
      >
        {(invocation) => (
          <>
            <section class="ri-sec" aria-labelledby="ri-prompt">
              <div class="ri-sech">
                <h3 class="disp" id="ri-prompt">
                  Prompt
                </h3>
                <span class="cap">
                  {invocation().prompt ? `${invocation().prompt!.length.toLocaleString()} characters · rendered from the agent's prompt template` : "No prompt recorded"}
                </span>
                <Show when={invocation().prompt}>
                  {(prompt) => (
                    <button type="button" class="rm-b" onClick={() => void copy(prompt(), "prompt")}>
                      <Copy size={13} aria-hidden="true" />
                      Copy
                    </button>
                  )}
                </Show>
              </div>
              <Show when={invocation().prompt}>{(prompt) => <pre class="rm-pre">{prompt()}</pre>}</Show>
            </section>

            <section class="ri-sec" aria-labelledby="ri-loaded">
              <div class="ri-sech">
                <h3 class="disp" id="ri-loaded">
                  Loaded with it
                </h3>
              </div>
              <ul class="ri-kvl">
                <li>
                  <span class="ri-k">Harness</span>
                  <span>
                    {capitalize(props.harness)}
                    <Show when={invocation().adapterType}>{(type) => <span class="mono cap"> · {type()}</span>}</Show>
                  </span>
                </li>
                <li>
                  <span class="ri-k">Session</span>
                  <span>
                    {props.run.sessionIdBefore ? (
                      <>
                        Resumed <span class="mono">{shortId(props.run.sessionIdBefore)}</span>, with its earlier turns already in context
                      </>
                    ) : (
                      "A new session"
                    )}
                  </span>
                </li>
                <Show when={invocation().cwd}>
                  {(cwd) => (
                    <li>
                      <span class="ri-k">Workspace</span>
                      <span class="mono ri-wrap">{cwd()}</span>
                    </li>
                  )}
                </Show>
                <Show when={invocation().commandNotes.length > 0}>
                  <li>
                    <span class="ri-k">Notes</span>
                    <ul class="ri-notes">
                      <For each={invocation().commandNotes}>{(note) => <li class="mono">{note}</li>}</For>
                    </ul>
                  </li>
                </Show>
              </ul>
            </section>

            <Show when={invocation().context}>
              {(context) => (
                <details class="ri-xs">
                  <summary>
                    <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
                    Wake context
                    <span class="cap">JSON · what Paperclip knew about this wake</span>
                  </summary>
                  <pre class="rm-pre">{context()}</pre>
                </details>
              )}
            </Show>
            <Show when={invocation().command}>
              {(command) => (
                <details class="ri-xs">
                  <summary>
                    <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
                    Command
                    <span class="cap">{invocation().adapterType ?? props.harness}</span>
                  </summary>
                  <pre class="rm-pre">{command()}</pre>
                </details>
              )}
            </Show>
            <Show when={invocation().env.length > 0}>
              <details class="ri-xs">
                <summary>
                  <ChevronRight size={13} class="rt-chev" aria-hidden="true" />
                  Environment
                  <span class="cap">
                    {invocation().env.length} variables
                    {invocation().env.some((line) => line.hidden) ? " · secrets hidden" : ""}
                  </span>
                </summary>
                <pre class="rm-pre">
                  <For each={invocation().env}>
                    {(line) => (
                      <span classList={{ "ri-hidden": line.hidden }}>
                        {line.key}={line.value}
                        {"\n"}
                      </span>
                    )}
                  </For>
                </pre>
              </details>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
