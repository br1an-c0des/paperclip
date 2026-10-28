import { AGENT_ADAPTER_TYPES, type AgentAdapterType } from "@paperclipai/shared";
import { A, useNavigate, useParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { companiesApi } from "@/api/companies";
import { invitesApi, type AcceptInviteResult, type AgentJoinRequestAccepted } from "@/api/invites";
import { queryKeys } from "@/api/queryKeys";
import { harnessLabel } from "@/agents/agent-model";
import { failure } from "@/agents/shared";
import { rememberCompany } from "@/lib/company";
import { CompanyMark } from "@/routes/Companies";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { AuthForm } from "./AuthForm";
import {
  clearPendingInvite,
  INVITE_HARNESSES,
  inviteView,
  isBootstrapAccepted,
  nestedString,
  rememberPendingInvite,
  roleName,
  type AuthMode,
} from "./auth-model";
import { useOutsideSession } from "./outside";
import { Facts, Note, Standalone } from "./Standalone";

/*
 * `/invite/:token`: accept an invite, after ui/src/pages/InviteLanding.tsx. Someone signed out on an
 * authenticated instance creates an account (or signs in) right here, then the invite is accepted
 * for them. A person's invite joins at once or waits for an admin's approval; an agent's invite
 * collects the agent's details and gives back a claim secret for its API key; a bootstrap invite
 * makes the first instance admin. The token is remembered so signing in elsewhere comes back here.
 */

const AGENT_HARNESS_OPTIONS = AGENT_ADAPTER_TYPES.filter((type) => type !== "paperclip_runner");

export function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = () => (params.token ?? "").trim();
  const navigate = useNavigate();
  const client = useQueryClient();
  const outside = useOutsideSession();

  const invite = createQuery(() => ({
    queryKey: ["invite", token()] as const,
    queryFn: () => invitesApi.get(token()),
    enabled: !!token(),
    retry: false,
  }));
  // The signed-in person's organizations, fresh, to tell whether they're already a member.
  const userId = () => outside.session.data?.user.id ?? null;
  const companies = createQuery(() => ({
    queryKey: queryKeys.companies.list(userId()),
    queryFn: companiesApi.list,
    enabled: !!outside.session.data && !!invite.data?.companyId,
    staleTime: 0,
  }));
  const fresh = () => (companies.isFetchedAfterMount ? companies.data : undefined);

  createEffect(() => token() && rememberPendingInvite(token()));

  const view = () =>
    invite.data
      ? inviteView({
          invite: invite.data,
          authenticated: outside.authenticated(),
          signedIn: outside.signedIn(),
          companyIds: fresh()?.map((company) => company.id) ?? (outside.signedIn() && invite.data.companyId ? undefined : []),
        })
      : null;
  const companyName = () => invite.data?.companyName?.trim() || "this organization";
  const companyPrefix = () => fresh()?.find((company) => company.id === invite.data?.companyId)?.issuePrefix;

  /** Opens the organization: its own address once the list has it, else `/`. */
  const openCompany = async () => {
    clearPendingInvite(token());
    const list = await client.fetchQuery({ queryKey: queryKeys.companies.list(userId()), queryFn: companiesApi.list, staleTime: 0 }).catch(() => undefined);
    const prefix = list?.find((company) => company.id === invite.data?.companyId)?.issuePrefix;
    if (prefix) rememberCompany(prefix);
    navigate(prefix ? `/${prefix}` : "/", { replace: true });
  };

  // ---- Accepting --------------------------------------------------------------------------
  const [result, setResult] = createSignal<AcceptInviteResult | null>(null);
  const [agentName, setAgentName] = createSignal("");
  const [harness, setHarness] = createSignal<AgentAdapterType>("claude_local");
  const [capabilities, setCapabilities] = createSignal("");

  const accept = createMutation(() => ({
    mutationFn: () => {
      const found = invite.data;
      if (!found) throw new Error("Invite not found.");
      if (view()?.kind === "agent_form") {
        return invitesApi.accept(token(), { requestType: "agent", agentName: agentName().trim(), adapterType: harness(), capabilities: capabilities().trim() || null });
      }
      return invitesApi.accept(token(), { requestType: "human" });
    },
    onSuccess: async (payload: AcceptInviteResult) => {
      clearPendingInvite(token());
      setResult(payload);
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
      await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      if (!isBootstrapAccepted(payload) && view()?.kind !== "agent_form" && payload.status === "approved") await openCompany();
    },
  }));

  // A signed-in person's invite is accepted as soon as it's clear they aren't a member yet.
  let autoStarted = false;
  createEffect(
    on(view, (current) => {
      if (current?.kind !== "accept" || !current.auto || autoStarted || result()) return;
      autoStarted = true;
      accept.mutate();
    }),
  );

  // ---- Signing up or in ------------------------------------------------------------------
  const [mode, setMode] = createSignal<AuthMode>("sign_up");
  const onSignedIn = async () => {
    rememberPendingInvite(token());
    await client.invalidateQueries({ queryKey: queryKeys.auth.session });
    await client.invalidateQueries({ queryKey: queryKeys.health });
    await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
    // A bootstrap invite isn't accepted automatically; accept it straight after the sign-up.
    if (invite.data?.inviteType === "bootstrap_ceo") {
      const payload = await accept.mutateAsync();
      if (isBootstrapAccepted(payload)) navigate("/", { replace: true });
    }
  };

  const joined = () => {
    const payload = result();
    return payload && !isBootstrapAccepted(payload) ? (payload as AgentJoinRequestAccepted) : null;
  };
  const mark = () => (invite.data ? <CompanyMark company={{ id: invite.data.companyId ?? invite.data.id, name: companyName(), logoUrl: invite.data.companyLogoUrl ?? null }} size={48} /> : undefined);
  const openBoard = <A class={buttonClass({ variant: "primary", size: "compact" })} href="/">Open the board</A>;

  return (
    <Switch>
      <Match when={!token()}>
        <Splash title="This invite link is incomplete">Copy the whole link you were sent.</Splash>
      </Match>
      <Match when={invite.isLoading || outside.loading()}>
        <Splash title="Loading the invite" quiet />
      </Match>
      <Match when={invite.error || !invite.data}>
        <Splash title="This invite isn't available">It may have expired, been revoked, or been used already.</Splash>
      </Match>
      <Match when={result() && isBootstrapAccepted(result())}>
        <Splash title="Setup complete" actions={openBoard}>
          Your account is this Paperclip's instance admin.
        </Splash>
      </Match>
      <Match when={joined()}>
        {(payload) => (
          <Show
            when={payload().status !== "approved" || view()?.kind === "agent_form"}
            fallback={<Splash title={`You joined ${companyName()}`} quiet />}
          >
            <AwaitingApproval
              mark={mark()}
              companyName={companyName()}
              invitedBy={invite.data?.invitedByUserName?.trim() || null}
              claimSecret={payload().claimSecret ?? null}
              claimPath={payload().claimApiKeyPath ?? null}
              onboardingUrl={nestedString(payload().onboarding, ["textInstructions", "url"])}
            />
          </Show>
        )}
      </Match>
      <Match when={view()?.kind === "checking"}>
        <Splash title="Checking your access" quiet />
      </Match>
      <Match when={view()?.kind === "member"}>
        <Standalone mark={mark()} title={`You're already in ${companyName()}`} lede={`${outside.who()} already belongs to this organization.`}>
          <div class="stand-actions">
            <Button variant="primary" onClick={() => void openCompany()}>
              Open {companyPrefix() ? companyName() : "the organization"}
            </Button>
          </div>
        </Standalone>
      </Match>
      <Match when={view()?.kind === "awaiting_approval"}>
        <AwaitingApproval mark={mark()} companyName={companyName()} invitedBy={invite.data?.invitedByUserName?.trim() || null} />
      </Match>
      <Match when={view()?.kind === "unavailable" && (view() as { reason: string })}>
        {(found) => <Splash title="This invite isn't available">{found().reason}</Splash>}
      </Match>
      <Match when={invite.data}>
        {(data) => (
          <Standalone
            wide
            mark={mark()}
            eyebrow="You're invited to Paperclip"
            title={data().inviteType === "bootstrap_ceo" ? "Set up Paperclip" : `Join ${companyName()}`}
            lede={
              view()?.kind === "agent_form"
                ? "This invite is for an agent. Fill in its details to send the join request."
                : view()?.kind === "account"
                  ? "Create your Paperclip account first, or sign in if you already have one, and the invite is accepted for you."
                  : undefined
            }
          >
            <Facts
              rows={[
                ["Organization", companyName()],
                ["Invited by", data().invitedByUserName?.trim() || "Paperclip board"],
                ["Access", view()?.kind === "agent_form" ? "Agent join request" : (roleName(data().humanRole) ?? "Organization access")],
                ["Expires", new Date(data().expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })],
              ]}
            />
            <Show when={data().inviteMessage?.trim()}>{(message) => <Note tone="amber">{message()}</Note>}</Show>
            <Show when={outside.authenticated() && outside.signedIn()}>
              <p class="stand-muted">Signed in as {outside.who()}</p>
            </Show>

            <Switch>
              <Match when={view()?.kind === "agent_form"}>
                <form
                  class="stand-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (agentName().trim()) accept.mutate();
                  }}
                >
                  <Field label="Agent name" for="invite-agent-name">
                    <TextInput id="invite-agent-name" required value={agentName()} onInput={(event) => setAgentName(event.currentTarget.value)} />
                  </Field>
                  <Field label="Harness" for="invite-agent-harness">
                    <select id="invite-agent-harness" class="input stand-select" value={harness()} onChange={(event) => setHarness(event.currentTarget.value as AgentAdapterType)}>
                      <For each={AGENT_HARNESS_OPTIONS}>
                        {(type) => (
                          <option value={type} disabled={!INVITE_HARNESSES.has(type)}>
                            {harnessLabel(type)}
                            {INVITE_HARNESSES.has(type) ? "" : " (coming soon)"}
                          </option>
                        )}
                      </For>
                    </select>
                  </Field>
                  <Field label="What it does" for="invite-agent-caps">
                    <TextArea id="invite-agent-caps" rows={4} value={capabilities()} onInput={(event) => setCapabilities(event.currentTarget.value)} />
                  </Field>
                  <Show when={accept.error}>{(error) => <Note tone="red" alert>{failure(error(), "Couldn't send the request.")}</Note>}</Show>
                  <div class="stand-actions stand-actions--end">
                    <Button type="submit" variant="primary" disabled={accept.isPending || !agentName().trim()}>
                      {accept.isPending ? "Sending…" : "Send join request"}
                    </Button>
                  </div>
                </form>
              </Match>
              <Match when={view()?.kind === "account"}>
                <AuthForm
                  mode={mode()}
                  onModeChange={setMode}
                  onSignedIn={onSignedIn}
                  idPrefix="invite"
                  submitLabel={(current) => (current === "sign_in" ? "Sign in and continue" : "Create account and continue")}
                />
              </Match>
              <Match when={view()?.kind === "accept" && (view() as { auto: boolean })}>
                {(current) => (
                  <>
                    <Show when={accept.error}>{(error) => <Note tone="red" alert>{failure(error(), "Couldn't accept the invite.")}</Note>}</Show>
                    <div class="stand-actions">
                      <Show
                        when={!current().auto || accept.error}
                        fallback={<p class="stand-muted" role="status">Joining {companyName()}…</p>}
                      >
                        <Button variant="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
                          {accept.isPending ? "Working…" : data().inviteType === "bootstrap_ceo" ? "Finish setup" : "Accept invite"}
                        </Button>
                      </Show>
                    </div>
                  </>
                )}
              </Match>
            </Switch>
          </Standalone>
        )}
      </Match>
    </Switch>
  );
}

/** A join request waiting for an admin, with an agent's claim details when it has them. */
function AwaitingApproval(props: {
  mark?: JSX.Element;
  companyName: string;
  invitedBy: string | null;
  claimSecret?: string | null;
  claimPath?: string | null;
  onboardingUrl?: string | null;
}) {
  return (
    <Standalone
      mark={props.mark}
      title={`Request to join ${props.companyName}`}
      lede={`${props.invitedBy ?? "An organization admin"} needs to approve it, from Settings → Members. Open this link again once it's approved.`}
    >
      <Show when={props.claimSecret && props.claimPath}>
        <Facts
          rows={[
            ["Claim secret", <span class="mono">{props.claimSecret}</span>],
            ["Claim the API key with", <span class="mono">POST {props.claimPath}</span>],
          ]}
        />
      </Show>
      <Show when={props.onboardingUrl}>
        <p class="stand-muted">
          Agent onboarding: <span class="mono">{props.onboardingUrl}</span>
        </p>
      </Show>
    </Standalone>
  );
}
