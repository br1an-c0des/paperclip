import type { AuthSession } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { claimsApi } from "@/api/claims";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { Button, buttonClass } from "@/ui/Button";
import { Note, Standalone } from "./Standalone";

/*
 * An authenticated instance nobody has claimed yet, after ui/src/components/BootstrapPendingPage.tsx.
 * On a private instance the first signed-in person claims it from here (`POST /bootstrap/claim`) and
 * goes on to onboarding; on a public one the operator prints a first-admin invite on the host.
 */

const BOOTSTRAP_COMMAND = "npx paperclipai auth bootstrap-ceo";

function HostFallback(props: { activeInvite?: boolean }) {
  return (
    <>
      <p class="stand-muted">
        {props.activeInvite
          ? "A first-admin invite is already active: its link is in the server's startup log. Or run this on the host to make a new one:"
          : "Prefer to finish from the host? Run this where Paperclip runs to print a one-time first-admin invite link:"}
      </p>
      <pre class="stand-code">{BOOTSTRAP_COMMAND}</pre>
    </>
  );
}

function claimError(error: unknown) {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status === 409) return "Someone else has already claimed this Paperclip. Refresh to sign in, or ask that admin to invite you.";
  if (status === 401) return "Your session expired. Sign in again to claim this Paperclip.";
  return "Couldn't reach the server. Try again in a moment.";
}

export function BootstrapPending(props: { claimAvailable: boolean; activeInvite?: boolean; session: AuthSession | null | undefined }) {
  const client = useQueryClient();
  const claim = createMutation(() => ({
    mutationFn: claimsApi.claimBootstrapAdmin,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
      await client.invalidateQueries({ queryKey: queryKeys.health });
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
    },
  }));

  return (
    <Switch>
      <Match when={!props.claimAvailable}>
        <Standalone
          title="This Paperclip is waiting for its first admin"
          lede="It runs invite-only. The operator makes a one-time first-admin invite link on the host; open it in this browser to finish setup."
        >
          <HostFallback activeInvite={props.activeInvite} />
          <p class="stand-muted">Claiming from the browser is off on public instances, so nobody on the network can make themselves admin.</p>
        </Standalone>
      </Match>
      <Match when={claim.isSuccess}>
        <Standalone title="You're the instance admin" lede="Setup is done. Next, create your first organization.">
          <div class="stand-actions">
            <A class={buttonClass({ variant: "primary", size: "compact" })} href="/onboarding">
              Create an organization
            </A>
          </div>
        </Standalone>
      </Match>
      <Match when={!props.session}>
        <Standalone title="Finish setting up this Paperclip" lede="Nobody has claimed it yet. Sign in or create your account to become its first admin.">
          <div class="stand-actions">
            <A class={buttonClass({ variant: "primary", size: "compact" })} href="/auth?next=/&mode=sign_up">
              Sign in or create an account
            </A>
          </div>
          <HostFallback activeInvite={props.activeInvite} />
        </Standalone>
      </Match>
      <Match when={props.session}>
        <Standalone title="Finish setting up this Paperclip" lede="Nobody has claimed it yet. Claim it to become its first admin, then create your first organization.">
          <Show when={claim.error}>{(error) => <Note tone="red" alert>{claimError(error())}</Note>}</Show>
          <div class="stand-actions">
            <Button variant="primary" disabled={claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? "Claiming…" : "Claim this Paperclip"}
            </Button>
            <span class="stand-muted">Signed in as {props.session?.user.email || props.session?.user.name}</span>
          </div>
          <HostFallback activeInvite={props.activeInvite} />
        </Standalone>
      </Match>
    </Switch>
  );
}
