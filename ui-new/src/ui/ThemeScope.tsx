import { createSignal, type JSX, type ParentProps } from "solid-js";
import type { Theme } from "@/lib/theme";
import { LayerMountProvider } from "./layer";

/**
 * Draws a subtree in a fixed theme, whatever the app's theme is. Menus, popovers and dialogs opened
 * inside it mount inside it too, so they keep its theme. Used by the style guide to show both themes
 * side by side.
 */
export function ThemeScope(
  props: ParentProps<{ theme: Theme; class?: string; style?: JSX.CSSProperties; "aria-label"?: string }>,
) {
  const [el, setEl] = createSignal<HTMLElement>();
  return (
    <section
      ref={setEl}
      class={`${props.theme} f-hanken theme-scope ${props.class ?? ""}`}
      style={props.style}
      aria-label={props["aria-label"]}
    >
      <LayerMountProvider mount={el}>{props.children}</LayerMountProvider>
    </section>
  );
}
