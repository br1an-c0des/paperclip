import { useNavigate, useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Match, Switch } from "solid-js";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { AuthForm } from "@/auth/AuthForm";
import { authReturnPath, claimCloudSignInAttempt, clearCloudSignInAttempt, cloudOf, cloudSignInUrl, pendingInvitePath, type AuthMode } from "@/auth/auth-model";
import { Standalone } from "@/auth/Standalone";
import { buttonClass } from "@/ui/Button";
import { Splash } from "./Splash";

/*
 * `/auth`: sign in, or create an account, with email and password (authenticated mode), after
 * ui/src/pages/Auth.tsx. `?next=` says where to go after; without it, an invite opened before signing
 * in. Already signed in (a local board always is) goes straight on. A Cloud-managed instance signs
 * in through Paperclip Cloud instead: the page sends the browser there once, then offers a link.
 */
export function SignIn() {
  const [params] = useSearchParams<{ next?: string; mode?: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [mode, setMode] = createSignal<AuthMode>(params.mode === "sign_up" ? "sign_up" : "sign_in");
  const next = () => authReturnPath(params.next || pendingInvitePath());

  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get, retry: false }));
  const session = createQuery(() => ({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false }));
  createEffect(() => {
    if (!session.data) return;
    clearCloudSignInAttempt();
    navigate(next(), { replace: true });
  });

  const cloud = () => cloudOf(health.data);
  const cloudUrl = () => {
    const found = cloud();
    return found ? cloudSignInUrl(found, next()) : null;
  };
  // One automatic trip to Cloud; a second visit within five minutes shows the link instead.
  const [cloudBlocked, setCloudBlocked] = createSignal(false);
  createEffect(() => {
    const url = cloudUrl();
    if (!url || session.isLoading || session.data || cloudBlocked()) return;
    if (claimCloudSignInAttempt()) window.location.replace(url);
    else setCloudBlocked(true);
  });

  const onSignedIn = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.auth.session });
    await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
    await client.invalidateQueries({ queryKey: queryKeys.health });
    // Reset, not invalidate: the companies list isn't account-scoped, and sign-in can change accounts.
    await client.resetQueries({ queryKey: queryKeys.companies.all });
    navigate(next(), { replace: true });
  };

  return (
    <Switch
      fallback={
        <Standalone
          title={mode() === "sign_in" ? "Sign in" : "Create your account"}
          lede={mode() === "sign_in" ? "Use your email and password for this Paperclip." : "An account on this Paperclip. No email confirmation is needed."}
        >
          <AuthForm mode={mode()} onModeChange={setMode} onSignedIn={onSignedIn} idPrefix="signin" />
        </Standalone>
      }
    >
      <Match when={health.isLoading || session.isLoading || session.data}>
        <Splash title="Loading" quiet />
      </Match>
      {/* A failed health or session check must not pass for a self-hosted instance. */}
      <Match when={health.isError || session.isError}>
        <Splash title="Can't check sign-in">Refresh the page to try again.</Splash>
      </Match>
      <Match when={cloud()}>
        <Switch fallback={<Splash title="Opening Paperclip Cloud" quiet />}>
          <Match when={!cloudUrl()}>
            <Splash title="Sign in to Paperclip Cloud">Cloud sign-in isn't available for this workspace. Ask your administrator.</Splash>
          </Match>
          <Match when={cloudBlocked()}>
            <Splash
              title="Sign in to Paperclip Cloud"
              actions={
                <a class={buttonClass({ variant: "primary", size: "compact" })} href={cloudUrl()!} onClick={clearCloudSignInAttempt}>
                  Continue to Paperclip Cloud
                </a>
              }
            >
              We couldn't restore your session. Continue to Paperclip Cloud to try again.
            </Splash>
          </Match>
        </Switch>
      </Match>
    </Switch>
  );
}
