import type { SecretProposalView } from "@paperclipai/shared";
import { createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { pushToast } from "@/ui/Toast";
import { DECIDED_LIMIT, DECIDED_STATUSES, decidedLabel, proposalMeta, proposalTitle, recentlyDecided, sortPending } from "./secrets-model";
import { CardHead, CardNoteLine, failure } from "./shared";

/*
 * Secrets → Requests (upstream's Proposals tab): the secrets agents asked to save, and the ones
 * they asked to use, while working. The agent sent the value with its request, so approving stores
 * it; declining needs a reason the agent reads. New secrets come first, since access requests
 * depend on them.
 *
 * "Recently decided" lists the latest decisions: one read per decided status with
 * `order=resolved&limit=10` (#21225), so a decision on an old request still makes the page.
 */

export function SecretRequests(props: { onChanged: () => Promise<unknown> }) {
  const company = useCompany();
  const client = useQueryClient();
  const pending = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProposals(company().id),
    queryFn: ({ signal }) => secretsApi.proposals(company().id, signal),
    retry: false,
  }));
  const decidedQueries = createQueries(() => ({
    queries: DECIDED_STATUSES.map((status) => ({
      queryKey: queryKeys.companySettings.secretProposalsDecided(company().id, status),
      queryFn: ({ signal }: { signal: AbortSignal }) => secretsApi.proposals(company().id, signal, { status, order: "resolved", limit: DECIDED_LIMIT }),
      retry: false,
    })),
  }));
  const waiting = createMemo(() => sortPending(pending.data));
  const decided = createMemo(() => recentlyDecided(decidedQueries.map((query) => query.data)));
  const decidedFailed = () => decidedQueries.some((query) => query.isError);
  const [declining, setDeclining] = createSignal<SecretProposalView | null>(null);
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["secret-proposals", company().id] }), props.onChanged()]);

  const approve = async (proposal: SecretProposalView) => {
    setBusy(proposal.id);
    try {
      await secretsApi.approveProposal(company().id, proposal.id, proposal.secretProposalId ? { cascade: true } : {});
      await refresh();
      pushToast({ tone: "success", title: `Approved ${proposalTitle(proposal).name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't approve the request", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    const proposal = declining();
    if (!proposal || !reason().trim()) return;
    try {
      await secretsApi.rejectProposal(company().id, proposal.id, { reason: reason().trim() });
      await refresh();
      pushToast({ tone: "success", title: "Declined the request" });
      setDeclining(null);
      setReason("");
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't decline the request", body: failure(caught, "") || undefined });
    }
  };

  return (
    <>
      <section class="card settings-card" aria-labelledby="sec-req">
        <CardHead
          id="sec-req"
          title={
            <span class="info-line">
              Waiting for a decision
              <InfoTip label="About requests">Agents ask here before they save a secret or use one they don't have. Nothing changes until you approve. The agent sent the value with its request.</InfoTip>
            </span>
          }
        />
        <Switch>
          <Match when={pending.isError}>
            <CardNoteLine alert>Couldn't load the requests. {failure(pending.error, "")}</CardNoteLine>
          </Match>
          <Match when={pending.isLoading}>
            <CardNoteLine>Loading…</CardNoteLine>
          </Match>
          <Match when={waiting().length === 0}>
            <CardNoteLine>You're caught up: no requests are waiting.</CardNoteLine>
          </Match>
          <Match when={true}>
            <For each={waiting()}>
              {(proposal) => {
                const title = () => proposalTitle(proposal);
                return (
                  <div class="cs-lrow cs-lrow--wrap">
                    <div class="cs-person cs-grow">
                      <InitialsDisc name={title().who} seed={proposal.proposedBy.id} size={30} />
                      <span class="cs-person-text">
                        <span>
                          <span class="cs-strong">{title().who}</span> {title().what} <span class="mono">{title().name}</span>
                        </span>
                        <span class="cs-muted">{proposalMeta(proposal)}</span>
                        <Show when={!proposal.viewerCanApprove && proposal.approveBlockReason}>
                          <span class="fhelp">{proposal.approveBlockReason}</span>
                        </Show>
                      </span>
                    </div>
                    <div class="cs-inline">
                      <Button size="compact" variant="primary" disabled={!proposal.viewerCanApprove || busy() === proposal.id} onClick={() => void approve(proposal)}>
                        {proposal.kind === "secret" ? "Save it" : "Allow"}
                      </Button>
                      <Button size="compact" disabled={busy() === proposal.id} onClick={() => setDeclining(proposal)}>
                        Decline
                      </Button>
                    </div>
                  </div>
                );
              }}
            </For>
          </Match>
        </Switch>
      </section>
      <Show when={decided().length > 0 || decidedFailed()}>
        <section class="card settings-card" aria-labelledby="sec-decided">
          <CardHead id="sec-decided" title="Recently decided" />
          <For each={decided()}>
            {(proposal) => {
              const title = () => proposalTitle(proposal);
              return (
                <div class="cs-lrow sec-decided">
                  <span class="cs-muted">
                    <span class="cs-strong">{title().who}</span> {title().what} <span class="mono">{title().name}</span>
                  </span>
                  <span>{decidedLabel(proposal)}</span>
                </div>
              );
            }}
          </For>
          <Show when={decidedFailed()}>
            <CardNoteLine>Some earlier decisions couldn't be loaded.</CardNoteLine>
          </Show>
        </section>
      </Show>
      <Dialog
        open={!!declining()}
        onOpenChange={(open) => !open && setDeclining(null)}
        title="Decline the request?"
        width={460}
        hideClose
        footer={
          <>
            <Button variant="quiet" onClick={() => setDeclining(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!reason().trim()} onClick={() => void decline()}>
              Decline
            </Button>
          </>
        }
      >
        <div class="cs-dialog-body">
          <Field label={<span class="info-line">Why<InfoTip label="About the reason">The agent reads this.</InfoTip></span>} for="sec-decline-reason">
            <TextArea id="sec-decline-reason" rows={3} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
