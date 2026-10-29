import { AtSign, ImagePlus } from "lucide-solid";
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, Show } from "solid-js";
import { MentionList, useMentionCandidates } from "@/tasks/composer/MentionTextArea";
import { mentionMarkdown, type MentionTarget } from "@/tasks/composer/mentions";
import { pushToast } from "@/ui/Toast";
import type { EditorMention, MarkdownEditorHandle, MentionKey } from "./cm-editor";
import { imageMarkdown, uploadingPlaceholder } from "./document-model";
import "./MarkdownEditor.css";

/*
 * The Markdown source editor: CodeMirror 6, loaded on first use (cm-editor.ts). Until it arrives a
 * plain textarea stands in, so typing never waits on the network; if loading fails, the textarea
 * stays. Ctrl/Cmd+S and Ctrl/Cmd+Enter call `onSave` in both.
 *
 * With `mentions`, typing "@" lists agents, people and tasks, as in the composer, and picking one
 * writes the mention link. With `onUploadImage`, images pasted, dropped or picked with the Image
 * button are uploaded and linked where they went (`documents-artifacts/documents`). Both come with
 * the CodeMirror editor, not the stand-in textarea.
 */

export function MarkdownEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  label: string;
  placeholder?: string;
  autofocus?: boolean;
  /** Offer @-mentions; the task id leaves that task out of the task matches. */
  mentions?: { excludeTaskId?: string };
  /** Uploads an image and answers the URL to link it by. */
  onUploadImage?: (file: File) => Promise<string>;
}) {
  let host!: HTMLDivElement;
  let fallback: HTMLTextAreaElement | undefined;
  let picker: HTMLInputElement | undefined;
  let editor: MarkdownEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);
  const [uploading, setUploading] = createSignal(0);

  // @-mentions: what CodeMirror reports as being typed, the candidates for it, and the highlighted one.
  const listId = createUniqueId();
  const [mention, setMention] = createSignal<EditorMention | null>(null);
  const [closedAt, setClosedAt] = createSignal<number | null>(null);
  const [index, setIndex] = createSignal(0);
  const active = createMemo(() => {
    const found = mention();
    return props.mentions && found && found.start !== closedAt() ? found : null;
  });
  const { candidates, people } = useMentionCandidates(active, () => props.mentions?.excludeTaskId);
  createEffect(on(() => active()?.start, () => setIndex(0)));
  const open = () => !!active() && candidates().length > 0;
  const pick = (target: MentionTarget) => {
    const at = active();
    if (!at || !editor) return;
    editor.replace(`${mentionMarkdown(target)} `, at.start, at.end);
  };
  const mentionKey = (key: MentionKey) => {
    if (!open()) return false;
    const count = candidates().length;
    if (key === "down") setIndex((current) => (current + 1) % count);
    else if (key === "up") setIndex((current) => (current + count - 1) % count);
    else if (key === "pick") pick(candidates()[index()]!);
    else setClosedAt(active()!.start);
    return true;
  };

  // Images: a placeholder goes in at once, and the link replaces it once the upload is done.
  const uploadImages = (files: File[], at?: number) => {
    const upload = props.onUploadImage;
    if (!upload || !editor) return;
    for (const file of files) {
      const placeholder = uploadingPlaceholder(file.name);
      editor.replace(`${placeholder}\n`, at);
      setUploading((count) => count + 1);
      upload(file)
        .then((url) => editor?.replaceText(placeholder, imageMarkdown(file.name, url)))
        .catch((error) => {
          editor?.replaceText(`${placeholder}\n`, "");
          pushToast({ tone: "error", title: `Couldn't upload ${file.name}`, body: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => setUploading((count) => count - 1));
    }
  };

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
          onMention: props.mentions
            ? (found) => {
                setMention(found);
                if (!found) setClosedAt(null);
              }
            : undefined,
          mentionKey: props.mentions ? mentionKey : undefined,
          onFiles: props.onUploadImage ? (files, at) => uploadImages(files, at) : undefined,
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
      <Show when={ready() && (props.mentions || props.onUploadImage)}>
        <div class="mde-tools" role="toolbar" aria-label="Insert">
          <Show when={props.mentions}>
            <button
              type="button"
              class="btn btn--icon btn--ghost btn--compact"
              aria-label="Mention someone"
              title="Mention an agent, person or task"
              onClick={() => editor?.replace("@")}
            >
              <AtSign size={14} aria-hidden="true" />
            </button>
          </Show>
          <Show when={props.onUploadImage}>
            <button
              type="button"
              class="btn btn--ghost btn--compact"
              title="Add an image (or paste or drop one in)"
              disabled={uploading() > 0}
              onClick={() => picker?.click()}
            >
              <ImagePlus size={14} aria-hidden="true" />
              {uploading() > 0 ? "Uploading…" : "Image"}
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                uploadImages([...(event.currentTarget.files ?? [])]);
                event.currentTarget.value = "";
              }}
            />
          </Show>
        </div>
      </Show>
      <div ref={host} class="mde-host" />
      <Show when={open() && active()}>
        {(at) => (
          <MentionList
            id={listId}
            candidates={candidates()}
            index={index()}
            people={people}
            onPick={pick}
            class="mde-mentions"
            style={{ left: `${at().left}px`, top: `${at().bottom + 6}px` }}
          />
        )}
      </Show>
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
