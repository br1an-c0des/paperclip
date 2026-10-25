import { Show, splitProps, type JSX, type ParentProps } from "solid-js";
import "./Field.css";

/*
 * Text fields and settings rows (design-system.md, "Text fields" and "Settings rows").
 *
 * - <TextInput> and <TextArea>: bordered, on --ground, 2px --run-fg focus ring. `variant="title"` uses the
 *   display face at 22px, for task and dialog titles.
 * - <FieldButton>: a field-shaped button that opens a menu or listbox ("Shared workspace ⌄").
 * - <SettingsCard> with <SettingsRow>: the card header, label column with help text, and footer
 *   actions used across settings (boards 10, 11, 21–29). Rows stack when their card is narrow.
 */

type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & { variant?: "title"; invalid?: boolean };

export function TextInput(props: InputProps) {
  const [local, rest] = splitProps(props, ["variant", "invalid", "class"]);
  return (
    <input
      class={`input ${local.variant === "title" ? "input--title disp" : ""} ${local.class ?? ""}`}
      aria-invalid={local.invalid || undefined}
      {...rest}
    />
  );
}

type TextAreaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function TextArea(props: TextAreaProps) {
  const [local, rest] = splitProps(props, ["invalid", "class"]);
  return <textarea class={`input input--area ${local.class ?? ""}`} aria-invalid={local.invalid || undefined} {...rest} />;
}

type FieldButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: JSX.Element };

/** Field-shaped trigger; pass it to a Menu or Popover trigger with `as`. */
export function FieldButton(props: FieldButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "class", "children"]);
  return (
    <button type="button" class={`field ${local.class ?? ""}`} {...rest}>
      {local.icon}
      <span class="field-value">{local.children}</span>
      <svg
        class="field-caret"
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

/** A labelled field outside settings rows: label above, help or error below. */
export function Field(
  props: ParentProps<{ label: JSX.Element; for?: string; help?: JSX.Element; error?: JSX.Element }>,
) {
  return (
    <div class="field-stack">
      <label class="field-label" for={props.for}>
        {props.label}
      </label>
      {props.children}
      <Show when={props.error} fallback={<Show when={props.help}><span class="fhelp">{props.help}</span></Show>}>
        <span class="field-error" role="alert">
          {props.error}
        </span>
      </Show>
    </div>
  );
}

export function SettingsCard(
  props: ParentProps<{ title?: JSX.Element; description?: JSX.Element; footer?: JSX.Element; "aria-label"?: string }>,
) {
  return (
    <section class="card settings-card" aria-label={props["aria-label"]}>
      <Show when={props.title}>
        <header class="chead">
          <h3 class="disp">{props.title}</h3>
          <Show when={props.description}>
            <p>{props.description}</p>
          </Show>
        </header>
      </Show>
      <div class="settings-rows">{props.children}</div>
      <Show when={props.footer}>
        <footer class="cfoot">{props.footer}</footer>
      </Show>
    </section>
  );
}

export function SettingsRow(props: ParentProps<{ label: JSX.Element; help?: JSX.Element; for?: string }>) {
  return (
    <div class="frow">
      <label class="flabel" for={props.for}>
        {props.label}
        <Show when={props.help}>
          <span class="fhelp">{props.help}</span>
        </Show>
      </label>
      <div class="fcontrol">{props.children}</div>
    </div>
  );
}
