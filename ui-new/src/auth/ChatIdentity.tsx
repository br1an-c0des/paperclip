import { Navigate, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import { chatIdentityApi } from "@/api/chat-identity";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { CHAT_PROVIDER_NAMES, signInHref } from "./auth-model";
import { useOutsideSession } from "./outside";
import { Facts, Note, Standalone } from "./Standalone";

/*
 * `/chat-identity/confirm?token=`: link a chat identity (a Slack user, a GitHub login…) to your
 * Paperclip account, after ui/src/pages/apps/chat/ChatIdentityConfirm.tsx. A chat connector sends the
 * link. It needs a session but not a membership: someone not yet in the organization can ask for
 * access from here (the old UI's gate with `allowMembershipRequest`). The preview is polled until
 * confirmed, so a membership approved meanwhile shows up.
 */
export function ChatIdentityPage() {
  const [search] = useSearchParams<{ token?: string }>();
  const token = () => search.token ?? "";
  const outside = useOutsideSession();
  const [confirmed, setConfirmed] = createSignal(false);
  const canLoad = () => token().length >= 32 && (outside.local() || outside.signedIn());

  const preview = createQuery(() => ({
    queryKey: ["chat-identity-link-preview", token()] as const,
    queryFn: () => chatIdentityApi.preview(token()),
    enabled: canLoad(),
    refetchInterval: confirmed() ? false : 3_000,
    retry: false,
  }));
  const confirm = createMutation(() => ({ mutationFn: () => chatIdentityApi.confirm(token()), onSuccess: () => setConfirmed(true) }));
  const requestAccess = createMutation(() => ({ mutationFn: () => chatIdentityApi.requestAccess(token()) }));

  const provider = () => (preview.data ? (CHAT_PROVIDER_NAMES[preview.data.provider] ?? preview.data.provider) : "");
  const account = () => (outside.local() ? "Local board" : outside.who());

  return (
    <Switch>
      <Match when={outside.health.isError || (!outside.local() && outside.session.isError)}>
        <Splash title="Couldn't load your account">Refresh the page to try again.</Splash>
      </Match>
      <Match when={outside.health.isSuccess && !outside.local() && outside.session.isSuccess && !outside.session.data}>
        <Navigate href={signInHref(`/chat-identity/confirm?token=${encodeURIComponent(token())}`)} />
      </Match>
      <Match when={token().length < 32 || (!confirmed() && preview.isError)}>
        <Splash title="This identity link isn't available">It's invalid, expired or used already, or belongs to another Paperclip organization.</Splash>
      </Match>
      <Match when={!preview.data}>
        <Splash title="Checking the identity link" quiet />
      </Match>
      <Match when={confirmed() && preview.data}>
        {(identity) => (
          <Splash
            title="Identity linked"
            actions={
              identity().provider === "slack" ? (
                <a class={buttonClass({ variant: "primary", size: "compact" })} href="https://app.slack.com/" target="_blank" rel="noopener noreferrer">
                  Back to Slack
                </a>
              ) : undefined
            }
          >
            From now on, messages from {identity().externalLabel} act with your Paperclip permissions in {identity().companyName}.
          </Splash>
        )}
      </Match>
      <Match when={preview.data}>
        {(identity) => (
          <Standalone eyebrow={identity().companyName} title="Link your chat identity">
            <Facts
              rows={[
                ["Provider", provider()],
                ["Chat identity", `${identity().externalLabel}${identity().externalDetail ? ` · ${identity().externalDetail}` : ""}`],
                ["Paperclip account", account()],
                ["Agent", identity().botLabel ?? "Paperclip agent"],
              ]}
            />
            <p class="stand-body">
              Confirm only if this is your {provider()} identity. Paperclip checks your organization membership on every action.
            </p>
            <Show when={confirm.isError}>
              <Note tone="red" alert>
                This link couldn't be confirmed. It may have expired or been revoked.
              </Note>
            </Show>
            <Show
              when={identity().canConfirm === false}
              fallback={
                <div class="stand-actions">
                  <Button variant="primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                    {confirm.isPending ? "Confirming…" : "Confirm identity"}
                  </Button>
                </div>
              }
            >
              <p class="stand-body">You need to be a member of {identity().companyName} before linking this identity.</p>
              <Show
                when={requestAccess.isSuccess}
                fallback={
                  <div class="stand-actions">
                    <Button variant="primary" disabled={requestAccess.isPending || !identity().selfService} onClick={() => requestAccess.mutate()}>
                      {requestAccess.isPending ? "Asking…" : "Request access"}
                    </Button>
                  </div>
                }
              >
                <Note tone="green">
                  Access requested. An admin can approve it in Paperclip; then come back here to confirm. If this link expires, send the connect command in chat again.
                </Note>
              </Show>
              <Show when={requestAccess.isError}>
                <Note tone="red" alert>
                  Couldn't request access. The link may have expired: send the connect command again and retry.
                </Note>
              </Show>
            </Show>
          </Standalone>
        )}
      </Match>
    </Switch>
  );
}
