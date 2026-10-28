import { A, useParams, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { claimsApi } from "@/api/claims";
import { queryKeys } from "@/api/queryKeys";
import { Splash } from "@/routes/Splash";
import { Button, buttonClass } from "@/ui/Button";
import { signInHref } from "./auth-model";
import { useOutsideSession } from "./outside";
import { Note, Standalone } from "./Standalone";

/*
 * `/board-claim/:token?code=`: claim a Paperclip that moved from local_trusted to authenticated, as
 * ui/src/pages/BoardClaim.tsx. The server prints the link; claiming makes the signed-in user its
 * instance admin and hands them the local board's organizations.
 */
export function BoardClaimPage() {
  const params = useParams<{ token: string }>();
  const [search] = useSearchParams<{ code?: string }>();
  const client = useQueryClient();
  const token = () => (params.token ?? "").trim();
  const code = () => (search.code ?? "").trim();
  const here = () => `/board-claim/${encodeURIComponent(token())}${code() ? `?code=${encodeURIComponent(code())}` : ""}`;
  const outside = useOutsideSession();

  const status = createQuery(() => ({
    queryKey: ["board-claim", token(), code()] as const,
    queryFn: () => claimsApi.boardClaim(token(), code()),
    enabled: !!token() && !!code(),
    retry: false,
  }));

  const claim = createMutation(() => ({
    mutationFn: () => claimsApi.claimBoard(token(), code()),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
      await client.invalidateQueries({ queryKey: queryKeys.health });
      await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      await status.refetch();
    },
  }));

  const openBoard = <A class={buttonClass({ variant: "primary", size: "compact" })} href="/">Open the board</A>;

  return (
    <Switch>
      <Match when={!token() || !code()}>
        <Splash title="This claim link is incomplete">Copy the whole link the server printed, including its code.</Splash>
      </Match>
      <Match when={status.isLoading || outside.loading()}>
        <Splash title="Loading the claim" quiet />
      </Match>
      <Match when={status.error}>
        {(error) => <Splash title="This claim link isn't available">{(error() as Error).message || "It's invalid or has expired."}</Splash>}
      </Match>
      <Match when={status.data?.status === "expired"}>
        <Splash title="This claim link has expired">Restart the server to print a new one.</Splash>
      </Match>
      <Match when={status.data?.status === "claimed"}>
        <Splash title="Board ownership claimed" actions={openBoard}>
          This Paperclip is now linked to your account.
        </Splash>
      </Match>
      <Match when={!outside.session.data}>
        <Splash
          title="Sign in to claim this Paperclip"
          actions={<A class={buttonClass({ variant: "primary", size: "compact" })} href={signInHref(here())}>Sign in or create an account</A>}
        >
          Sign in or create an account, then come back here to claim board ownership.
        </Splash>
      </Match>
      <Match when={status.data}>
        <Standalone title="Claim board ownership" lede="This makes your account the instance admin and moves the local board's organizations to it.">
          <Show when={claim.error}>{(error) => <Note tone="red" alert>{(error() as Error).message}</Note>}</Show>
          <div class="stand-actions">
            <Button variant="primary" disabled={claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? "Claiming…" : "Claim ownership"}
            </Button>
            <span class="stand-muted">Signed in as {outside.who()}</span>
          </div>
        </Standalone>
      </Match>
    </Switch>
  );
}
