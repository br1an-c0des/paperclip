import { Search } from "lucide-solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import { PAGE_SEARCH_EVENT } from "@/lib/shortcuts";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";

/*
 * The task list toolbar's search (TasksView.tsx). Where the toolbar has room it's the field, as it
 * always was. Where it folds (TasksView.css), the field gives way to a magnifying-glass button:
 * pressing it opens the field, focused. The field stays open while it has text or focus, and folds
 * back when it loses focus empty. Escape clears the text, or, already empty, folds it and returns
 * focus to the button. `/` opens and focuses it from anywhere on the page (the slot is the page's
 * search, `data-page-search`; lib/shortcuts.ts `focusPageSearch`).
 *
 * The slot carries `tv-search-slot--open` while it's open; CSS alone decides whether a closed slot
 * shows the field (room) or the button (folded), so the component doesn't need to know which.
 */

export function ListSearch(props: { value: string; onInput: (value: string) => void; label: string }) {
  let slot!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let toggle: HTMLButtonElement | undefined;
  const [expanded, setExpanded] = createSignal(false);
  const open = () => expanded() || !!props.value;

  const expand = () => {
    setExpanded(true);
    input?.focus();
  };

  onMount(() => {
    slot.addEventListener(PAGE_SEARCH_EVENT, expand);
    onCleanup(() => slot.removeEventListener(PAGE_SEARCH_EVENT, expand));
  });

  /** The button is hidden while the toolbar has room for the field; then focus stays put. */
  const toggleShown = () => !!toggle && getComputedStyle(toggle).display !== "none";

  return (
    <div ref={slot} class="tv-search-slot" classList={{ "tv-search-slot--open": open() }} data-page-search>
      <Button
        ref={toggle}
        variant="icon"
        class="tv-search-toggle"
        aria-label={props.label}
        title={props.label}
        onClick={expand}
      >
        <Search size={15} aria-hidden="true" />
      </Button>
      <label class="tv-search">
        <Search size={14} aria-hidden="true" />
        <TextInput
          ref={input}
          type="search"
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onFocus={() => setExpanded(true)}
          onBlur={() => {
            if (!props.value) setExpanded(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (props.value) {
              event.preventDefault();
              props.onInput("");
            } else if (expanded()) {
              event.preventDefault();
              setExpanded(false);
              if (toggleShown()) toggle!.focus();
            }
          }}
          placeholder={props.label}
          aria-label={props.label}
        />
      </label>
    </div>
  );
}
