import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { MarkdownEditorHandle } from "./cm-editor";
import "./MarkdownEditor.css";

/*
 * The Markdown source editor: CodeMirror 6, loaded on first use (cm-editor.ts). Until it arrives a
 * plain textarea stands in, so typing never waits on the network; if loading fails, the textarea
 * stays. Ctrl/Cmd+S and Ctrl/Cmd+Enter call `onSave` in both.
 */

export function MarkdownEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  label: string;
  placeholder?: string;
  autofocus?: boolean;
}) {
  let host!: HTMLDivElement;
  let fallback: HTMLTextAreaElement | undefined;
  let editor: MarkdownEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    if (props.autofocus) fallback?.focus();
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
      editor?.destroy();
    });
    import("./cm-editor")
      .then((cm) => {
        if (cancelled) return;
        const hadFocus = document.activeElement === fallback;
        editor = cm.createMarkdownEditor(host, {
          value: props.value,
          label: props.label,
          placeholder: props.placeholder,
          onChange: (value) => props.onChange(value),
          onSave: () => props.onSave?.(),
        });
        setReady(true);
        if (hadFocus || props.autofocus) editor.focus();
      })
      .catch(() => {
        // Stay on the textarea.
      });
  });

  // Outside changes (reloading the latest version after a conflict) replace the editor's text.
  createEffect(on(() => props.value, (value) => editor?.setValue(value), { defer: true }));

  return (
    <div class="mde" data-ready={ready() || undefined}>
      <div ref={host} class="mde-host" />
      <Show when={!ready()}>
        <textarea
          ref={fallback}
          class="mde-fallback"
          value={props.value}
          aria-label={props.label}
          placeholder={props.placeholder}
          spellcheck
          onInput={(event) => props.onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "Enter")) {
              event.preventDefault();
              props.onSave?.();
            }
          }}
        />
      </Show>
    </div>
  );
}
