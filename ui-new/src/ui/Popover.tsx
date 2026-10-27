import { Popover as KPopover } from "@kobalte/core/popover";
import { X } from "lucide-solid";
import { Show, splitProps, type ComponentProps, type JSX, type ParentProps } from "solid-js";
import { useInDialog } from "./Dialog";
import { layerMode, SheetOnly, useLayerMount } from "./layer";
import "./Popover.css";

/*
 * Every popover goes through this wrapper (build plan, decision H): a request or detail card floated
 * under a pill button, `role="dialog"`, closed by an outside click, Escape, ✕ or a "Not now" inside
 * it (design-system.md). On a phone-sized viewport it becomes a bottom sheet (layer.tsx).
 *
 * Inside a dialog it's marked as a top layer (`data-kb-top-layer`). The dialog is modal: Kobalte
 * sets `aria-hidden` on whatever is added outside it while it's open, which would include this
 * popover's portal. A top layer stays visible to screen readers, as Kobalte's toasts do, and focus
 * and clicks in it don't count as leaving the dialog.
 *
 *   <Popover>
 *     <Popover.Trigger as={Button} variant="suggestion">1 suggestion</Popover.Trigger>
 *     <Popover.Content label="Suggestion from Paperclip">…</Popover.Content>
 *   </Popover>
 */

type RootProps = ComponentProps<typeof KPopover>;

function Root(props: RootProps) {
  // Opens 8px below the trigger, aligned to its start edge; flips when there's no room.
  return <KPopover gutter={8} placement="bottom-start" {...props} />;
}

export type PopoverContentProps = ParentProps<{
  /** Accessible name, when there's no visible title. */
  label?: string;
  /** Visible title, drawn as a section title. */
  title?: JSX.Element;
  /** Width in px when anchored. 500 for request and detail cards. */
  width?: number;
  /** Hide the ✕ button. */
  hideClose?: boolean;
  class?: string;
}>;

function Content(props: PopoverContentProps) {
  const mount = useLayerMount();
  const inDialog = useInDialog();
  const [local] = splitProps(props, ["label", "title", "width", "hideClose", "class", "children"]);
  return (
    <KPopover.Portal mount={mount()}>
      <KPopover.Content
        data-layer="popover"
        data-mode={layerMode()}
        data-kb-top-layer={inDialog ? "" : undefined}
        class={`popover ${local.class ?? ""}`}
        aria-label={local.title ? undefined : local.label}
        style={{ width: layerMode() === "anchored" ? `${local.width ?? 500}px` : undefined }}
      >
        <SheetOnly>
          <span class="layer-handle" aria-hidden="true" />
        </SheetOnly>
        <Show when={local.title}>
          <KPopover.Title class="popover-title">{local.title}</KPopover.Title>
        </Show>
        <Show when={!local.hideClose}>
          <KPopover.CloseButton class="popover-close" aria-label="Close">
            <X size={14} aria-hidden="true" />
          </KPopover.CloseButton>
        </Show>
        {local.children}
      </KPopover.Content>
    </KPopover.Portal>
  );
}

export const Popover = Object.assign(Root, {
  Trigger: KPopover.Trigger,
  Content,
  /** A button inside the content that closes it, such as "Not now". */
  Close: KPopover.CloseButton,
});
