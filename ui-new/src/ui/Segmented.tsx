import { For, Show, type JSX } from "solid-js";
import "./Segmented.css";

/*
 * Segmented control (design-system.md, "Section tabs and segmented control"): a pill track on
 * --well; the selected segment is raised with --sel and weight 800. Segments are buttons with
 * aria-pressed in a labelled group, as on the boards. Arrow keys move between segments.
 *
 * A segment can carry an icon before its label (`seg-icon`, `seg-text`). It is then also named and
 * titled by its label, so a container that folds it to the icon alone (the task list's toolbar,
 * TasksView.css) keeps both.
 */

export type SegmentOption<T extends string> = { value: T; label: string; icon?: JSX.Element };

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
            aria-label={option.icon ? option.label : undefined}
            title={option.icon ? option.label : undefined}
            onClick={() => props.onChange(option.value)}
          >
            <Show when={option.icon} fallback={option.label}>
              <span class="seg-icon">{option.icon}</span>
              <span class="seg-text">{option.label}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
