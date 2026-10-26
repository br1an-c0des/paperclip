import type { Issue } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { Activity, FileText, FolderGit2, Layers, Play } from "lucide-solid";
import { For, Match, Switch, type JSX } from "solid-js";
import { TaskActivity } from "./TaskActivity";
import { TaskDetails } from "./TaskDetails";
import { TaskFiles } from "./TaskFiles";
import { TaskRuns } from "./TaskRuns";
import { TaskWorkspace } from "./TaskWorkspace";
import "./TaskSections.css";

/*
 * One task's sections, in the docked panel and on the full page: the open section beside the rail
 * of section buttons on the right (boards 2, 3 and 5). The open section is kept in the URL
 * (`?section=`), so stepping to the next task, reloading, or sharing the link keeps it; Details
 * is the default and leaves the URL alone.
 */

export type TaskSection = "details" | "activity" | "files" | "runs" | "workspace";

const SECTIONS: { id: TaskSection; label: string; icon: () => JSX.Element }[] = [
  { id: "details", label: "Details", icon: () => <Layers size={16} aria-hidden="true" /> },
  { id: "activity", label: "Activity", icon: () => <Activity size={16} aria-hidden="true" /> },
  { id: "files", label: "Docs and files", icon: () => <FileText size={16} aria-hidden="true" /> },
  { id: "runs", label: "Runs", icon: () => <Play size={16} aria-hidden="true" /> },
  { id: "workspace", label: "Workspace", icon: () => <FolderGit2 size={16} aria-hidden="true" /> },
];

const IDS = new Set<string>(SECTIONS.map((section) => section.id));

export function TaskSections(props: {
  taskId: string;
  initial?: Issue;
  /** The page header already shows the title (the full page). */
  hideTitle?: boolean;
  /** The task's title, for the headings of the other sections. */
  title?: string;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const section = (): TaskSection => (params.section && IDS.has(params.section) ? (params.section as TaskSection) : "details");
  const choose = (next: TaskSection) => setParams({ section: next === "details" ? undefined : next }, { replace: true });

  return (
    <div class="tsec" data-section={section()}>
      <div class="tsec-body">
        <Switch>
          <Match when={section() === "details"}>
            <TaskDetails taskId={props.taskId} initial={props.initial} hideTitle={props.hideTitle} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={section() === "activity"}>
            <TaskActivity taskId={props.taskId} title={props.hideTitle ? undefined : props.title} />
          </Match>
          <Match when={section() === "files"}>
            <TaskFiles taskId={props.taskId} />
          </Match>
          <Match when={section() === "runs"}>
            <TaskRuns taskId={props.taskId} />
          </Match>
          <Match when={section() === "workspace"}>
            <TaskWorkspace taskId={props.taskId} />
          </Match>
        </Switch>
      </div>
      <nav class="tsec-rail" aria-label="Task sections">
        <For each={SECTIONS}>
          {(entry) => (
            <button
              type="button"
              class="tsec-rail-btn"
              aria-current={section() === entry.id ? "page" : undefined}
              aria-label={entry.label}
              title={entry.label}
              onClick={() => choose(entry.id)}
            >
              {entry.icon()}
            </button>
          )}
        </For>
      </nav>
    </div>
  );
}
