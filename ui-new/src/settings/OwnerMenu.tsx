import { Check } from "lucide-solid";
import { createMemo, For } from "solid-js";
import { personName } from "@/api/access";
import { usePeopleQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { FieldButton } from "@/ui/Field";
import { Menu } from "@/ui/Menu";

/*
 * Picks one of the company's active members, or nobody, for a settings field: the default owner,
 * and request routing's decision and budget owners (U134) in company settings and the project's
 * decision owner in project settings. The company directory (`GET /companies/:id/user-directory`)
 * supplies the members.
 */

export function OwnerMenu(props: {
  /** The field's name, for the menu and the button's accessible name: "Decision owner". */
  label: string;
  value: string | null | undefined;
  onChange: (userId: string | null) => void;
  /** The choice for no one: "Nobody", or what applies instead ("The company's"). */
  noneLabel?: string;
  disabled?: boolean;
  class?: string;
}) {
  const people = usePeopleQuery();
  const members = createMemo(() => (people.data?.users ?? []).filter((user) => user.status === "active"));
  const current = () => members().find((user) => user.principalId === props.value);
  const none = () => props.noneLabel ?? "Nobody";
  const shown = () => (current() ? personName(current()!) : props.value ? "Someone who isn't a member now" : none());
  const pick = (userId: string | null) => {
    if ((userId ?? null) !== (props.value ?? null)) props.onChange(userId);
  };
  return (
    <Menu>
      <Menu.Trigger as={FieldButton} class={props.class ?? "ps-field-320"} disabled={props.disabled} aria-label={`${props.label}: ${shown()}`}>
        {shown()}
      </Menu.Trigger>
      <Menu.Content label={props.label} width={300}>
        <For each={members()} fallback={<p class="nt-menu-note">{people.data ? "No people to choose from." : "Loading people…"}</p>}>
          {(user) => (
            <Menu.Item
              onSelect={() => pick(user.principalId)}
              icon={<InitialsDisc name={personName(user)} seed={user.principalId} size={24} />}
              description={user.user?.email ?? undefined}
              hint={user.principalId === props.value ? <Check size={14} /> : undefined}
            >
              {personName(user)}
            </Menu.Item>
          )}
        </For>
        <Menu.Separator />
        <Menu.Item onSelect={() => pick(null)} hint={props.value ? undefined : <Check size={14} />}>
          {none()}
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
