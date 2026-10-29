import type { GitHubAppWizardState } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { chatEndpointsApi, githubChatApi, type ChatEndpoint, type GitHubIdentity } from "@/api/chat-endpoints";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { failureText } from "../shared";
import { defaultAppName, failingChecks, knownOrganizations, manifestAction, wizardPollMs } from "./github-model";
import "./ChatExtras.css";

/*
 * GitHub's guided App registration (the old UI's GitHubChatSetup), the Connect step for a new
 * GitHub review bot. Paperclip writes the App's manifest; you post it to github.com, create the App
 * there and install it; GitHub sends you back here.
 *
 * `POST …/github/setup` says where it stands, and the page polls it until it settles:
 *
 * - create: whose GitHub account owns the App (yours or an organization) and its name, then
 *   Continue to GitHub posts the manifest form to GitHub's new-App page.
 * - install: waiting for the installation (or an administrator's approval).
 * - identity: link your own GitHub account, from a connection you have or GitHub's sign-in, so your
 *   mentions use your Paperclip permissions.
 * - verify: checking App, webhook and repository access; the failing checks are listed.
 * - recovery: the registration expired. Start again once you confirm no App was made, or use the
 *   App's credentials (the manual form).
 * - enrollment: Paperclip Cloud must relay GitHub's events. Cloud connector enrollment isn't part
 *   of this board, so it says so.
 * - connected: on to the bot's settings.
 *
 * Save and exit keeps the account and name as a draft (`PUT …/github/draft`).
 */

export function GitHubGuidedSetup(props: { endpoint: ChatEndpoint; base: string; onOwnApp: () => void; onExit: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const id = () => props.endpoint.id;
  const wizardKey = () => queryKeys.chatEndpoints.part(company().id, id(), "github-wizard");

  const wizard = createQuery(() => ({
    queryKey: wizardKey(),
    queryFn: () => githubChatApi.advance(id()),
    refetchInterval: (query) => wizardPollMs(query.state.data?.state),
    retry: false,
  }));
  const state = () => wizard.data;
  const setState = (next: GitHubAppWizardState) => client.setQueryData(wizardKey(), next);

  createEffect(
    on(
      () => state()?.state,
      (current) => {
        if (current !== "connected") return;
        void client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.all(company().id) });
        pushToast({ tone: "success", title: `${props.endpoint.assignedAgentName} is on GitHub`, body: "Choose its repositories and review settings." });
        navigate(`${props.base}/chat/${id()}/settings`, { replace: true });
      },
    ),
  );

  return (
    <div class="ch-step-body">
      <Switch>
        <Match when={wizard.isPending}>
          <p class="cx-static" role="status">
            Checking your GitHub connection…
          </p>
        </Match>
        <Match when={wizard.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(wizard.error, "Couldn't check GitHub setup.")}
          </p>
          <div class="cx-actions">
            <Button variant="quiet" onClick={() => props.onExit()}>
              Save and exit
            </Button>
            <Button variant="primary" onClick={() => void wizard.refetch()}>
              Try again
            </Button>
          </div>
        </Match>
        <Match when={state()?.state === "create"}>
          <CreateApp endpoint={props.endpoint} state={state()!} onState={setState} onOwnApp={props.onOwnApp} onExit={props.onExit} />
        </Match>
        <Match when={state()?.state === "install"}>
          <p class="cx-static" role="status">
            Waiting for GitHub to install the App, or for an administrator to approve it…
          </p>
          <Show when={state()!.installationUrl}>
            {(url) => (
              <a class={buttonClass({ size: "compact" })} href={url()}>
                Continue the installation on GitHub
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </Show>
          <WizardFoot onExit={props.onExit} />
        </Match>
        <Match when={state()?.state === "identity"}>
          <IdentityStep endpoint={props.endpoint} state={state()!} onState={setState} onRefresh={() => void wizard.refetch()} onExit={props.onExit} base={props.base} />
        </Match>
        <Match when={state()?.state === "verify"}>
          <p class="cx-static" role="status">
            {props.endpoint.setup?.webhookVerifiedAt ? "GitHub delivery verified. Checking App and repository access…" : (state()!.message ?? "Checking GitHub access…")}
          </p>
          <ul class="ch-checks">
            <For each={failingChecks(state()!, Boolean(props.endpoint.setup?.webhookVerifiedAt))}>
              {(check) => (
                <li>
                  <b>{check.label}</b> {check.detail}
                </li>
              )}
            </For>
          </ul>
          <A href={`${props.base}/chat/${id()}/settings`}>Connection settings</A>
          <WizardFoot onExit={props.onExit} label="Try again" pending={wizard.isFetching} onNext={() => void wizard.refetch()} />
        </Match>
        <Match when={state()?.state === "recovery"}>
          <Recovery endpoint={props.endpoint} state={state()!} onState={setState} onOwnApp={props.onOwnApp} onExit={props.onExit} onRefresh={() => void wizard.refetch()} />
        </Match>
        <Match when={state()?.state === "enrollment"}>
          <p class="cx-note">
            This Paperclip receives GitHub's events through Paperclip Cloud, which needs this instance enrolled first. Enrollment isn't part of this board:
            enroll from the old UI, or use an App of your own with this Paperclip's own webhook address.
          </p>
          <Button size="compact" onClick={() => props.onOwnApp()}>
            Use an App I made
          </Button>
          <WizardFoot onExit={props.onExit} />
        </Match>
        <Match when={state()?.state === "connected"}>
          <p class="cx-ok" role="status">
            Connected. Opening its settings…
          </p>
        </Match>
      </Switch>
    </div>
  );
}

function WizardFoot(props: { onExit: () => void; label?: string; pending?: boolean; disabled?: boolean; onNext?: () => void }) {
  return (
    <div class="cx-actions">
      <Button variant="quiet" disabled={props.pending} onClick={() => props.onExit()}>
        Save and exit
      </Button>
      <Show when={props.label && props.onNext}>
        <Button variant="primary" disabled={props.pending || props.disabled} onClick={() => props.onNext?.()}>
          {props.pending ? "Working…" : props.label}
        </Button>
      </Show>
    </div>
  );
}

/** Whose account owns the App and its name; then the manifest goes to github.com. */
function CreateApp(props: {
  endpoint: ChatEndpoint;
  state: GitHubAppWizardState;
  onState: (next: GitHubAppWizardState) => void;
  onOwnApp: () => void;
  onExit: () => void;
}) {
  const company = useCompany();
  const github = () => props.endpoint.setup?.github;
  const [ownerType, setOwnerType] = createSignal<"personal" | "organization">(github()?.ownerType ?? "personal");
  const [ownerLogin, setOwnerLogin] = createSignal(github()?.ownerLogin ?? "");
  const [custom, setCustom] = createSignal(false);
  const [name, setName] = createSignal(github()?.appName ?? defaultAppName(props.endpoint.assignedAgentName));
  const [autoSubmit, setAutoSubmit] = createSignal(false);
  let form: HTMLFormElement | undefined;

  const repositories = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "github-orgs", "repositories"),
    queryFn: ({ signal }) => projectsApi.repositoryOptions(company().id, signal),
    staleTime: 30_000,
    retry: false,
  }));
  const endpoints = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.list(company().id),
    queryFn: ({ signal }) => chatEndpointsApi.list(company().id, signal),
    staleTime: 30_000,
  }));
  const organizations = createMemo(() => knownOrganizations(repositories.data?.repositories ?? [], endpoints.data ?? []));
  const known = () => organizations().find((login) => login.toLowerCase() === ownerLogin().trim().toLowerCase());
  const choice = () => (ownerType() === "personal" ? "personal" : !custom() && known() ? `organization:${known()}` : "organization");
  const input = () => ({ name: name().trim().slice(0, 34) || defaultAppName(props.endpoint.assignedAgentName), ownerType: ownerType(), ...(ownerType() === "organization" ? { ownerLogin: ownerLogin().trim() } : {}) });
  const registration = () => props.state.registration ?? null;
  const action = createMemo(() => {
    const current = registration();
    if (!current) return null;
    try {
      return manifestAction(current.registrationUrl);
    } catch {
      return null;
    }
  });

  const register = createMutation(() => ({
    mutationFn: () => githubChatApi.registration(props.endpoint.id, input()),
    onSuccess: (next) => {
      setAutoSubmit(Boolean(next.registration));
      props.onState(next);
    },
  }));
  // The manifest goes to GitHub as a plain form post, once the form has GitHub's address.
  createEffect(
    on(action, (address) => {
      if (!address || !autoSubmit()) return;
      setAutoSubmit(false);
      form?.requestSubmit();
    }),
  );
  const saveExit = createMutation(() => ({
    mutationFn: async () => {
      if (!registration() && !props.endpoint.botExternalId) await githubChatApi.saveDraft(props.endpoint.id, input());
    },
    onSettled: () => props.onExit(),
  }));
  const locked = () => Boolean(registration()) || register.isPending;

  return (
    <>
      <p>Paperclip creates a GitHub App for {props.endpoint.assignedAgentName} from a manifest. You confirm it on GitHub, then install it on the repositories it should review.</p>
      <div class="ch-grid">
        <Field label="GitHub account" for="gh-owner">
          <select
            id="gh-owner"
            class="input"
            value={choice()}
            disabled={locked()}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setOwnerType(value === "personal" ? "personal" : "organization");
              setCustom(value === "organization");
              if (value.startsWith("organization:")) setOwnerLogin(value.slice("organization:".length));
              else if (value === "organization") setOwnerLogin("");
            }}
          >
            <option value="personal">My account</option>
            <For each={organizations()}>{(login) => <option value={`organization:${login}`}>{login}</option>}</For>
            <option value="organization">Another organization</option>
          </select>
        </Field>
        <Show when={choice() === "organization"}>
          <Field label="Organization" for="gh-org">
            <TextInput id="gh-org" value={ownerLogin()} disabled={locked()} placeholder="GitHub organization name" onInput={(event) => setOwnerLogin(event.currentTarget.value)} />
          </Field>
        </Show>
        <Field label="App name" for="gh-name" help="Up to 34 characters. It becomes the bot's @mention.">
          <TextInput id="gh-name" value={name()} maxLength={34} disabled={locked()} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
      </div>
      <Show when={repositories.isError}>
        <p class="cx-note">Couldn't load every GitHub organization you use. Pick Another organization to type one.</p>
      </Show>
      <button type="button" class="cx-link" onClick={() => props.onOwnApp()}>
        I already have an App
      </button>
      <Show when={register.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(register.error, "Couldn't start the registration.")}
        </p>
      </Show>
      <Show when={registration() && !action()}>
        <p class="cx-note cx-note--error" role="alert">
          GitHub returned an invalid registration address. Try again later.
        </p>
      </Show>
      <form ref={form} method="post" action={action() ?? undefined} class="cx-actions">
        <input type="hidden" name="manifest" value={registration() ? JSON.stringify(registration()!.manifest) : ""} />
        <Button variant="quiet" disabled={saveExit.isPending} onClick={() => saveExit.mutate()}>
          Save and exit
        </Button>
        <Show
          when={registration() && action()}
          fallback={
            <Button
              variant="primary"
              disabled={register.isPending || (ownerType() === "organization" && !ownerLogin().trim())}
              onClick={() => register.mutate()}
            >
              {register.isPending ? "Preparing…" : "Continue to GitHub"}
            </Button>
          }
        >
          <Button type="submit" variant="primary">
            Continue to GitHub
          </Button>
        </Show>
      </form>
    </>
  );
}

/** Link your GitHub account: one you've connected already, or GitHub's sign-in. */
function IdentityStep(props: {
  endpoint: ChatEndpoint;
  state: GitHubAppWizardState;
  onState: (next: GitHubAppWizardState) => void;
  onRefresh: () => void;
  onExit: () => void;
  base: string;
}) {
  const company = useCompany();
  const [account, setAccount] = createSignal("");
  const [observed, setObserved] = createSignal<GitHubIdentity | null>(null);
  const accounts = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "github-personal-connections"),
    queryFn: ({ signal }) => githubChatApi.personalConnections(props.endpoint.id, signal),
  }));
  const usable = () => (accounts.data ?? []).filter((entry) => entry.status === "active" && entry.enabled);
  const existingOnly = () => props.state.identityMethod === "existing_connection";

  const confirm = createMutation(() => ({
    mutationFn: (githubUserId: string) => githubChatApi.confirmIdentity(props.endpoint.id, githubUserId),
    onSuccess: (next) => props.onState(next),
  }));
  const check = createMutation(() => ({
    mutationFn: async () => {
      if (account()) {
        const seen = await githubChatApi.identity(props.endpoint.id, account(), observed()?.githubUserId);
        if (observed()) props.onRefresh();
        setObserved(seen);
        return;
      }
      const start = await githubChatApi.startIdentity(props.endpoint.id);
      window.location.assign(start.authorizationUrl);
    },
  }));
  const error = () => confirm.error ?? check.error ?? accounts.error;

  return (
    <>
      <Show
        when={props.state.identity}
        fallback={
          <>
            <p>Link your GitHub account, so your mentions of the bot use your Paperclip permissions.</p>
            <Show when={usable().length > 0}>
              <Field label="A GitHub connection you have" for="gh-identity">
                <select
                  id="gh-identity"
                  class="input"
                  value={account()}
                  onChange={(event) => {
                    setAccount(event.currentTarget.value);
                    setObserved(null);
                  }}
                >
                  <option value="">Choose an account</option>
                  <For each={usable()}>{(entry) => <option value={entry.connectionId}>{entry.login ?? entry.name}</option>}</For>
                </select>
              </Field>
            </Show>
            <Show when={observed()}>
              <p>
                GitHub account: <b>{observed()!.login}</b>
              </p>
            </Show>
            <Show when={existingOnly() && !account()}>
              <A href={`${props.base}/connect?source=github`}>Add a personal GitHub connection, then come back to this draft</A>
            </Show>
          </>
        }
      >
        {(identity) => (
          <p>
            Link GitHub account <b>{identity().login}</b> to your Paperclip account.
          </p>
        )}
      </Show>
      <Show when={error()}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(error(), "Couldn't link the account.")}
        </p>
      </Show>
      <Show
        when={props.state.identity}
        fallback={
          <WizardFoot
            onExit={props.onExit}
            pending={check.isPending}
            disabled={existingOnly() && !account()}
            label={account() ? (observed() ? "Confirm my account" : "Check my account") : "Connect my GitHub account"}
            onNext={() => check.mutate()}
          />
        }
      >
        {(identity) => <WizardFoot onExit={props.onExit} pending={confirm.isPending} label="Confirm my account" onNext={() => confirm.mutate(identity().githubUserId)} />}
      </Show>
    </>
  );
}

/** The registration expired or failed: start again (only when no App was made), or use your own. */
function Recovery(props: {
  endpoint: ChatEndpoint;
  state: GitHubAppWizardState;
  onState: (next: GitHubAppWizardState) => void;
  onOwnApp: () => void;
  onExit: () => void;
  onRefresh: () => void;
}) {
  const [notCreated, setNotCreated] = createSignal(false);
  const restart = createMutation(() => ({
    mutationFn: () => githubChatApi.restartRegistration(props.endpoint.id, props.state.restartableRegistrationId!),
    onSuccess: (next) => {
      setNotCreated(false);
      props.onState(next);
    },
  }));
  return (
    <>
      <p role="status">{props.state.message ?? "The App registration didn't finish."}</p>
      <button type="button" class="cx-link" onClick={() => props.onOwnApp()}>
        Use the App's credentials instead
      </button>
      <Show when={props.state.restartableRegistrationId}>
        <label class="ch-check">
          <input type="checkbox" checked={notCreated()} onChange={(event) => setNotCreated(event.currentTarget.checked)} />
          I haven't created this App on GitHub.
        </label>
      </Show>
      <Show when={restart.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(restart.error, "Couldn't start again.")}
        </p>
      </Show>
      <Show
        when={props.state.restartableRegistrationId}
        fallback={<WizardFoot onExit={props.onExit} label="Try again" onNext={props.onRefresh} />}
      >
        <WizardFoot onExit={props.onExit} label="Start again" pending={restart.isPending} disabled={!notCreated()} onNext={() => restart.mutate()} />
      </Show>
    </>
  );
}
