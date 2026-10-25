import { Show, splitProps, type JSX } from "solid-js";
import "./Button.css";

/*
 * Buttons (design-system.md, "Buttons"; style-guide.html):
 *
 * - primary: --primary fill, weight 800. The main action on a page or card.
 * - secondary: --edge outline.
 * - danger: red outline, for destructive actions.
 * - quiet: text only, for "Not now" and other ways out.
 * - well: --well fill, for filter and view pills.
 * - suggestion: the violet "1 suggestion" pill that opens Paperclip's suggestions.
 * - icon: a 36px circle (32px compact). `ghost` drops its border, as in the nav.
 *
 * `size="compact"` is the 32px version used in cards and headers; the default is 38px (36px for
 * well and icon buttons).
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet" | "well" | "suggestion" | "icon";
export type ButtonSize = "default" | "compact";

export function buttonClass(options: { variant?: ButtonVariant; size?: ButtonSize; ghost?: boolean } = {}) {
  const variant = options.variant ?? "secondary";
  return [
    "btn",
    `btn--${variant}`,
    options.size === "compact" ? "btn--compact" : "",
    options.ghost ? "btn--ghost" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ghost?: boolean;
  /** Leading icon, 14–16px. */
  icon?: JSX.Element;
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "ghost", "icon", "class", "children", "type"]);
  return (
    <button
      type={local.type ?? "button"}
      class={`${buttonClass(local)} ${local.class ?? ""}`}
      {...rest}
    >
      <Show when={local.icon}>{local.icon}</Show>
      {local.children}
    </button>
  );
}
