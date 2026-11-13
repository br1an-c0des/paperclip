import { createEffect, createSignal, on } from "solid-js";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextArea } from "@/ui/Field";

/*
 * Withdrawing a request that's out of date (upstream #20959, U133): it ends for everyone, never as an
 * approval, and whoever asked is told, with the reason when one is given. The Inbox's Close… menu
 * (`POST …/attention/:sourceKind/:sourceId/close`, mode `withdraw`), the approval card's own menu and
 * the approval page (`POST /approvals/:id/cancel`) all ask here first.
 *
 * `onConfirm` resolves true once it's withdrawn; on false the dialog stays open, and the caller has
 * already said why.
 */

export function WithdrawDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's withdrawn, for the title: "Withdraw this approval?" */
  what: string;
  /** What withdrawing does, as state (whose it is, that it isn't approved). */
  body: string;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(on(() => props.open, (open) => open && setReason("")));
  const confirm = async () => {
    setBusy(true);
    try {
      if (await props.onConfirm(reason())) props.onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Withdraw ${props.what}?`}
      width={460}
      hideClose
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy()}>
            {busy() ? "Withdrawing…" : "Withdraw for everyone"}
          </Button>
        </>
      }
    >
      <p class="confirm-body">{props.body}</p>
      <TextArea
        aria-label="Why it's out of date (optional)"
        placeholder="Why it's out of date (optional)"
        rows={3}
        maxLength={4000}
        value={reason()}
        onInput={(event) => setReason(event.currentTarget.value)}
      />
    </Dialog>
  );
}
