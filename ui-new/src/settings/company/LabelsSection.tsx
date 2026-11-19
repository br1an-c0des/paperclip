import type { IssueLabel } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { Pencil, Plus, Trash2 } from "lucide-solid";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useCompany } from "@/lib/company";
import { useLabelsQuery } from "@/lib/company-data";
import { NewLabelDialog } from "@/tasks/NewLabelDialog";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { isLabelColor, isLabelNameTaken, LABEL_NAME_MAX, labelNameProblem, nameTakenMessage, sortLabels } from "./labels-model";
import { CardHead, CardNoteLine, failure, saveNote, SectionTitle, useRunner } from "./shared";
import "@/tasks/NewLabelDialog.css";

/*
 * Labels (company settings → Labels, `/:prefix/company/settings/labels`): the company's task labels,
 * renamed, recoloured, created and deleted here. Before this the only way to touch a label was the
 * New label dialog of a task's label menu, which now links here ("Edit labels").
 *
 * A rename is inline (`PATCH /labels/:id` with `{ name }`); a name another label has is the server's
 * 409 `label_name_taken`, shown on the field, as is the same clash found before sending. A colour
 * saves when the colour picker closes (`{ color }`). Delete asks first (`DELETE /labels/:id`): the
 * tasks that had the label lose it. Every change refreshes the shared label query
 * (lib/company-data.ts) and the task lists and task details, which carry their labels' names and
 * colours.
 */

export function LabelsSection() {
  const company = useCompany();
  const client = useQueryClient();
  const labels = useLabelsQuery();
  const list = createMemo(() => sortLabels(labels.data));
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) }),
      client.invalidateQueries({ queryKey: ["issues", "detail"] }),
    ]);
  const runner = useRunner(refresh);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<IssueLabel | null>(null);
  const [creating, setCreating] = createSignal(false);

  const recolor = (label: IssueLabel, color: string) => {
    if (!isLabelColor(color) || color.toLowerCase() === label.color.toLowerCase()) return;
    void runner.run(() => taskActionsApi.updateLabel(label.id, { color }), "Couldn't change the label's color.");
  };

  return (
    <>
      <SectionTitle title="Labels" info="Labels mark and filter tasks. A change here shows on every task that has the label." />
      <section class="card settings-card" aria-labelledby="cs-labels">
        <CardHead
          id="cs-labels"
          title="Labels"
          note={
            <>
              {labels.data ? countNote(list().length) : "Loading…"} {saveNote(runner.state(), runner.error())}
            </>
          }
          actions={
            <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setCreating(true)}>
              New label
            </Button>
          }
        />
        <Show when={labels.isError}>
          <CardNoteLine alert>Couldn't load the labels. {failure(labels.error, "")}</CardNoteLine>
        </Show>
        <For each={list()} fallback={<Show when={labels.data}><CardNoteLine>No labels yet.</CardNoteLine></Show>}>
          {(label) => (
            <LabelRow
              label={label}
              labels={labels.data ?? []}
              editing={editing() === label.id}
              onEdit={() => setEditing(label.id)}
              onDone={() => setEditing(null)}
              onRecolor={(color) => recolor(label, color)}
              onDelete={() => setDeleting(label)}
              refresh={refresh}
            />
          )}
        </For>
      </section>
      <NewLabelDialog open={creating()} onClose={() => setCreating(false)} onCreated={() => void refresh()} submitLabel="Create" manageLink={false} />
      <DeleteLabelDialog label={deleting()} onClose={() => setDeleting(null)} onDeleted={refresh} />
    </>
  );
}

function countNote(count: number) {
  return count === 1 ? "1 label" : `${count} labels`;
}

function LabelRow(props: {
  label: IssueLabel;
  labels: readonly IssueLabel[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  refresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const errorId = createUniqueId();
  let field: HTMLInputElement | undefined;

  const start = () => {
    setDraft(props.label.name);
    setError(null);
    props.onEdit();
    queueMicrotask(() => {
      field?.focus();
      field?.select();
    });
  };
  const cancel = () => {
    setError(null);
    props.onDone();
  };
  const save = async () => {
    const name = draft().trim();
    if (name === props.label.name) return cancel();
    const problem = labelNameProblem(props.labels, props.label.id, name);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await taskActionsApi.updateLabel(props.label.id, { name });
      await props.refresh();
      props.onDone();
    } catch (caught) {
      setError(isLabelNameTaken(caught) ? nameTakenMessage(name) : failure(caught, "Couldn't rename the label."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="cs-lrow cs-lrow--wrap lb-row">
      <input
        type="color"
        class="nl-color lb-swatch"
        aria-label={`Color of ${props.label.name}`}
        value={props.label.color}
        onChange={(event) => props.onRecolor(event.currentTarget.value)}
      />
      <Show
        when={props.editing}
        fallback={
          <>
            <span class="cs-grow cs-strong cs-ellipsis">{props.label.name}</span>
            <div class="cs-inline">
              <Button variant="icon" ghost size="compact" aria-label={`Rename ${props.label.name}`} title="Rename" onClick={start}>
                <Pencil size={15} aria-hidden="true" />
              </Button>
              <Button variant="icon" ghost size="compact" aria-label={`Delete ${props.label.name}`} title="Delete" onClick={() => props.onDelete()}>
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </div>
          </>
        }
      >
        <form
          class="cs-grow lb-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div class="lb-edit-line">
            <TextInput
              ref={field}
              aria-label={`New name for ${props.label.name}`}
              value={draft()}
              maxLength={LABEL_NAME_MAX}
              invalid={!!error()}
              aria-describedby={error() ? errorId : undefined}
              disabled={busy()}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancel();
                }
              }}
            />
            <Button type="submit" size="compact" variant="primary" disabled={busy() || !draft().trim()}>
              {busy() ? "Saving…" : "Save"}
            </Button>
            <Button size="compact" variant="quiet" disabled={busy()} onClick={cancel}>
              Cancel
            </Button>
          </div>
          <Show when={error()}>
            <span class="fhelp cs-bad" id={errorId} role="alert">
              {error()}
            </span>
          </Show>
        </form>
      </Show>
    </div>
  );
}

/** Delete, once confirmed. The label comes off every task that has it. */
function DeleteLabelDialog(props: { label: IssueLabel | null; onClose: () => void; onDeleted: () => Promise<unknown> }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const close = () => {
    setError(null);
    props.onClose();
  };
  const remove = async () => {
    const label = props.label;
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      await taskActionsApi.deleteLabel(label.id);
      await props.onDeleted();
      pushToast({ tone: "success", title: `Deleted ${label.name}` });
      close();
    } catch (caught) {
      setError(failure(caught, "Couldn't delete the label."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!props.label}
      onOpenChange={(open) => !open && !busy() && close()}
      title={`Delete “${props.label?.name ?? ""}”?`}
      description="It comes off every task that has it. This can't be undone."
      width={460}
      hideClose
      footer={
        <>
          <Show when={error()}>
            <span class="nt-error ps-foot-error" role="alert">
              {error()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy()} onClick={() => void remove()}>
            {busy() ? "Deleting…" : "Delete label"}
          </Button>
        </>
      }
    />
  );
}
