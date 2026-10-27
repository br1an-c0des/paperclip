import { ChevronDown, ChevronUp, Search, X } from "lucide-solid";
import { Show } from "solid-js";
import "./RunFind.css";

/*
 * The "Find in run" field in the run modal's tool bar (board 16): type to search the view, Enter
 * for the next match, Shift+Enter for the previous, Escape to clear. "/" (or Ctrl/⌘ F) anywhere in
 * the modal jumps here. The modal does the finding (find-in-run.ts); this is the field.
 */

export function RunFind(props: {
  query: string;
  onQuery: (query: string) => void;
  /** How many matches the view holds, and which is current (-1 for none yet). */
  count: number;
  current: number;
  onStep: (step: 1 | -1) => void;
  ref?: (input: HTMLInputElement) => void;
}) {
  const searching = () => props.query.trim().length > 0;
  return (
    <div class="rm-find" classList={{ "rm-find--on": searching() }} role="search">
      <Search size={13} aria-hidden="true" />
      <input
        ref={props.ref}
        class="rm-find-input"
        type="text"
        value={props.query}
        placeholder="Find in run"
        aria-label="Find in run"
        autocomplete="off"
        spellcheck={false}
        onInput={(event) => props.onQuery(event.currentTarget.value)}
        // Native, so Escape is caught here before the dialog's own Escape closes the modal.
        on:keydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape" && props.query) {
            event.preventDefault();
            event.stopPropagation();
            props.onQuery("");
          }
        }}
      />
      <Show when={searching()} fallback={<span class="rm-kbd" aria-hidden="true">/</span>}>
        <span class="rm-find-count" role="status">
          {props.count === 0 ? "No matches" : `${Math.max(props.current, 0) + 1} of ${props.count}`}
        </span>
        <button type="button" class="rm-find-btn" aria-label="Previous match" disabled={props.count === 0} onClick={() => props.onStep(-1)}>
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        <button type="button" class="rm-find-btn" aria-label="Next match" disabled={props.count === 0} onClick={() => props.onStep(1)}>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button type="button" class="rm-find-btn" aria-label="Clear the search" onClick={() => props.onQuery("")}>
          <X size={13} aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
