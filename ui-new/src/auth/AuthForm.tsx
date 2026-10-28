import { createSignal, Show } from "solid-js";
import { authApi } from "@/api/auth";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { authFeedback, authFormProblem, MIN_PASSWORD_LENGTH, type AuthFeedback, type AuthMode } from "./auth-model";

/*
 * Email and password, to sign in or create an account (`POST /api/auth/sign-in/email`,
 * `/sign-up/email`), for the sign-in page and an invite. An existing account on sign-up switches to
 * sign-in with a note rather than an error. `onSignedIn` runs once the session cookie is set.
 */
export function AuthForm(props: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSignedIn: () => Promise<void> | void;
  /** "Sign in" / "Create account" by default. */
  submitLabel?: (mode: AuthMode) => string;
  idPrefix?: string;
}) {
  const id = (name: string) => `${props.idPrefix ?? "auth"}-${name}`;
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [feedback, setFeedback] = createSignal<AuthFeedback | null>(null);
  const [pending, setPending] = createSignal(false);

  const onInput = (set: (value: string) => void) => (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    set(event.currentTarget.value);
    if (feedback()?.tone === "error") setFeedback(null);
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending()) return;
    const mode = props.mode;
    const form = { name: name(), email: email(), password: password() };
    const problem = authFormProblem(mode, form);
    if (problem) return setFeedback({ tone: "error", message: problem });
    setPending(true);
    setFeedback(null);
    try {
      if (mode === "sign_in") await authApi.signInEmail({ email: form.email.trim(), password: form.password });
      else await authApi.signUpEmail({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      await props.onSignedIn();
    } catch (caught) {
      const next = authFeedback(caught, mode, form.email);
      if (next.switchTo && next.switchTo !== mode) {
        props.onModeChange(next.switchTo);
        setPassword("");
      }
      setFeedback({ tone: next.tone, message: next.message });
    } finally {
      setPending(false);
    }
  };

  const label = () => props.submitLabel?.(props.mode) ?? (props.mode === "sign_in" ? "Sign in" : "Create account");

  return (
    <form class="stand-form" method="post" action={props.mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"} onSubmit={onSubmit} novalidate>
      <Show when={props.mode === "sign_up"}>
        <Field label="Name" for={id("name")}>
          <TextInput id={id("name")} name="name" autocomplete="name" required value={name()} onInput={onInput(setName)} />
        </Field>
      </Show>
      <Field label="Email" for={id("email")}>
        <TextInput id={id("email")} name="email" type="email" autocomplete="username" required value={email()} onInput={onInput(setEmail)} />
      </Field>
      <Field label="Password" for={id("password")} help={props.mode === "sign_up" ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}>
        <TextInput
          id={id("password")}
          name="password"
          type="password"
          autocomplete={props.mode === "sign_in" ? "current-password" : "new-password"}
          required
          value={password()}
          onInput={onInput(setPassword)}
        />
      </Field>
      <Show when={feedback()}>
        {(note) => (
          <p class="stand-note" data-tone={note().tone === "info" ? "amber" : "red"} role="alert">
            {note().message}
          </p>
        )}
      </Show>
      <Button type="submit" variant="primary" disabled={pending()}>
        {pending() ? "Working…" : label()}
      </Button>
      <p class="stand-switch">
        {props.mode === "sign_in" ? "Need an account? " : "Already have an account? "}
        <button
          type="button"
          class="stand-link"
          onClick={() => {
            setFeedback(null);
            props.onModeChange(props.mode === "sign_in" ? "sign_up" : "sign_in");
          }}
        >
          {props.mode === "sign_in" ? "Create one" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
