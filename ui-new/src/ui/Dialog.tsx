import { Dialog as KDialog } from "@kobalte/core/dialog";
import { X } from "lucide-solid";
import { createRenderEffect, on, Show, type JSX, type ParentProps } from "solid-js";
import { layerMode, SheetOnly, useLayerMount } from "./layer";
import "./Dialog.css";

/*
 * Every dialog goes through this wrapper (build plan, decision H). It draws the scrim and the card,
 * keeps focus inside, closes on Escape and outside click, and turns into a full-screen sheet on a
 * phone-sized viewport (layer.tsx).
 *
 *   <Dialog open={open()} onOpenChange={setOpen} title="New task" width={760}>…</Dialog>
 *
 * Or let it own its state, with a trigger:
 *
 *   <Dialog trigger={(p) => <Button {...p}>Open</Button>} title="…">…</Dialog>
 */

export type DialogProps = ParentProps<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Visible title. Pass `titleHidden` to keep it for screen readers only. */
  title: JSX.Element;
  titleHidden?: boolean;
  description?: JSX.Element;
  /** Maximum width in px: 760 for forms like the new-task dialog, 1300 for the task modal. */
  width?: number;
  /** A trigger to render; receives the props Kobalte needs on it. */
  trigger?: (props: Record<string, unknown>) => JSX.Element;
  /** Footer actions, drawn on --ground below a divider. */
  footer?: JSX.Element;
  /** Hide the ✕ button, for dialogs whose footer has its own Cancel. */
  hideClose?: boolean;
  /** What takes focus on open, such as a title field; by default the first focusable element. */
  initialFocus?: () => HTMLElement | null | undefined;
}>;

export function Dialog(props: DialogProps) {
  const mount = useLayerMount();
  // A controlled dialog has no Kobalte trigger to return focus to, so remember what had it.
  let returnFocus: HTMLElement | null = null;
  createRenderEffect(
    on(
      () => props.open,
      (open) => {
        if (open && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
      },
    ),
  );
  const restoreFocus = (event: Event) => {
    if (props.trigger || !returnFocus?.isConnected) return;
    event.preventDefault();
    returnFocus.focus();
    returnFocus = null;
  };
  return (
    <KDialog open={props.open} onOpenChange={props.onOpenChange} modal preventScroll>
      <Show when={props.trigger}>{(trigger) => <KDialog.Trigger as={trigger()} />}</Show>
      <KDialog.Portal mount={mount()}>
        <KDialog.Overlay class="layer-scrim" />
        <div class="layer-dialog-frame">
          <KDialog.Content
            data-layer="dialog"
            data-mode={layerMode()}
            class="dialog"
            onCloseAutoFocus={restoreFocus}
            onOpenAutoFocus={(event: Event) => {
              const target = props.initialFocus?.();
              if (!target) return;
              event.preventDefault();
              target.focus();
            }}
            style={{ "--dialog-width": `${props.width ?? 760}px` }}
          >
            <SheetOnly>
              <span class="layer-handle" aria-hidden="true" />
            </SheetOnly>
            <header class="dialog-head" classList={{ "sr-only": props.titleHidden }}>
              <KDialog.Title class="dialog-title disp">{props.title}</KDialog.Title>
              <Show when={props.description}>
                <KDialog.Description class="dialog-desc">{props.description}</KDialog.Description>
              </Show>
            </header>
            <Show when={!props.hideClose}>
              <KDialog.CloseButton class="dialog-close" aria-label="Close">
                <X size={16} aria-hidden="true" />
              </KDialog.CloseButton>
            </Show>
            <div class="dialog-body">{props.children}</div>
            <Show when={props.footer}>
              <footer class="dialog-foot">{props.footer}</footer>
            </Show>
          </KDialog.Content>
        </div>
      </KDialog.Portal>
    </KDialog>
  );
}
