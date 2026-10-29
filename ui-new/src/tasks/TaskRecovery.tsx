import type { Issue } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { ChevronDown, LifeBuoy } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import { canDismissRecovery, recoveryCard, resolveBody, type RecoveryOutcome } from "./recovery-actions";
import { useBoardAccess } from "./TaskActions";

/*
 * The recovery card for a task's active recovery action (recovery-actions.ts), with the notices at
 * the top of every section: what went wrong, the server's next step, and, when a person is needed,
 * the ways out (Try again, Mark done, Send for review, or for the board, dismiss it as raised in
 * error). The old UI drew it in the thread (IssueRecoveryActionCard.tsx).
 */

const STATE_TONE = { needed: "amber", in_progress: "neutral", observing: "neutral" } as const;
const STATE_TITLE = { needed: "Recovery needed", in_progress: "Recovery in progress", observing: "Watching the run" } as const;

export function TaskRecovery(props: { task: Issue }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const access = useBoardAccess();
  const [busy, setBusy] = createSignal(false);
  const card = createMemo(() => {
    const current = access();
    return recoveryCard(props.task.activeRecoveryAction, { board: canDismissRecovery(props.task.companyId, current.access, current.localTrusted) });
  });
  const owner = () => {
    const action = props.task.activeRecoveryAction;
    if (!action) return null;
    if (action.ownerType === "board") return "the board";
    if (action.ownerAgentId) return people.agent(action.ownerAgentId)?.name ?? "an agent";
    if (action.ownerUserId) return action.ownerUserId === people.youId() ? "you" : people.personName(action.ownerUserId);
    return null;
  };

  const resolve = async (outcome: RecoveryOutcome) => {
    const action = props.task.activeRecoveryAction;
    if (!action) return;
    setBusy(true);
    try {
      await issuesApi.resolveRecoveryAction(props.task.id, resolveBody(action.id, outcome));
      pushToast({ tone: "success", title: "Recovery closed" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't close the recovery", body: (error as Error).message });
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    }
  };

  return (
    <Show when={card()}>
      {(found) => (
        <section class="tn-row tn-recovery" data-tone={STATE_TONE[found().state]} role="status" aria-label="Recovery">
          <span class="tn-icon" aria-hidden="true">
            <LifeBuoy size={16} />
          </span>
          <div class="tn-text">
            <b>
              {STATE_TITLE[found().state]} · {found().kindLabel}
            </b>
            <span>{found().headline}</span>
            <Show when={found().nextAction}>{(next) => <span class="tn-recovery-next">Next: {next()}</span>}</Show>
            <span class="tn-recovery-meta">
              <Show when={owner()}>{(who) => <>With {who()}</>}</Show>
              <Show when={found().attempts}>{(attempts) => <> · {attempts()}</>}</Show>
            </span>
          </div>
          <Show when={found().outcomes.length > 0}>
            <div class="tn-action">
              <Menu placement="bottom-end">
                <Menu.Trigger as={Button} size="compact" disabled={busy()}>
                  {busy() ? "Working…" : "Choose next step"}
                  <ChevronDown size={12} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Content label="Next step" width={280}>
                  <For each={found().outcomes}>
                    {(option) => (
                      <Menu.Item danger={option.boardOnly} description={option.description} onSelect={() => void resolve(option.outcome)}>
                        {option.label}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}
