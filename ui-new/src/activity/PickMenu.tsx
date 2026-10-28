import { Check, ChevronDown } from "lucide-solid";
import { For, Show, type JSX } from "solid-js";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";

/*
 * A filter pill that opens a menu of choices ("Who: Everyone ⌄"), used by the Activity and Skills
 * pages' toolbars. The first item clears the filter; groups add headed sections (agents, people).
 */

export type PickOption = { value: string; label: string; icon?: JSX.Element };

export function PickMenu(props: {
  /** What the menu filters, as the pill's lead word: "Who", "Action". */
  label: string;
  value: string | undefined;
  /** The cleared state's name: "Everyone", "All actions". */
  allLabel: string;
  options: readonly PickOption[];
  groups?: readonly { label: string; options: readonly PickOption[] }[];
  onPick: (value: string | undefined) => void;
  width?: number;
}) {
  const all = () => [...props.options, ...(props.groups ?? []).flatMap((group) => group.options)];
  const current = () => all().find((option) => option.value === props.value)?.label ?? (props.value ? props.value : props.allLabel);
  const tick = (value: string | undefined) => (props.value === value ? <Check size={14} aria-hidden="true" /> : undefined);
  return (
    <Menu>
      <Menu.Trigger as={Button} size="compact" class="act-pick" classList={{ "act-pick--on": Boolean(props.value) }}>
        <span class="act-pick-label">{props.label}:</span> <span class="act-pick-value">{current()}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label={props.label} width={props.width ?? 240}>
        <Menu.Item onSelect={() => props.onPick(undefined)} hint={tick(undefined)}>
          {props.allLabel}
        </Menu.Item>
        <For each={props.options}>
          {(option) => (
            <Menu.Item onSelect={() => props.onPick(option.value)} icon={option.icon} hint={tick(option.value)}>
              {option.label}
            </Menu.Item>
          )}
        </For>
        <For each={props.groups ?? []}>
          {(group) => (
            <Show when={group.options.length > 0}>
              <Menu.Separator />
              <Menu.Group label={group.label}>
                <For each={group.options}>
                  {(option) => (
                    <Menu.Item onSelect={() => props.onPick(option.value)} icon={option.icon} hint={tick(option.value)}>
                      {option.label}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Group>
            </Show>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}
