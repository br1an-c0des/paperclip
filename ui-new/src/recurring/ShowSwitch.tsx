import { useSearchParams } from "@solidjs/router";
import { ListChecks, Repeat } from "lucide-solid";
import { Show } from "solid-js";
import { useRoutinesQuery } from "./queries";
import "./ShowSwitch.css";

/*
 * Show: Tasks or Recurring, at the start of the task list's toolbar (board R1). It's kept in the
 * URL (`?show=recurring`), so the old `/routines` links can land on it. Recurring counts the
 * recurring tasks that aren't archived.
 *
 * Its labels are `rshow-text`, and Tasks has an icon (`rshow-fold-icon`) that stays hidden, so the
 * task list's toolbar can fold the switch to icons when it's short of room (TasksView.css).
 */

export function showsRecurring(show: string | undefined) {
  return show === "recurring";
}

export function ShowSwitch(props: { projectId?: string }) {
  const [params, setParams] = useSearchParams<{ show?: string }>();
  const routines = useRoutinesQuery(() => props.projectId);
  const count = () => (routines.data ?? []).filter((routine) => routine.status !== "archived").length;
  const recurring = () => showsRecurring(params.show);
  const pick = (next: boolean) => {
    if (next === recurring()) return;
    setParams({ show: next ? "recurring" : undefined, task: undefined, recurring: undefined, section: undefined }, { scroll: false });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const group = event.currentTarget as HTMLElement;
    pick(!recurring());
    queueMicrotask(() => group.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus());
  };
  return (
    <div class="rshow" role="group" aria-label="Show" onKeyDown={onKeyDown}>
      <button type="button" aria-pressed={!recurring()} tabindex={recurring() ? -1 : 0} aria-label="Tasks" title="Tasks" onClick={() => pick(false)}>
        <ListChecks size={14} aria-hidden="true" class="rshow-fold-icon" />
        <span class="rshow-text">Tasks</span>
      </button>
      <button
        type="button"
        aria-pressed={recurring()}
        tabindex={recurring() ? 0 : -1}
        aria-label={routines.data ? `Recurring, ${count()}` : "Recurring"}
        title="Recurring tasks"
        onClick={() => pick(true)}
      >
        <Repeat size={14} aria-hidden="true" />
        <span class="rshow-text">Recurring</span>
        <Show when={routines.data}>
          <span class="rshow-count">{count()}</span>
        </Show>
      </button>
    </div>
  );
}
