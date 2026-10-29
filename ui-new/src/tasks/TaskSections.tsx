import type { Issue } from "@paperclipai/shared";
import { useLocation, useSearchParams } from "@solidjs/router";
import { Activity, FileText, FolderGit2, Layers, Play, Puzzle } from "lucide-solid";
import { createEffect, createMemo, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { viewport } from "@/layout/breakpoints";
import { TaskActivity } from "./TaskActivity";
import { TaskDetails } from "./TaskDetails";
import { TaskFiles } from "./TaskFiles";
import { TaskNotices } from "./TaskNotices";
import { TaskRuns } from "./TaskRuns";
import { TaskWorkspace } from "./TaskWorkspace";
import { anchorSection, parseTaskAnchor } from "./task-anchor";
import { isPluginTab } from "@/plugins/model";
import { TaskPluginExtras, TaskPluginSectionView, useTaskPluginSections } from "@/plugins/TaskPlugins";
import "./TaskSections.css";

/*
 * One task's sections, in the docked panel, the modal and on the full page: the open section beside
 * the rail of section buttons on the right (boards 2, 3 and 5). The open section is kept in the URL
 * (`?section=`), so stepping to the next task, reloading, or sharing the link keeps it; Details
 * is the default and leaves the URL alone.
 *
 * The modal (boards 6 and 7) lays them out side by side instead (`layout="split"`): Details stays on
 * the left, and the rail picks what's beside it, Activity by default.
 *
 * The task's health notices (TaskNotices) sit above whichever section is open, then what plugins
 * add to tasks (toolbar buttons, launchers, detail blocks). Plugins' task tabs and agent side panels
 * join the rail as sections of their own (`?section=plugin:<pluginKey>:<slotId>`; src/plugins/).
 *
 * A link into the task (`#comment-<id>`, `#document-<key>`; task-anchor.ts) opens the section it
 * points into: Activity scrolls to the comment, Docs and files opens the document.
 *
 * On a phone (M2 to M4) the sections are tabs above the open one, with Details, Activity and Files
 * named, and the modal's split becomes the same single column.
 *
 * Sections are a list (SECTIONS), so another one (cases, say) is one entry and one Match below.
 */

export type TaskSection = "details" | "activity" | "files" | "runs" | "workspace";

const SECTIONS: { id: TaskSection; label: string; short?: string; icon: () => JSX.Element }[] = [
  { id: "details", label: "Details", short: "Details", icon: () => <Layers size={16} aria-hidden="true" /> },
  { id: "activity", label: "Activity", short: "Activity", icon: () => <Activity size={16} aria-hidden="true" /> },
  { id: "files", label: "Docs and files", short: "Files", icon: () => <FileText size={16} aria-hidden="true" /> },
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
  /** "rail" (the panel and the full page) or "split" (the modal: Details beside another section). */
  layout?: "rail" | "split";
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const location = useLocation();
  const phone = () => viewport() === "phone";
  const split = () => props.layout === "split" && !phone();
  const pluginSections = useTaskPluginSections(() => props.taskId);
  const pluginSection = () => (isPluginTab(params.section) ? params.section : null);
  const requested = (): TaskSection => (params.section && IDS.has(params.section) ? (params.section as TaskSection) : "details");
  // Split, Details is always shown, so the other pane shows Activity unless something else is asked for.
  const section = (): TaskSection | "plugin" => (pluginSection() ? "plugin" : split() && requested() === "details" ? "activity" : requested());
  const choose = (next: string) => setParams({ section: next === "details" ? undefined : next }, { replace: true });
  const rail = () => (split() ? SECTIONS.filter((entry) => entry.id !== "details") : SECTIONS);

  // A link into the task opens the section it points into, when it arrives or another task opens.
  const anchor = createMemo(() => parseTaskAnchor(location.hash));
  createEffect(
    on([() => location.hash, () => props.taskId], () => {
      const target = anchor();
      if (!target) return;
      const wanted = anchorSection(target);
      if (section() !== wanted) choose(wanted);
    }),
  );
  const focusComment = () => {
    const target = anchor();
    return target?.kind === "comment" ? target.id : undefined;
  };
  const openDocument = () => {
    const target = anchor();
    return target?.kind === "document" ? target.key : undefined;
  };

  const details = () => <TaskDetails taskId={props.taskId} initial={props.initial} hideTitle={props.hideTitle} onOpenTask={props.onOpenTask} />;
  const other = () => (
    <Switch>
      <Match when={section() === "activity"}>
        <TaskActivity taskId={props.taskId} title={props.hideTitle || split() ? undefined : props.title} focusCommentId={focusComment()} />
      </Match>
      <Match when={section() === "files"}>
        <TaskFiles taskId={props.taskId} openDocKey={openDocument()} />
      </Match>
      <Match when={section() === "runs"}>
        <TaskRuns taskId={props.taskId} />
      </Match>
      <Match when={section() === "workspace"}>
        <TaskWorkspace taskId={props.taskId} />
      </Match>
      <Match when={pluginSection()}>{(id) => <TaskPluginSectionView sections={pluginSections()} id={id()} />}</Match>
    </Switch>
  );

  return (
    <div class="tsec" classList={{ "tsec--split": split(), "tsec--tabs": phone() }} data-section={section()}>
      <Show
        when={split()}
        fallback={
          <div class="tsec-body">
            <TaskNotices taskId={props.taskId} />
            {/* On phones, plugins' blocks follow the task's own details instead of leading them. */}
            <Show when={!phone()}>
              <TaskPluginExtras taskId={props.taskId} />
            </Show>
            <Show when={section() === "details"} fallback={other()}>
              {details()}
              <Show when={phone()}>
                <TaskPluginExtras taskId={props.taskId} />
              </Show>
            </Show>
          </div>
        }
      >
        <div class="tsec-details">
          <TaskNotices taskId={props.taskId} />
          <TaskPluginExtras taskId={props.taskId} />
          {details()}
        </div>
        <div class="tsec-body tsec-side">{other()}</div>
      </Show>
      <nav class="tsec-rail" aria-label="Task sections">
        <For each={rail()}>
          {(entry) => (
            <button
              type="button"
              class="tsec-rail-btn"
              aria-current={section() === entry.id ? "page" : undefined}
              aria-label={entry.label}
              title={entry.label}
              data-named={entry.short ? "" : undefined}
              onClick={() => choose(entry.id)}
            >
              {entry.icon()}
              <Show when={phone() && entry.short}>
                <span class="tsec-rail-label">{entry.short}</span>
              </Show>
            </button>
          )}
        </For>
        <For each={pluginSections()}>
          {(entry) => (
            <button
              type="button"
              class="tsec-rail-btn"
              aria-current={pluginSection() === entry.id ? "page" : undefined}
              aria-label={`${entry.label} (plugin)`}
              title={`${entry.label} (from ${entry.slot.pluginDisplayName})`}
              onClick={() => choose(entry.id)}
            >
              <Puzzle size={16} aria-hidden="true" />
            </button>
          )}
        </For>
      </nav>
    </div>
  );
}
