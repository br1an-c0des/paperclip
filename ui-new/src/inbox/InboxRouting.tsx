import type { AttentionItem, AttentionReceipt } from "@paperclipai/shared";
import { CornerDownRight, UserCheck, Users, X } from "lucide-solid";
import { For, Show } from "solid-js";
import { WithdrawDialog } from "@/requests/WithdrawDialog";
import { PersonPicker } from "@/tasks/PersonPicker";
import type { TaskPeople } from "@/tasks/people";
import { stampLabel } from "@/tasks/thread-model";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { InfoTip } from "@/ui/InfoTip";
import { INBOX_VIEWS, ownerLine, receiptLine, unassignedNote, withdrawPrompt, type InboxView } from "./routing-model";
import type { Inbox } from "./use-inbox";

/*
 * Personal routing's pieces in the Inbox (U133, `routing-model.ts`):
 *
 * - The view switch at the start of Needs you's bar: For you, Unassigned, Company, Everyone, each
 *   with how many requests it holds. For you adds a line pointing at Unassigned when requests have
 *   no owner.
 * - The Owner block in a card's context column: whose it is and why, and Claim on an ownerless
 *   card that can hold an owner (key c), or why it can't.
 * - The Close… menu's two dialogs, drawn once: Transfer (a person picker) and Withdraw.
 * - Receipts at the top of For you: what someone else did with a request that was yours.
 */

export function ViewSwitch(props: { view: InboxView; counts: Record<InboxView, number> | null; onChange: (view: InboxView) => void }) {
  return (
    <div class="seg ibx-views" role="group" aria-label="Whose requests">
      <For each={INBOX_VIEWS}>
        {(entry) => (
          <button type="button" aria-pressed={props.view === entry.view} onClick={() => props.onChange(entry.view)}>
            {entry.label}
            <Show when={props.counts}>
              {(counts) => <span class="ibx-kind-count">{counts()[entry.view]}</span>}
            </Show>
          </button>
        )}
      </For>
      <InfoTip label="About these views">
        For you holds what's routed to you: sent or assigned to you, your chats and reviews, the tasks you started, and what you own as a decision
        owner. Unassigned has no owner yet; claim one to make it yours. Company holds alerts for the company's operators. Everyone is every request
        you can see. Where a request shows doesn't change who may answer it.
      </InfoTip>
    </div>
  );
}

/** For you's pointer at Unassigned, when requests have no owner. */
export function UnassignedLine(props: { count: number; onShow: () => void }) {
  return (
    <Show when={props.count > 0}>
      <p class="ibx-unassigned card" role="status">
        <Users size={15} aria-hidden="true" />
        <span>{unassignedNote(props.count)}</span>
        <Button size="compact" variant="quiet" onClick={() => props.onShow()}>
          Show
        </Button>
      </p>
    </Show>
  );
}

/** Whose a card is, in its context column, with Claim when it can take an owner. */
export function OwnerBlock(props: { item: AttentionItem; inbox: Inbox; people: TaskPeople }) {
  // An operator alert is nobody's by design; saying so on every alert would be noise.
  const line = () => {
    const found = ownerLine(props.item, props.people.youId(), props.people.personName);
    return found?.kind === "company" && !found.claimable && !found.why ? null : found;
  };
  const unowned = () => {
    const found = line();
    return found && (found.kind === "pool" || found.kind === "company") ? found : null;
  };
  return (
    <Show when={line()}>
      {(found) => (
        <div class="ibx-owner" data-owner={found().kind}>
          <h4 class="ibx-ctx-h">Who it's for</h4>
          <p class="ibx-owner-line">
            <span>{found().text}</span>
            <Show when={unowned()?.claimable}>
              <Button
                size="compact"
                icon={<UserCheck size={14} aria-hidden="true" />}
                title="Make it yours (c)"
                disabled={props.inbox.routing()}
                onClick={() => props.inbox.claim(props.item)}
              >
                Claim
              </Button>
            </Show>
          </p>
          <Show when={unowned()?.why}>{(why) => <p class="ibx-owner-why">{why()}</p>}</Show>
        </div>
      )}
    </Show>
  );
}

/** Transfer and Withdraw, opened from a card's Close… menu. */
export function RouteDialogs(props: { inbox: Inbox; people: TaskPeople }) {
  const open = (kind: "transfer" | "withdraw") => props.inbox.dialog()?.kind === kind;
  const item = () => props.inbox.dialog()?.item ?? null;
  const owner = () => {
    const found = item();
    return found?.audience?.kind === "user" ? (found.audience.userId ?? null) : null;
  };
  const onOpenChange = (next: boolean) => !next && props.inbox.closeDialog();
  return (
    <>
      <Dialog open={open("transfer")} onOpenChange={onOpenChange} title="Transfer to" width={420}>
        <PersonPicker
          label="Transfer to"
          selected={owner()}
          onPick={(person) => {
            const found = item();
            props.inbox.closeDialog();
            if (found && person.id !== owner()) props.inbox.transfer(found, person.id);
          }}
        />
      </Dialog>
      <WithdrawDialog
        open={open("withdraw")}
        onOpenChange={onOpenChange}
        what="this request"
        body={withdrawPrompt(item() ? ownerLine(item()!, props.people.youId(), props.people.personName) : null)}
        onConfirm={async (reason) => {
          const found = item();
          return found ? props.inbox.withdraw(found, reason) : true;
        }}
      />
    </>
  );
}

/** What someone else did with requests that were yours, at the top of For you. */
export function Receipts(props: { receipts: readonly AttentionReceipt[]; people: TaskPeople; onDismiss: (receipt: AttentionReceipt) => void; onOpen: (receipt: AttentionReceipt) => void }) {
  return (
    <Show when={props.receipts.length > 0}>
      <section class="ibx-group" aria-labelledby="ibx-receipts">
        <h2 class="ibx-sub" id="ibx-receipts">
          Handled for you <span class="ibx-sub-count">{props.receipts.length}</span>
        </h2>
        <ul class="ibx-rows" aria-label="Handled for you">
          <For each={props.receipts}>
            {(receipt) => (
              <li class="ibx-row ibx-receipt">
                <CornerDownRight size={13} aria-hidden="true" class="ibx-receipt-icon" />
                <span class="ibx-receipt-line">{receiptLine(receipt, props.people.personName)}</span>
                <span class="ibx-row-title">{receipt.title ?? receipt.issue?.title ?? "A request"}</span>
                <Show when={receipt.reason}>{(reason) => <span class="ibx-receipt-reason">“{reason()}”</span>}</Show>
                <Show when={receipt.issue}>
                  {(issue) => (
                    <button type="button" class="ibx-row-task mono" onClick={() => props.onOpen(receipt)}>
                      {issue().identifier ?? "Task"}
                    </button>
                  )}
                </Show>
                <span class="ibx-row-when">{stampLabel(receipt.createdAt)}</span>
                <Button variant="icon" size="compact" ghost aria-label="Dismiss" title="Dismiss" onClick={() => props.onDismiss(receipt)}>
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
