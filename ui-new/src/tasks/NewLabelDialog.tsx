import type { IssueLabel } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { taskActionsApi } from "@/api/task-actions";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import "./NewLabelDialog.css";

const LABEL_COLORS = ["#6366f1", "#22b5a5", "#f5822a", "#f2286f", "#8b2cf0", "#2fd12f"];

/**
 * A new company label (`POST /companies/:id/labels`), added to the task once it exists. The label
 * pickers of the task's details, the list's rows and the board's cards end with "New label…", which
 * opens it. The menu item that opened it is gone by the time it closes, so focus goes back to
 * `returnFocus`, the menu's trigger.
 */
export function NewLabelDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  returnFocus?: () => HTMLElement | undefined;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const [name, setName] = createSignal("");
  const [color, setColor] = createSignal(LABEL_COLORS[0]!);
  const [busy, setBusy] = createSignal(false);
  let field: HTMLInputElement | undefined;
  const close = () => {
    setName("");
    props.onClose();
  };
  const create = async () => {
    const trimmed = name().trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const created = await taskActionsApi.createLabel(company().id, { name: trimmed, color: color() });
      client.setQueryData<IssueLabel[]>(queryKeys.issues.labels(company().id), (current) =>
        current?.some((label) => label.id === created.id) ? current : [...(current ?? []), created],
      );
      void client.invalidateQueries({ queryKey: queryKeys.issues.labels(company().id) });
      props.onCreated(created.id);
      close();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't create the label", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && close()}
      title="New label"
      width={420}
      initialFocus={() => field}
      returnFocus={props.returnFocus}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy() || !name().trim()} onClick={() => void create()}>
            {busy() ? "Creating…" : "Create and add"}
          </Button>
        </>
      }
    >
      <form
        class="nl-row"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input type="color" class="nl-color" aria-label="Label color" value={color()} onInput={(event) => setColor(event.currentTarget.value)} />
        <TextInput
          ref={field}
          aria-label="Label name"
          placeholder="Label name"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </form>
    </Dialog>
  );
}
