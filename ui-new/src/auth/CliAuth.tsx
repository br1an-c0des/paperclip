import { A, useParams, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { claimsApi, type CliAuthChallenge } from "@/api/claims";
import { queryKeys } from "@/api/queryKeys";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { cliRetryDelay, isRateLimited, signInHref } from "./auth-model";
import { useOutsideSession } from "./outside";
import { Facts, Note, Standalone } from "./Standalone";

/*
 * `/cli-auth/:id?token=`: approve a CLI sign-in (`paperclipai auth login`), as ui/src/pages/
 * CliAuth.tsx. The terminal waits until someone signed in approves or cancels it here. The challenge
 * endpoint rate-limits; a 429 retries after the server's delay, for up to ten minutes.
 */
export function CliAuthPage() {
  const params = useParams<{ id: string }>();
  const [search] = useSearchParams<{ token?: string }>();
  const client = useQueryClient();
  const id = () => (params.id ?? "").trim();
  const token = () => (search.token ?? "").trim();
  const here = () => `/cli-auth/${encodeURIComponent(id())}${token() ? `?token=${encodeURIComponent(token())}` : ""}`;
  const outside = useOutsideSession();
  const retryUntil = Date.now() + 10 * 60_000;
  const key = () => ["cli-auth-challenge", id(), token()] as const;

  const challenge = createQuery(() => ({
    queryKey: key(),
    queryFn: () => claimsApi.cliChallenge(id(), token()),
    enabled: !!id() && !!token(),
    retry: (failures: number, error: Error) => {
      if (!isRateLimited(error) || failures >= 3) return false;
      const known = Date.parse(client.getQueryData<CliAuthChallenge>(key())?.expiresAt ?? "");
      const deadline = Number.isFinite(known) ? Math.min(known, retryUntil) : retryUntil;
      return Date.now() + cliRetryDelay(error) < deadline;
    },
    retryDelay: (_failures: number, error: Error) => cliRetryDelay(error),
  }));

  const approve = createMutation(() => ({
    mutationFn: () => claimsApi.approveCli(id(), token()),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
      await challenge.refetch();
    },
  }));
  const cancel = createMutation(() => ({
    mutationFn: () => claimsApi.cancelCli(id(), token()),
    onSuccess: () => challenge.refetch(),
  }));
  const busy = () => approve.isPending || cancel.isPending;
  const waiting = () => isRateLimited(challenge.failureReason) && challenge.isFetching;

  return (
    <Switch>
      <Match when={!id() || !token()}>
        <Splash title="This CLI sign-in link is incomplete">Copy the whole link the CLI printed, including its token.</Splash>
      </Match>
      <Match when={waiting()}>
        <Splash title="Too many CLI approval requests">Trying again shortly…</Splash>
      </Match>
      <Match when={challenge.isLoading || outside.loading()}>
        <Splash title="Loading the CLI request" quiet />
      </Match>
      <Match when={challenge.error}>
        {(error) => <Splash title="This CLI request isn't available">{(error() as Error).message || "It's invalid or has expired."}</Splash>}
      </Match>
      <Match when={challenge.data?.status === "approved" && challenge.data}>
        {(data) => (
          <Standalone title="CLI access approved" lede="The Paperclip CLI can finish signing in on the machine that asked.">
            <Facts rows={[["Command", <span class="mono">{data().command}</span>]]} />
          </Standalone>
        )}
      </Match>
      <Match when={challenge.data?.status === "cancelled" || challenge.data?.status === "expired"}>
        <Splash title={challenge.data?.status === "expired" ? "This CLI request expired" : "This CLI request was cancelled"}>
          Start signing in again from your terminal to get a new request.
        </Splash>
      </Match>
      <Match when={challenge.data?.requiresSignIn || !outside.session.data}>
        <Splash
          title="Sign in to approve the CLI"
          actions={<A class={buttonClass({ variant: "primary", size: "compact" })} href={signInHref(here())}>Sign in or create an account</A>}
        >
          Sign in or create an account, then come back here to approve the CLI's access.
        </Splash>
      </Match>
      <Match when={challenge.data}>
        {(data) => (
          <Standalone
            wide
            title="Approve Paperclip CLI access"
            lede="A CLI is asking for full board access to the organizations you can open here. Approve it only if you started this in your own terminal."
          >
            <Facts
              rows={[
                ["Command", <span class="mono">{data().command}</span>],
                ["Client", data().clientName ?? "paperclipai cli"],
                ["Access", data().requestedAccess === "instance_admin_required" ? "Instance admin" : "Board"],
                ...(data().requestedCompanyName ? ([["Organization", data().requestedCompanyName!]] as const) : []),
              ]}
            />
            <Show when={!data().canApprove}>
              <Note tone="amber">
                {data().requestedAccess === "instance_admin_required"
                  ? "This request needs an instance admin. Sign in with an instance admin account to approve it."
                  : "You don't have access to the organization it asks for."}
              </Note>
            </Show>
            <Show when={approve.error ?? cancel.error}>{(error) => <Note tone="red" alert>{(error() as Error).message}</Note>}</Show>
            <div class="stand-actions stand-actions--split">
              <Button variant="quiet" disabled={busy()} onClick={() => cancel.mutate()}>
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
              <Button variant="primary" disabled={!data().canApprove || busy()} onClick={() => approve.mutate()}>
                {approve.isPending ? "Approving…" : "Approve CLI access"}
              </Button>
            </div>
            <p class="stand-muted">Signed in as {outside.who()}</p>
          </Standalone>
        )}
      </Match>
    </Switch>
  );
}
