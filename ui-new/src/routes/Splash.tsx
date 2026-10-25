import { Show, type JSX, type ParentProps } from "solid-js";
import "./Splash.css";

/** A centred card for states outside the shell: loading, errors, no access. */
export function Splash(props: ParentProps<{ title: string; quiet?: boolean; actions?: JSX.Element }>) {
  return (
    <div class="splash">
      <Show
        when={!props.quiet}
        fallback={
          <p class="splash-quiet" role="status">
            {props.title}…
          </p>
        }
      >
        <section class="card splash-card">
          <h1 class="disp">{props.title}</h1>
          <Show when={props.children}>
            <p>{props.children}</p>
          </Show>
          <Show when={props.actions}>
            <div class="splash-actions">{props.actions}</div>
          </Show>
        </section>
      </Show>
    </div>
  );
}
