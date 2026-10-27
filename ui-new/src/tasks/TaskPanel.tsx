import type { CompactIssue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { AppWindow, ChevronLeft, ChevronRight, Maximize2 } from "lucide-solid";
import { Show } from "solid-js";
import { issuePath } from "@/api/issues";
import { Panel } from "@/layout/Panel";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { TaskHeaderActions } from "./TaskActions";
import { setTaskOpenMode } from "./task-open-mode";
import { TaskSections } from "./TaskSections";
import "./TaskPanel.css";

/*
 * A task opened beside the list (boards 2, 3 and 5), inside the list's <Dock>. The toolbar steps
 * to the previous and next task in the list, names the project and task, and holds the task's
 * actions (privacy and the More menu), "Open as modal" and "Open full page".
 *
 * "Open as modal" is the setting that chooses between this panel and the modal (boards 6 and 7,
 * build plan decision B): it switches every list to the modal, and the modal's "Dock to side
 * panel" switches back. The choice is kept in local storage (task-open-mode.ts).
 */

export function TaskPanel(props: {
  task: Pick<CompactIssue, "id" | "identifier" | "projectId" | "title">;
  onClose: () => void;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const company = useCompany();
  const projects = useProjectsQuery();
  const project = () => projects.data?.find((candidate) => candidate.id === props.task.projectId);

  return (
    <Panel
      label={`Task ${props.task.identifier ?? props.task.title}`}
      onClose={props.onClose}
      toolbar
      flush
      header={
        <div class="tp-head">
          <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Previous task" disabled={!props.onPrevious} onClick={() => props.onPrevious?.()}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Next task" disabled={!props.onNext} onClick={() => props.onNext?.()}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <Show when={project()}>
            {(found) => (
              <>
                <span class="tp-project" title={found().name}>
                  <InitialsDisc name={found().name.slice(0, 1)} seed={found().id} size={18} />
                </span>
                <span class="tp-sep" aria-hidden="true">
                  /
                </span>
              </>
            )}
          </Show>
          <span class="mono tp-id">{props.task.identifier}</span>
        </div>
      }
      actions={
        <div class="tp-actions">
          <TaskHeaderActions taskId={props.task.id} onHidden={props.onClose} />
          <button
            type="button"
            class="btn btn--icon btn--ghost btn--compact"
            aria-label="Open as modal"
            title="Open as modal: open tasks over the list instead of beside it"
            onClick={() => setTaskOpenMode("modal")}
          >
            <AppWindow size={15} aria-hidden="true" />
          </button>
          <A class="btn btn--icon btn--ghost btn--compact" href={issuePath(company().issuePrefix, props.task)} aria-label="Open full page" title="Open full page">
            <Maximize2 size={15} aria-hidden="true" />
          </A>
        </div>
      }
    >
      <TaskSections taskId={props.task.id} title={props.task.title} onOpenTask={props.onOpenTask} />
    </Panel>
  );
}
