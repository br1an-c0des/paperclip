import { For } from "solid-js";
import "./Segmented.css";

/*
 * Segmented control (design-system.md, "Section tabs and segmented control"): a pill track on
 * --well; the selected segment is raised with --sel and weight 800. Segments are buttons with
 * aria-pressed in a labelled group, as on the boards. Arrow keys move between segments.
 */

export type SegmentOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>(props: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  let group!: HTMLDivElement;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = props.options.findIndex((option) => option.value === props.value);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = props.options[(index + step + props.options.length) % props.options.length];
    if (!next) return;
    event.preventDefault();
    props.onChange(next.value);
    group.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div ref={group} class="seg" role="group" aria-label={props.label} onKeyDown={onKeyDown}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            data-value={option.value}
            aria-pressed={option.value === props.value}
            tabindex={option.value === props.value ? 0 : -1}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
