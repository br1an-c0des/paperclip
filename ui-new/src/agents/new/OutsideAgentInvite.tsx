import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Bot, Check, Copy, Inbox, LoaderCircle, TriangleAlert } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { accessApi } from "@/api/access";
import { invitesApi, type AgentInviteCreated } from "@/api/invites";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { copyText } from "@/tasks/TaskActions";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { pushToast } from "@/ui/Toast";
import { failure, shortDate } from "../shared";
import { buildAgentOnboardingPrompt, hasCeo, onboardingTextUrl, OUTSIDE_PRESETS, requestsForInvite, type OutsidePreset } from "./outside-agent-model";

/*
 * Invite an outside agent (decision 39, D2; guides/outside-agents.md), from New agent: pick Hermes
 * or Other, and Paperclip creates an agent-only invite (`POST /companies/:id/invites`) and shows the
 * prompt to paste into the agent, with the addresses from the invite's onboarding manifest
 * (`GET /invites/:token/onboarding`). The dialog then waits for the agent's join request, which is
 * approved or rejected in the Inbox; it watches the pending join requests while it's open.
 *
 * Approving needs an agent with the CEO role (the server files the new agent under it, decision
 * 40), so the dialog warns before creating an invite in a company without one. The invite lasts
 * until it expires or is revoked; Revoke takes it back. Dot, Grok and Muse are dropped (D2).
 */

type Stage = { kind: "pick" } | { kind: "creating"; preset: OutsidePreset } | { kind: "ready"; preset: OutsidePreset; invite: AgentInviteCreated; prompt: string } | { kind: "failed"; preset: OutsidePreset; error: string };

export function OutsideAgentInvite(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const [stage, setStage] = createSignal<Stage>({ kind: "pick" });
  const [copied, setCopied] = createSignal(false);
  const [revoking, setRevoking] = createSignal(false);
  const ceo = () => hasCeo(agents.data);
  const invite = () => {
    const current = stage();
    return current.kind === "ready" ? current.invite : null;
  };
  const preset = () => {
    const current = stage();
    return current.kind === "pick" ? null : OUTSIDE_PRESETS.find((entry) => entry.value === current.preset)!;
  };
  const requests = createQuery(() => ({
    queryKey: queryKeys.companySettings.joinRequests(company().id),
    queryFn: ({ signal }) => accessApi.joinRequests(company().id, signal),
    enabled: props.open && !!invite(),
    refetchInterval: 5000,
    retry: false,
  }));
  const arrived = createMemo(() => requestsForInvite(requests.data, invite()?.id ?? null));

  const create = async (choice: OutsidePreset) => {
    setStage({ kind: "creating", preset: choice });
    setCopied(false);
    try {
      const created = await invitesApi.createForAgent(company().id);
      void client.invalidateQueries({ queryKey: queryKeys.companySettings.invites(company().id) });
      const manifest = await invitesApi.onboarding(created.token).catch(() => null);
      const prompt = buildAgentOnboardingPrompt({
        onboardingTextUrl: onboardingTextUrl(created, window.location.origin),
        connectionCandidates: manifest?.onboarding.connectivity?.connectionCandidates ?? null,
        testResolutionUrl: manifest?.onboarding.connectivity?.testResolutionEndpoint?.url ?? null,
      });
      setStage({ kind: "ready", preset: choice, invite: created, prompt });
    } catch (caught) {
      setStage({ kind: "failed", preset: choice, error: failure(caught, "Couldn't create the invite.") });
    }
  };
  const copy = async (prompt: string) => {
    try {
      await copyText(prompt);
      setCopied(true);
      pushToast({ tone: "success", title: "Copied the invitation prompt" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't copy the prompt", body: failure(caught, "") || undefined });
    }
  };
  const revoke = async () => {
    const current = invite();
    if (!current) return;
    setRevoking(true);
    try {
      await accessApi.revokeInvite(current.id);
      void client.invalidateQueries({ queryKey: queryKeys.companySettings.invites(company().id) });
      pushToast({ tone: "success", title: "Revoked the invite", body: "The prompt no longer works." });
      close();
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't revoke the invite", body: failure(caught, "") || undefined });
    } finally {
      setRevoking(false);
    }
  };
  const close = () => {
    props.onOpenChange(false);
    setStage({ kind: "pick" });
    setCopied(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      title={preset() ? `Invite your ${preset()!.value === "hermes" ? "Hermes agent" : "agent"}` : "Invite an outside agent"}
      description={
        preset()
          ? `Send the prompt to the agent. It reads Paperclip's onboarding, asks to join ${company().name}, and starts work once you approve it.`
          : `Bring in an agent that runs on its own, on another machine or service. Paperclip wakes it by calling it; it reports back through the API.`
      }
      width={640}
      footer={
        <Switch>
          <Match when={stage().kind === "pick"}>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
          </Match>
          <Match when={stage().kind === "failed"}>
            <Button variant="quiet" onClick={() => setStage({ kind: "pick" })}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void create((stage() as { preset: OutsidePreset }).preset)}>
              Try again
            </Button>
          </Match>
          <Match when={stage().kind === "ready"}>
            <Button variant="quiet" disabled={revoking()} onClick={() => void revoke()}>
              {revoking() ? "Revoking…" : "Revoke invite"}
            </Button>
            <span class="oa-foot-end">
              <Show
                when={arrived().length > 0}
                fallback={
                  <Button variant="primary" icon={copied() ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void copy((stage() as { prompt: string }).prompt)}>
                    {copied() ? "Copied" : "Copy prompt"}
                  </Button>
                }
              >
                <Button variant="quiet" onClick={close}>
                  Close
                </Button>
                <A class={buttonClass({ variant: "primary" })} href={`/${company().issuePrefix}/inbox`} onClick={close}>
                  Review in the Inbox
                </A>
              </Show>
            </span>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={stage().kind === "pick"}>
          <Show when={agents.isSuccess && !ceo()}>
            <div class="oa-warn" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>
                <b>{company().name} has no CEO agent.</b> Paperclip files an outside agent under the CEO when you approve it, so approving would fail. Give one of your agents the CEO role
                (Profile → Role) first; you can still create the invite now.
              </span>
            </div>
          </Show>
          <div class="oa-presets">
            <For each={OUTSIDE_PRESETS}>
              {(entry) => (
                <button type="button" class="oa-preset" onClick={() => void create(entry.value)}>
                  <span class="oa-preset-mark" aria-hidden="true">
                    <Show when={entry.value === "hermes"} fallback={<Bot size={20} />}>
                      HM
                    </Show>
                  </span>
                  <span class="oa-preset-name">{entry.name}</span>
                  <span class="oa-preset-text">{entry.description}</span>
                </button>
              )}
            </For>
          </div>
          <p class="fhelp">
            Agents you run here, such as Claude Code or Codex, are better hired with New agent: Paperclip can then show their transcripts, count their spend and keep to a budget.
          </p>
        </Match>
        <Match when={stage().kind === "creating"}>
          <p class="oa-status" role="status">
            <LoaderCircle size={14} class="cmp-spin" aria-hidden="true" /> Preparing the invite…
          </p>
        </Match>
        <Match when={stage().kind === "failed"}>
          <p class="nt-error" role="alert">
            {(stage() as { error: string }).error}
          </p>
        </Match>
        <Match when={stage().kind === "ready"}>
          <label class="field-label" for="oa-prompt">
            Invitation prompt
          </label>
          <textarea id="oa-prompt" class="input input--area mono oa-prompt" readOnly rows={10} value={(stage() as { prompt: string }).prompt} onFocus={(event) => event.currentTarget.select()} />
          <p class="fhelp">
            Valid until {shortDate(invite()?.expiresAt)}. Anyone with this prompt can ask to join as an agent; nothing joins until you approve it.
          </p>
          <div class="oa-wait" role="status" aria-live="polite">
            <Show
              when={arrived()[0]}
              fallback={
                <>
                  <LoaderCircle size={14} class="cmp-spin" aria-hidden="true" />
                  <span>
                    Waiting for the agent's join request. It appears in the <A href={`/${company().issuePrefix}/inbox`}>Inbox</A> under Needs you, where you approve it.
                  </span>
                </>
              }
            >
              {(request) => (
                <>
                  <Inbox size={14} aria-hidden="true" />
                  <span>
                    <b>{request().agentName ?? "An agent"}</b> asked to join. Approve or reject it in the Inbox.
                  </span>
                </>
              )}
            </Show>
          </div>
        </Match>
      </Switch>
    </Dialog>
  );
}
