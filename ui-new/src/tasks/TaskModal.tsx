import type { CompactIssue } from "@paperclipai/shared";
import { A, useLocation } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { ChevronLeft, ChevronRight, Maximize2, PanelRight, X } from "lucide-solid";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { isCompact } from "@/layout/breakpoints";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { Dialog } from "@/ui/Dialog";
import { TaskHeaderActions } from "./TaskActions";
import { setTaskOpenMode } from "./task-open-mode";
import { TaskSections } from "./TaskSections";
import "./TaskModal.css";

/*
 * A task opened as a modal over the page (boards 6 and 7, build plan decision B), instead of the
 * docked panel. It holds the same sections as the panel (TaskSections), laid out side by side:
 * Details on the left, and Activity, Docs and files, Runs or Workspace beside it, picked from the
 * rail. When the modal is too narrow for both, it falls back to the panel's one-section layout.
 *
 * Lists open it when the "open tasks as a modal" setting is on; pages without a list always do.
 * From a list it steps to the previous and next task, and "Dock to side panel" switches the setting
 * back. It goes through ui/Dialog, so it's a full-screen sheet on a phone.
 */

/**
 * The modal for pages without a task list (Inbox, chat, dashboards), opened with
 * `commands.openTaskModal(task)` and mounted once in the company layout. A subtask or blocker opened
 * from it replaces the task in place; going to another page closes it.
 */
export function GlobalTaskModal() {
  const commands = useCommands();
  const location = useLocation();
  createEffect(on(() => location.pathname, () => commands.closeTaskModal(), { defer: true }));
  const target = () => commands.taskModal();
  const detail = createQuery(() => ({
    queryKey: queryKeys.issues.detail(target()?.id ?? ""),
    queryFn: ({ signal }) => issuesApi.get(target()!.id, signal),
    enabled: target() !== null,
  }));
  const task = () => {
    const current = target();
    if (!current) return null;
    const found = detail.data;
    return found ? { id: found.id, identifier: found.identifier, title: found.title, projectId: found.projectId } : current;
  };
  return (
    <Show when={task()}>
      {(current) => (
        <TaskModal
          task={current()}
          onClose={() => commands.closeTaskModal()}
          onOpenTask={(next) => commands.openTaskModal({ id: next.id, identifier: next.identifier, title: next.identifier ?? "", projectId: null })}
        />
      )}
    </Show>
  );
}

/** Wide enough for Details and another section side by side. */
const SPLIT_MIN_WIDTH = 860;

export function TaskModal(props: {
  task: Pick<CompactIssue, "id" | "identifier" | "projectId" | "title">;
  onClose: () => void;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Opened from a list, which can show the task docked instead. */
  canDock?: boolean;
}) {
  const company = useCompany();
  const projects = useProjectsQuery();
  const project = () => projects.data?.find((candidate) => candidate.id === props.task.projectId);
  const [width, setWidth] = createSignal(1300);
  const measure = (element: HTMLElement) => {
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  const split = () => !isCompact() && width() >= SPLIT_MIN_WIDTH;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.task.title}
      titleHidden
      hideClose
      width={1300}
      class="tmodal"
    >
      <div class="tmodal-head">
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Previous task" disabled={!props.onPrevious} onClick={() => props.onPrevious?.()}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Next task" disabled={!props.onNext} onClick={() => props.onNext?.()}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <Show when={project()}>
          {(found) => (
            <>
              <span class="tmodal-project">
                <InitialsDisc name={found().name.slice(0, 1)} seed={found().id} size={18} />
                <span class="tmodal-project-name">{found().name}</span>
              </span>
              <span class="tmodal-sep" aria-hidden="true">
                /
              </span>
            </>
          )}
        </Show>
        <span class="mono tmodal-id">{props.task.identifier}</span>
        <div class="tmodal-actions">
          <TaskHeaderActions taskId={props.task.id} onHidden={props.onClose} />
          <span class="ta-sep" aria-hidden="true" />
          <Show when={props.canDock}>
            <button
              type="button"
              class="btn btn--icon btn--ghost btn--compact"
              aria-label="Dock to side panel"
              title="Dock to side panel: open tasks beside the list"
              onClick={() => setTaskOpenMode("panel")}
            >
              <PanelRight size={15} aria-hidden="true" />
            </button>
          </Show>
          <A
            class="btn btn--icon btn--ghost btn--compact"
            href={issuePath(company().issuePrefix, props.task)}
            aria-label="Open full page"
            title="Open full page"
          >
            <Maximize2 size={15} aria-hidden="true" />
          </A>
          <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Close" onClick={() => props.onClose()}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="tmodal-body" ref={measure}>
        <TaskSections taskId={props.task.id} title={props.task.title} layout={split() ? "split" : "rail"} onOpenTask={props.onOpenTask} />
      </div>
    </Dialog>
  );
}
