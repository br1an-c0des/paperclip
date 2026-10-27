import { createQuery } from "@tanstack/solid-query";
import { ArrowLeft, Check, Copy, Download, FileQuestion } from "lucide-solid";
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { fileResourcesApi } from "@/api/file-resources";
import { queryKeys } from "@/api/queryKeys";
import { Markdown } from "@/ui/Markdown";
import { Segmented } from "@/ui/Segmented";
import { CodeView } from "./CodeView";
import type { FileOpen } from "./file-ref";
import { basename } from "./file-tree";
import { base64Bytes, detectPreview, fileSize, resourcePath } from "./preview";

/*
 * One workspace file, previewed: Markdown rendered (its source a toggle away), code highlighted,
 * plain text with line numbers, images, video and PDF. Anything else, or anything too large, offers
 * the download instead.
 */

export function FilePreview(props: { taskId: string; file: FileOpen; onClose?: () => void }) {
  const content = createQuery(() => ({
    queryKey: queryKeys.issues.section(
      props.taskId,
      "files",
      "content",
      props.file.workspace ?? "auto",
      props.file.workspaceId ?? "",
      props.file.path,
    ),
    queryFn: ({ signal }) => fileResourcesApi.content(props.taskId, props.file, signal),
    retry: false,
  }));
  const [markdownView, setMarkdownView] = createSignal<"rendered" | "source">("rendered");
  const [copied, setCopied] = createSignal(false);

  const preview = createMemo(() => (content.data ? detectPreview(content.data.resource, content.data.content) : null));
  const path = () => (content.data ? resourcePath(content.data.resource) : props.file.path);
  const text = () => (content.data?.content.encoding === "utf8" ? content.data.content.data : "");
  const download = () => fileResourcesApi.downloadUrl(props.taskId, props.file);

  // A PDF shows from a blob URL, made once per file and released when it changes.
  const [pdfUrl, setPdfUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const data = content.data;
    if (!data || preview()?.kind !== "pdf" || data.content.encoding !== "base64") return setPdfUrl(null);
    const url = URL.createObjectURL(new Blob([base64Bytes(data.content.data)], { type: "application/pdf" }));
    setPdfUrl(url);
    onCleanup(() => URL.revokeObjectURL(url));
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section class="wf-preview" aria-label={`Preview of ${basename(path())}`}>
      <div class="wf-preview-head">
        <Show when={props.onClose}>
          <button type="button" class="btn btn--icon btn--ghost btn--compact wf-preview-back" aria-label="Back to the file list" onClick={() => props.onClose?.()}>
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        </Show>
        <div class="wf-preview-title">
          <span class="wf-preview-name">{basename(path())}</span>
          <span class="tsec-muted mono wf-preview-path">
            {path()}
            <Show when={content.data?.resource.byteSize}>{(size) => <> · {fileSize(size())}</>}</Show>
            <Show when={preview()?.kind === "code" && preview()}>{(code) => <> · {(code() as { language: string }).language}</>}</Show>
          </span>
        </div>
        <div class="wf-preview-tools">
          <Show when={preview()?.kind === "markdown"}>
            <Segmented
              label="Markdown view"
              options={[
                { value: "rendered", label: "Rendered" },
                { value: "source", label: "Source" },
              ]}
              value={markdownView()}
              onChange={setMarkdownView}
            />
          </Show>
          <Show when={text()}>
            <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label={copied() ? "Copied" : "Copy contents"} title="Copy contents" onClick={() => void copy()}>
              <Show when={copied()} fallback={<Copy size={15} aria-hidden="true" />}>
                <Check size={15} aria-hidden="true" />
              </Show>
            </button>
          </Show>
          <Show when={content.data?.resource.capabilities.download ?? true}>
            <a class="btn btn--icon btn--ghost btn--compact" href={download()} aria-label={`Download ${basename(path())}`} title="Download">
              <Download size={15} aria-hidden="true" />
            </a>
          </Show>
        </div>
      </div>
      <div class="wf-preview-body">
        <Switch>
          <Match when={content.isPending}>
            <p class="tsec-muted">Loading…</p>
          </Match>
          <Match when={content.isError}>
            <Unavailable message={(content.error as Error).message} download={download()} />
          </Match>
          <Match when={preview()}>
            {(shown) => (
              <Switch>
                <Match when={shown().kind === "markdown" && markdownView() === "rendered"}>
                  <div class="wf-markdown">
                    <Markdown source={text()} />
                  </div>
                </Match>
                <Match when={shown().kind === "markdown" || shown().kind === "code" || shown().kind === "text"}>
                  <CodeView value={text()} filename={basename(path())} line={props.file.line ?? null} label={`Contents of ${path()}`} />
                </Match>
                <Match when={shown().kind === "image" && shown()}>
                  {(image) => (
                    <div class="wf-media">
                      <img src={(image() as { src: string }).src} alt={basename(path())} />
                    </div>
                  )}
                </Match>
                <Match when={shown().kind === "video" && shown()}>
                  {(video) => (
                    <div class="wf-media">
                      <video src={(video() as { src: string }).src} controls />
                    </div>
                  )}
                </Match>
                <Match when={shown().kind === "pdf"}>
                  <Show when={pdfUrl()} fallback={<Unavailable message="This PDF couldn't be shown here." download={download()} />}>
                    {(url) => <iframe class="wf-pdf" src={url()} title={basename(path())} />}
                  </Show>
                </Match>
                <Match when={shown().kind === "unsupported" && shown()}>
                  {(unsupported) => <Unavailable message={(unsupported() as { reason: string }).reason} download={download()} />}
                </Match>
              </Switch>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}

function Unavailable(props: { message: string; download: string }) {
  return (
    <div class="wf-unavailable">
      <FileQuestion size={22} aria-hidden="true" />
      <p>{props.message}</p>
      <a class="btn btn--secondary btn--compact" href={props.download}>
        <Download size={14} aria-hidden="true" />
        Download
      </a>
    </div>
  );
}
