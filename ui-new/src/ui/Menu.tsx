import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { Check } from "lucide-solid";
import { Show, splitProps, type ComponentProps, type JSX, type ParentProps } from "solid-js";
import { layerMode, SheetOnly, useLayerMount } from "./layer";
import "./Menu.css";

/*
 * Menus (design-system.md, "Menus and listboxes"): a card 6–8px below the trigger, items 38px tall
 * (44px with a description), one open at a time, closed by picking, an outside click or Escape. A
 * menu that offers several picks stays open until "Done" (set `closeOnSelect={false}` on the
 * items). Drawn through the shared layer, so it becomes a bottom sheet on a phone-sized viewport.
 *
 *   <Menu>
 *     <Menu.Trigger as={Button}>Group: Status</Menu.Trigger>
 *     <Menu.Content label="Group by" width={240}>
 *       <Menu.Item onSelect={…}>Status</Menu.Item>
 *     </Menu.Content>
 *   </Menu>
 */

type RootProps = ComponentProps<typeof KMenu>;

function Root(props: RootProps) {
  return <KMenu gutter={8} placement="bottom-start" {...props} />;
}

function Content(props: ParentProps<{ label?: string; width?: number; class?: string }>) {
  const mount = useLayerMount();
  return (
    <KMenu.Portal mount={mount()}>
      <KMenu.Content
        data-layer="menu"
        data-mode={layerMode()}
        class={props.class}
        aria-label={props.label}
        style={{ width: layerMode() === "anchored" ? `${props.width ?? 300}px` : undefined }}
      >
        <SheetOnly>
          <span class="layer-handle" aria-hidden="true" />
        </SheetOnly>
        {props.children}
      </KMenu.Content>
    </KMenu.Portal>
  );
}

type ItemProps = ParentProps<{
  onSelect?: () => void;
  disabled?: boolean;
  closeOnSelect?: boolean;
  /** Leading visual, such as a status capsule or priority bars. */
  icon?: JSX.Element;
  /** Second line, which makes the item 44px tall. */
  description?: JSX.Element;
  /** Trailing note, such as a count or a shortcut. */
  hint?: JSX.Element;
  danger?: boolean;
}>;

function ItemBody(props: Pick<ItemProps, "icon" | "description" | "hint" | "children">) {
  return (
    <>
      <Show when={props.icon}>
        <span class="mi-icon" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <span class="mi-text">
        <KMenu.ItemLabel class="mi-label">{props.children}</KMenu.ItemLabel>
        <Show when={props.description}>
          <KMenu.ItemDescription class="mi-desc">{props.description}</KMenu.ItemDescription>
        </Show>
      </span>
      <Show when={props.hint}>
        <small class="mi-hint">{props.hint}</small>
      </Show>
    </>
  );
}

function Item(props: ItemProps) {
  const [local, rest] = splitProps(props, ["icon", "description", "hint", "children", "danger"]);
  return (
    <KMenu.Item class="mi" classList={{ "mi--danger": local.danger }} {...rest}>
      <ItemBody icon={local.icon} description={local.description} hint={local.hint}>
        {local.children}
      </ItemBody>
    </KMenu.Item>
  );
}

function CheckboxItem(props: ItemProps & { checked: boolean; onChange: (checked: boolean) => void }) {
  const [local, rest] = splitProps(props, ["icon", "description", "hint", "children", "danger"]);
  return (
    <KMenu.CheckboxItem class="mi" closeOnSelect={false} {...rest}>
      <ItemBody icon={local.icon} description={local.description} hint={local.hint}>
        {local.children}
      </ItemBody>
      <KMenu.ItemIndicator class="mi-check">
        <Check size={14} aria-hidden="true" />
      </KMenu.ItemIndicator>
    </KMenu.CheckboxItem>
  );
}

function Group(props: ParentProps<{ label?: string }>) {
  return (
    <KMenu.Group class="mg">
      <Show when={props.label}>
        <KMenu.GroupLabel class="mh">{props.label}</KMenu.GroupLabel>
      </Show>
      {props.children}
    </KMenu.Group>
  );
}

export const Menu = Object.assign(Root, {
  Trigger: KMenu.Trigger,
  Content,
  Item,
  CheckboxItem,
  Group,
  Separator: () => <KMenu.Separator class="msep" />,
});
