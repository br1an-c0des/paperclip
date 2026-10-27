import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import type { CodeViewHandle } from "@/documents/cm-viewer";

/*
 * Read-only source with line numbers and syntax highlighting, through the same lazily loaded
 * CodeMirror as the document editor. Plain preformatted text shows until it loads, or if it can't.
 */

export function CodeView(props: { value: string; filename: string; line?: number | null; label: string }) {
  let host!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);

  createEffect(
    on(
      () => [props.value, props.filename, props.line] as const,
      ([value, filename, line]) => {
        let view: CodeViewHandle | undefined;
        let cancelled = false;
        setReady(false);
        import("@/documents/cm-viewer")
          .then((cm) => {
            if (cancelled) return;
            host.replaceChildren();
            view = cm.createCodeView(host, { value, filename, line, label: props.label });
            setReady(true);
          })
          .catch(() => setReady(false));
        onCleanup(() => {
          cancelled = true;
          view?.destroy();
        });
      },
    ),
  );

  return (
    <div class="code-view">
      <div ref={host} class="code-view-host" hidden={!ready()} />
      <Show when={!ready()}>
        <pre class="code-view-plain mono" aria-label={props.label}>
          {props.value}
        </pre>
      </Show>
    </div>
  );
}
