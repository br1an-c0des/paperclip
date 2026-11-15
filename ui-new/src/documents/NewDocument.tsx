import { useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { documentsApi } from "@/api/documents";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { ConfirmDialog } from "./ConfirmDialog";
import { classifySaveError, draftProblem, isDirty, isPlanKey, keyProblem, newDraft, slugifyKey, upsertPayload, type Draft } from "./document-model";
import { documentKeys, type DocumentHost } from "./host";
import { MarkdownEditor } from "./MarkdownEditor";
import "./DocumentView.css";

/*
 * A new document: a title, the key it's stored under (made from the title until you change it),
 * and the Markdown body. Desktop only, like all editing (mobile.md).
 */

export function NewDocument(props: {
  host: DocumentHost;
  existingKeys: readonly string[];
  backLabel: string;
  onBack: () => void;
  onCreated: (key: string) => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = createSignal<Draft>(newDraft());
  const [keyTouched, setKeyTouched] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [leaving, setLeaving] = createSignal(false);

  const keyIssue = () => keyProblem(draft().key, props.existingKeys);
  const back = () => (isDirty(draft()) ? setLeaving(true) : props.onBack());

  const create = async () => {
    const current = { ...draft(), key: draft().key.trim() };
    const problem = draftProblem(current, props.existingKeys);
    if (problem) {
      setFailure(problem);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const result = await documentsApi.upsert(props.host.owner, current.key, upsertPayload(current));
      client.setQueryData(documentKeys.doc(props.host, result.key), result);
      void client.invalidateQueries({ queryKey: documentKeys.list(props.host) });
      props.onCreated(result.key);
    } catch (error) {
      setFailure(classifySaveError(error, true).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      class="tf dv"
      aria-label="New document"
      onKeyDown={(event) => {
        // Escape on an "i" button closes its tip, not the new document.
        if (event.key === "Escape" && !event.defaultPrevented && !(event.target as Element).closest(".infotip")) {
          event.preventDefault();
          back();
        }
      }}
    >
      <div class="tsec-head dv-head">
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label={props.backLabel} onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div class="dv-heading">
          <h2 class="disp dv-title">New document</h2>
        </div>
      </div>
      <div class="tsec-scroll dv-scroll">
        <div class="dv-editor">
          <div class="nd-fields">
            <label class="nd-field">
              <span class="nd-label">Title</span>
              <TextInput
                value={draft().title}
                placeholder="Data notes"
                ref={(element) => queueMicrotask(() => element.focus())}
                onInput={(event) => {
                  const title = event.currentTarget.value;
                  setDraft((value) => ({ ...value, title, key: keyTouched() ? value.key : title.trim() ? slugifyKey(title) : "" }));
                }}
              />
            </label>
            <div class="nd-field nd-field--key">
              <span class="info-line">
                <label class="nd-label" for="nd-key">
                  Key
                </label>
                <InfoTip label="About Key">Agents find documents by key.</InfoTip>
              </span>
              <TextInput
                id="nd-key"
                class="mono"
                value={draft().key}
                placeholder="data-notes"
                invalid={Boolean(keyIssue())}
                aria-describedby="nd-key-help"
                onInput={(event) => {
                  setKeyTouched(true);
                  setDraft((value) => ({ ...value, key: event.currentTarget.value.toLowerCase() }));
                }}
              />
            </div>
          </div>
          <p id="nd-key-help" class="tsec-muted" classList={{ "nd-error": Boolean(keyIssue()) }}>
            {keyIssue() ??
              (isPlanKey(draft().key)
                ? "The plan key makes this the task's plan."
                : "Lowercase letters, numbers, - and _.")}
          </p>
          <MarkdownEditor
            mentions={{ excludeTaskId: props.host.owner.id }}
            onUploadImage={props.host.uploadImage}
            value={draft().body}
            label="New document (Markdown)"
            placeholder="Write in Markdown…"
            onChange={(body) => setDraft((value) => ({ ...value, body }))}
            onSave={() => void create()}
          />
          <Show when={failure()}>
            {(message) => (
              <p class="dv-failure" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </div>
      <div class="dv-foot">
        <span class="tsec-muted dv-foot-note">Ctrl+S creates it</span>
        <Button size="compact" variant="quiet" onClick={back}>
          Cancel
        </Button>
        <Button size="compact" variant="primary" disabled={saving()} onClick={() => void create()}>
          {saving() ? "Creating…" : "Create document"}
        </Button>
      </div>
      <ConfirmDialog
        open={leaving()}
        onOpenChange={setLeaving}
        title="Discard this document?"
        body="It hasn't been created yet."
        confirmLabel="Discard"
        danger
        onConfirm={() => props.onBack()}
      />
    </section>
  );
}
