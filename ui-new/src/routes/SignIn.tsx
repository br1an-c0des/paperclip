import { useNavigate, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/api/queryKeys";
import { safeNextPath } from "@/lib/session";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import "./SignIn.css";

/*
 * Sign-in with email and password (`POST /api/auth/sign-in/email`). A plain version built from the
 * design system's components: the sign-in and onboarding pages have no board yet and are planned
 * for M6 (build plan). Sign-up, invites and other providers stay in the classic UI until then.
 */
export function SignIn() {
  const [params] = useSearchParams<{ next?: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");

  // Already signed in (or a local board, which always is): go straight on.
  const session = createQuery(() => ({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false }));
  createEffect(() => {
    if (session.data) navigate(safeNextPath(params.next), { replace: true });
  });

  const signIn = createMutation(() => ({
    mutationFn: () => authApi.signInEmail({ email: email().trim(), password: password() }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
      await client.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await client.invalidateQueries({ queryKey: queryKeys.health });
      // Reset, not invalidate: the companies list isn't account-scoped, and sign-in can change accounts.
      await client.resetQueries({ queryKey: queryKeys.companies.all });
      navigate(safeNextPath(params.next), { replace: true });
    },
  }));

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!email().trim() || !password()) return;
    signIn.mutate();
  };

  return (
    <div class="signin">
      <form class="card signin-card" onSubmit={onSubmit} aria-labelledby="signin-title">
        <span class="mono cap">Paperclip</span>
        <h1 id="signin-title" class="disp">Sign in</h1>
        <Field label="Email" for="signin-email">
          <TextInput
            id="signin-email"
            type="email"
            autocomplete="email"
            required
            value={email()}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </Field>
        <Field label="Password" for="signin-password">
          <TextInput
            id="signin-password"
            type="password"
            autocomplete="current-password"
            required
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </Field>
        <Show when={signIn.error}>
          {(error) => (
            <p class="signin-error" role="alert">
              {(error() as Error).message}
            </p>
          )}
        </Show>
        <Button type="submit" variant="primary" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
