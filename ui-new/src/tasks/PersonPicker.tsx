import { Check } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { personName } from "@/api/access";
import { usePeopleQuery } from "@/lib/company-data";
import { readNote } from "@/lib/offline/read-state";
import { useSession } from "@/lib/session";
import { PersonAvatar } from "@/ui/Avatar";
import { TextInput } from "@/ui/Field";

/*
 * Finds one of the company's people by name or email (`GET /companies/:id/user-directory`, the
 * active members), in the style of TaskPicker and New task's assignee list. You come first.
 * For the recurring task's "Runs for" (U59) and anywhere else one person is picked.
 */

export type PickedPerson = { id: string; name: string };

export function PersonPicker(props: { label: string; selected: string | null; onPick: (person: PickedPerson) => void }) {
  const directory = usePeopleQuery();
  const session = useSession();
  const [query, setQuery] = createSignal("");
  const everyone = createMemo(() =>
    (directory.data?.users ?? [])
      .map((entry) => ({ id: entry.principalId, name: personName(entry), email: entry.user?.email ?? "", image: entry.user?.image ?? null, you: entry.principalId === session.youId() }))
      .sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name)),
  );
  const shown = createMemo(() => {
    const term = query().trim().toLowerCase();
    if (!term) return everyone();
    return everyone().filter((person) => person.name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term) || (person.you && "you".startsWith(term)));
  });

  return (
    <div class="nt-picker">
      <TextInput type="search" aria-label={`Find ${props.label.toLowerCase()}`} placeholder="Find a person by name or email" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} autofocus />
      <div class="nt-picker-list" role="listbox" aria-label={props.label}>
        <For
          each={shown()}
          fallback={<p class="nt-picker-empty">{directory.data ? "No one matches." : readNote(directory, "No people yet.", { loading: "Loading people…" })}</p>}
        >
          {(person) => {
            const on = () => person.id === props.selected;
            return (
              <button type="button" class="nt-option" role="option" aria-selected={on()} onClick={() => props.onPick({ id: person.id, name: person.name })}>
                <PersonAvatar name={person.you ? "You" : person.name} seed={person.id} image={person.image} you={person.you} size={24} />
                <span class="nt-option-label">{person.you ? `You (${person.name})` : person.name}</span>
                <Show when={!person.you && person.email && person.email !== person.name}>
                  <span class="nt-option-id">{person.email}</span>
                </Show>
                <Show when={on()}>
                  <Check size={14} aria-hidden="true" class="nt-option-check" />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
