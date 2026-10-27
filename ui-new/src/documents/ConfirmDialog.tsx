import { createSignal, type JSX } from "solid-js";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";

/*
 * A yes-or-no question before something that can't be undone: deleting a document or a file,
 * or leaving unsaved edits.
 */

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: JSX.Element;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = createSignal(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      width={440}
      hideClose
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant={props.danger ? "danger" : "primary"} onClick={() => void confirm()} disabled={busy()}>
            {busy() ? "Working…" : props.confirmLabel}
          </Button>
        </>
      }
    >
      <p class="confirm-body">{props.body}</p>
    </Dialog>
  );
}
