import { Show, type JSX, type ParentProps } from "solid-js";
import { isCompact } from "./breakpoints";
import "./Shell.css";

/*
 * The app shell: a grid with named areas, nav and main. Nothing in it has a fixed page width; the
 * 248px nav column is the only fixed track, and main is `minmax(0, 1fr)`. Side panels dock beside
 * the list they were opened from, inside main (<Dock> in Panel.tsx).
 *
 * On a phone-sized viewport the grid drops to one column and the left nav gives way to the floating
 * dock (design/mobile.md, N1; PhoneDock.tsx), which floats over the foot of main; panels become
 * full-screen pages (Panel.tsx). Only the shell switches; components inside it don't change.
 *
 * `main` is a size container named `main`, so content responds to the space it's given with
 * `@container main (...)`, not to the viewport.
 */

export function Shell(
  props: ParentProps<{
    /** The left nav, on tablet and desktop. */
    nav: JSX.Element;
    /** The floating dock that replaces the nav on a phone. */
    dock?: JSX.Element;
  }>,
) {
  return (
    <div class="shell">
      <Show when={!isCompact()}>
        <nav class="shell-nav" aria-label="Main">
          {props.nav}
        </nav>
      </Show>
      <main class="shell-main">{props.children}</main>
      <Show when={isCompact()}>{props.dock}</Show>
    </div>
  );
}
