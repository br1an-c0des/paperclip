import type { CompactIssue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-solid";
import { Show } from "solid-js";
import { issuePath } from "@/api/issues";
import { Panel } from "@/layout/Panel";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { TaskDetails } from "./TaskDetails";
import "./TaskPanel.css";

/*
 * A task opened beside the list (boards 2, 3 and 5), inside the list's <Dock>. The toolbar steps
 * to the previous and next task in the list, names the project and task, and opens the full page.
 * The modal (boards 6 and 7) comes later in M2, with a setting to choose between the two
 * (build plan, decision B).
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
        <A class="btn btn--icon btn--ghost btn--compact" href={issuePath(company().issuePrefix, props.task)} aria-label="Open full page" title="Open full page">
          <Maximize2 size={15} aria-hidden="true" />
        </A>
      }
    >
      <TaskDetails taskId={props.task.id} onOpenTask={props.onOpenTask} />
    </Panel>
  );
}
