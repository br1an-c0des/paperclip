import { For, Show, type JSX, type ParentProps } from "solid-js";
import "./Auth.css";

/*
 * The frame for pages outside a company (sign-in, invites, claims, connections, onboarding): a
 * centred card with the Paperclip eyebrow and a display title, as the sign-in page and <Splash> set
 * the look. `wide` fits a form beside its details.
 */
export function Standalone(
  props: ParentProps<{ title: JSX.Element; eyebrow?: JSX.Element; lede?: JSX.Element; mark?: JSX.Element; wide?: boolean; label?: string }>,
) {
  return (
    <main class="stand">
      <section class="card stand-card" classList={{ "stand-card--wide": props.wide }} aria-label={props.label}>
        <header class="stand-head">
          <Show when={props.mark}>
            <span class="stand-mark">{props.mark}</span>
          </Show>
          <span class="stand-head-text">
            <span class="mono cap">{props.eyebrow ?? "Paperclip"}</span>
            <h1 class="disp">{props.title}</h1>
          </span>
        </header>
        <Show when={props.lede}>
          <p class="stand-lede">{props.lede}</p>
        </Show>
        {props.children}
      </section>
    </main>
  );
}

/** Label and value pairs: the details of an invite, a CLI request, an identity link. */
export function Facts(props: { rows: readonly (readonly [string, JSX.Element])[] }) {
  return (
    <dl class="stand-facts">
      <For each={props.rows}>
        {([label, value]) => (
          <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

/** A message in a tinted well: an error, a note, or good news. */
export function Note(props: ParentProps<{ tone?: "red" | "amber" | "green" | "run"; alert?: boolean }>) {
  return (
    <p class="stand-note" data-tone={props.tone ?? "run"} role={props.alert ? "alert" : undefined}>
      {props.children}
    </p>
  );
}
