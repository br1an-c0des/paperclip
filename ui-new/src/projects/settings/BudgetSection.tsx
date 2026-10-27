import type { Project } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, PauseCircle } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { budgetsApi } from "@/api/budgets";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { formatCents } from "@/projects/dashboard-model";
import { FieldButton, SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { budgetDirty, budgetDraft, budgetProblem, budgetRequests, currentPolicy, parseDollars, projectPolicies, WARN_OPTIONS, windowLabel, type BudgetDraft } from "./settings-model";
import { failure, FootError, refreshProject } from "./shared";

/*
 * Budget (board 10, `section` = budget): the project's spending limit, as the old UI's Budget tab
 * sets it (`POST /companies/:id/budgets/policies`, scope project, billed cents). The board draws a
 * monthly limit; a lifetime one is kept for projects the old UI set up that way. Warn at, and what
 * happens at the limit, are the policy's `warnPercent` and `hardStopEnabled`. Saving is explicit.
 * Company-wide budgets are set in Costs.
 */

export function BudgetSection(props: { project: Project }) {
  const company = useCompany();
  const client = useQueryClient();
  const overview = createQuery(() => ({
    queryKey: queryKeys.projectSettings.budgets(company().id),
    queryFn: ({ signal }) => budgetsApi.overview(company().id, signal),
  }));
  const policies = createMemo(() => projectPolicies(overview.data, props.project.id));
  const policy = createMemo(() => currentPolicy(policies()));
  const [draft, setDraft] = createStore<BudgetDraft>(budgetDraft(null));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  createEffect(on(() => JSON.stringify(budgetDraft(policy())), () => setDraft(reconcile(budgetDraft(policy())))));
  const dirty = () => budgetDirty(policy(), draft);
  const limitOn = () => (parseDollars(draft.amount) ?? 0) > 0;

  const save = async () => {
    const found = budgetProblem(draft);
    if (found) return setProblem(found);
    setBusy(true);
    setProblem(null);
    try {
      for (const request of budgetRequests(props.project.id, policies(), { ...draft })) await budgetsApi.upsertPolicy(company().id, request);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.projectSettings.budgets(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.dashboard(company().id) }),
        refreshProject(client, company().id),
      ]);
      pushToast({ tone: "success", title: limitOn() ? "Saved the budget" : "Turned the budget off" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the budget."));
      void client.invalidateQueries({ queryKey: queryKeys.projectSettings.budgets(company().id) });
    } finally {
      setBusy(false);
    }
  };

  const percent = () => {
    const current = policy();
    return current && current.amount > 0 ? Math.min(100, Math.max(0, current.utilizationPercent)) : null;
  };
  const tone = () => (policy()?.status === "hard_stop" ? "over" : policy()?.status === "warning" ? "warn" : "ok");

  return (
    <SettingsCard
      title={draft.windowKind === "lifetime" ? "Lifetime budget" : "Monthly budget"}
      description="What agents may spend on this project. Company-wide budgets are set in Costs."
      footer={
        dirty() || problem() ? (
          <span class="ps-foot-end">
            <FootError message={problem()} />
            <Show when={dirty()}>
              <Button size="compact" variant="quiet" disabled={busy()} onClick={() => setDraft(reconcile(budgetDraft(policy())))}>
                Discard
              </Button>
              <Button size="compact" variant="primary" disabled={busy()} onClick={() => void save()}>
                {busy() ? "Saving…" : "Save budget"}
              </Button>
            </Show>
          </span>
        ) : undefined
      }
    >
      <Show when={props.project.pausedAt && props.project.pauseReason === "budget"}>
        <div class="ps-banner ps-banner--red" role="status">
          <PauseCircle size={16} aria-hidden="true" />
          This project's agent runs are paused: it reached its budget. Raise the limit to let them run again.
        </div>
      </Show>
      <Show when={overview.isError}>
        <p class="ps-list-note" role="alert">
          Couldn't load the budget. {failure(overview.error, "")}
        </p>
      </Show>
      <SettingsRow label="Period">
        <Segmented
          label="Budget period"
          options={[
            { value: "calendar_month_utc", label: "Monthly" },
            { value: "lifetime", label: "Lifetime" },
          ]}
          value={draft.windowKind}
          onChange={(value) => setDraft("windowKind", value)}
        />
      </SettingsRow>
      <SettingsRow label={draft.windowKind === "lifetime" ? "Limit" : "Monthly limit"} help="Leave it empty for no limit." for="ps-budget-amount">
        <div class="ps-money">
          <span aria-hidden="true">$</span>
          <TextInput
            id="ps-budget-amount"
            inputmode="decimal"
            placeholder="0.00"
            autocomplete="off"
            value={draft.amount}
            invalid={parseDollars(draft.amount) === null}
            onInput={(event) => {
              setProblem(null);
              setDraft("amount", event.currentTarget.value);
            }}
          />
        </div>
      </SettingsRow>
      <Show when={policy()}>
        {(current) => (
          <SettingsRow label={windowLabel(current().windowKind)}>
            <div class="ps-spend">
              <div class="ps-inline">
                <span class="ps-spend-amount">{formatCents(current().observedAmount)}</span>
                <span class="ps-muted-line">spent{percent() !== null ? ` · ${percent()}%` : ""}</span>
              </div>
              <Show when={percent() !== null}>
                <div class="ps-meter" classList={{ "ps-meter--warn": tone() === "warn", "ps-meter--over": tone() === "over" }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent()!} aria-label="Budget used">
                  <span style={{ width: `${percent()}%` }} />
                </div>
              </Show>
              <Show when={current().pendingRunCount > 0 || current().unpricedEventCount > 0}>
                <span class="fhelp">
                  {current().pendingRunCount > 0 ? `${current().pendingRunCount} finished runs aren't counted yet. ` : ""}
                  {current().unpricedEventCount > 0 ? `${current().unpricedEventCount} usage events have no price, so their cost isn't included.` : ""}
                </span>
              </Show>
            </div>
          </SettingsRow>
        )}
      </Show>
      <Show when={limitOn()}>
        <SettingsRow label="Warn me at">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" aria-label={`Warn at ${draft.warnPercent}% of the limit`}>
              {draft.warnPercent}% of the limit
            </Menu.Trigger>
            <Menu.Content label="Warn at" width={220}>
              <For each={WARN_OPTIONS.includes(draft.warnPercent) ? WARN_OPTIONS : [...WARN_OPTIONS, draft.warnPercent].sort((a, b) => a - b)}>
                {(value) => (
                  <Menu.Item onSelect={() => setDraft("warnPercent", value)} hint={value === draft.warnPercent ? <Check size={14} /> : undefined}>
                    {value}% of the limit
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </SettingsRow>
        <SettingsRow label="When the limit is reached">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label="When the limit is reached">
              {draft.hardStop ? "Pause this project's agent runs" : "Only warn me"}
            </Menu.Trigger>
            <Menu.Content label="When the limit is reached" width={300}>
              <Menu.Item onSelect={() => setDraft("hardStop", true)} description="New runs wait until the limit is raised" hint={draft.hardStop ? <Check size={14} /> : undefined}>
                Pause this project's agent runs
              </Menu.Item>
              <Menu.Item onSelect={() => setDraft("hardStop", false)} description="Runs carry on past the limit" hint={draft.hardStop ? undefined : <Check size={14} />}>
                Only warn me
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </SettingsRow>
      </Show>
    </SettingsCard>
  );
}
