import type { RoutineDetail } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { AppWindow, Archive, ArchiveRestore, ChevronLeft, ChevronRight, Ellipsis, Folder, History, Layers, Link, PanelRight, Play, Repeat, X } from "lucide-solid";
import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { routinesApi } from "@/api/routines";
import { Panel } from "@/layout/Panel";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { copyText } from "@/tasks/TaskActions";
import { setTaskOpenMode } from "@/tasks/task-open-mode";
import { InitialsDisc } from "@/ui/Avatar";
import { Dialog } from "@/ui/Dialog";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { recurringPath, refreshRecurring, useRoutineFoldersQuery, useRoutineQuery } from "./queries";
import { RecurringDetails } from "./RecurringDetails";
import { RecurringHistory } from "./RecurringHistory";
import { RecurringRuns, RunNowForm } from "./RecurringRuns";
import "@/tasks/TaskDetails.css";
import "@/tasks/TaskModal.css";
import "@/tasks/TaskPanel.css";
import "@/tasks/TaskSections.css";
import "./RecurringPanel.css";

/*
 * A recurring task opened from the Recurring view (boards R2–R4): docked beside the list like a
 * task's panel, or as a modal over it when tasks open as modals (the same setting, decision B).
 * The toolbar steps to the previous and next recurring task, names its project, and holds Run now,
 * the More menu (move to a folder, pause or turn on, archive or restore, copy the link) and the
 * panel-or-modal switch. The rail picks Details (R2), Runs (R3) or History (R4), kept in the URL as
 * `?section=`.
 *
 * Routines can't be deleted through the API, so, as in the old UI, Archive is the way to put one
 * away; archived ones stop running and can be restored.
 */

export type RecurringSection = "details" | "runs" | "history";

const SECTIONS: { id: RecurringSection; label: string; icon: () => JSX.Element }[] = [
  { id: "details", label: "Details", icon: () => <Layers size={16} aria-hidden="true" /> },
  { id: "runs", label: "Runs", icon: () => <Play size={16} aria-hidden="true" /> },
  { id: "history", label: "History", icon: () => <History size={16} aria-hidden="true" /> },
];

export function RecurringPanel(props: {
  routineId: string;
  asModal: boolean;
  onClose: () => void;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const routine = useRoutineQuery(() => props.routineId);
  const title = () => routine.data?.title ?? "Recurring task";
  const header = () => <PanelHead routine={routine.data} onPrevious={props.onPrevious} onNext={props.onNext} />;
  const actions = (modal: boolean) => (
    <Show when={routine.data}>
      {(found) => <PanelActions routine={found()} modal={modal} onClose={props.onClose} />}
    </Show>
  );
  const body = () => (
    <Switch>
      <Match when={routine.isError && !routine.data}>
        <p class="rpn-note">This recurring task couldn't be loaded: {(routine.error as Error).message}</p>
      </Match>
      <Match when={!routine.data}>
        <p class="rpn-note muted" aria-busy="true">
          Loading…
        </p>
      </Match>
      <Match when={routine.data}>{(found) => <RecurringSections routine={found()} onOpenTask={props.onOpenTask} />}</Match>
    </Switch>
  );

  return (
    <Show
      when={props.asModal}
      fallback={
        <Panel label={`Recurring task: ${title()}`} onClose={props.onClose} toolbar flush header={header()} actions={actions(false)}>
          {body()}
        </Panel>
      }
    >
      <Dialog open onOpenChange={(open) => !open && props.onClose()} title={title()} titleHidden hideClose width={1000} class="tmodal rpn-modal">
        <div class="tmodal-head">
          {header()}
          <div class="tmodal-actions">
            {actions(true)}
            <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Close" onClick={() => props.onClose()}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="tmodal-body">{body()}</div>
      </Dialog>
    </Show>
  );
}

function PanelHead(props: { routine: RoutineDetail | undefined; onPrevious?: () => void; onNext?: () => void }) {
  const projects = useProjectsQuery();
  const project = () => projects.data?.find((candidate) => candidate.id === props.routine?.projectId);
  return (
    <div class="tp-head">
      <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Previous recurring task" disabled={!props.onPrevious} onClick={() => props.onPrevious?.()}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Next recurring task" disabled={!props.onNext} onClick={() => props.onNext?.()}>
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
      <span class="rpn-kind">
        <Repeat size={14} aria-hidden="true" />
        Recurring
      </span>
    </div>
  );
}

function PanelActions(props: { routine: RoutineDetail; modal: boolean; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const [runOpen, setRunOpen] = createSignal(false);
  const folders = useRoutineFoldersQuery();
  const archived = () => props.routine.status === "archived";

  const update = async (patch: Record<string, unknown>, failed: string, done?: string) => {
    try {
      await routinesApi.update(props.routine.id, patch);
      if (done) pushToast({ tone: "success", title: done, body: props.routine.title });
    } catch (error) {
      pushToast({ tone: "error", title: failed, body: error instanceof Error ? error.message : undefined });
    } finally {
      refreshRecurring(client, company().id);
    }
  };
  const move = async (folderId: string | null) => {
    try {
      await routinesApi.moveToFolder(company().id, props.routine.id, folderId);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't move it", body: error instanceof Error ? error.message : undefined });
    } finally {
      refreshRecurring(client, company().id);
    }
  };
  const copyLink = async () => {
    try {
      await copyText(new URL(recurringPath(company().issuePrefix, props.routine.id), window.location.origin).toString());
      pushToast({ tone: "success", title: "Copied the link" });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't copy the link", body: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <div class="tp-actions">
      <Show when={!archived()}>
        <Popover open={runOpen()} onOpenChange={setRunOpen} placement="bottom-end">
          <Popover.Trigger class="btn btn--secondary btn--compact rpn-run" aria-label="Run now">
            <Play size={14} aria-hidden="true" />
            Run now
          </Popover.Trigger>
          <Popover.Content title="Run now" width={380}>
            <RunNowForm
              routine={props.routine}
              onDone={() => {
                setRunOpen(false);
                setParams({ section: "runs" }, { replace: true });
              }}
              onCancel={() => setRunOpen(false)}
            />
          </Popover.Content>
        </Popover>
      </Show>
      <Menu placement="bottom-end">
        <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label="More actions: move to folder, pause, archive">
          <Ellipsis size={16} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label="Recurring task actions" width={260}>
          <Show when={(folders.data?.folders.length ?? 0) > 0}>
            <Menu.Group label="Move to folder">
              <For each={folders.data?.folders ?? []}>
                {(folder) => (
                  <Menu.Item icon={<Folder size={15} />} hint={props.routine.folderId === folder.id ? "✓" : undefined} onSelect={() => void move(folder.id)}>
                    {folder.name}
                  </Menu.Item>
                )}
              </For>
              <Menu.Item icon={<Folder size={15} />} hint={props.routine.folderId ? undefined : "✓"} onSelect={() => void move(null)}>
                Unfiled
              </Menu.Item>
            </Menu.Group>
            <Menu.Separator />
          </Show>
          <Show when={!archived()}>
            <Menu.Item
              icon={<Play size={15} />}
              onSelect={() =>
                void update(
                  { status: props.routine.status === "active" ? "paused" : "active" },
                  props.routine.status === "active" ? "Couldn't pause it" : "Couldn't turn it on",
                  props.routine.status === "active" ? "Paused" : "Turned on",
                )
              }
            >
              {props.routine.status === "active" ? "Pause" : "Turn on"}
            </Menu.Item>
          </Show>
          <Menu.Item icon={<Link size={15} />} onSelect={() => void copyLink()}>
            Copy link
          </Menu.Item>
          <Menu.Separator />
          <Show
            when={archived()}
            fallback={
              <Menu.Item
                icon={<Archive size={15} />}
                danger
                description="It stops running; restore it any time"
                onSelect={() => void update({ status: "archived" }, "Couldn't archive it", "Archived")}
              >
                Archive
              </Menu.Item>
            }
          >
            <Menu.Item icon={<ArchiveRestore size={15} />} description="Comes back paused" onSelect={() => void update({ status: "paused" }, "Couldn't restore it", "Restored, paused")}>
              Restore from archive
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>
      <Show
        when={props.modal}
        fallback={
          <button
            type="button"
            class="btn btn--icon btn--ghost btn--compact"
            aria-label="Open as modal"
            title="Open as modal: open tasks over the list instead of beside it"
            onClick={() => setTaskOpenMode("modal")}
          >
            <AppWindow size={15} aria-hidden="true" />
          </button>
        }
      >
        <span class="ta-sep" aria-hidden="true" />
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
    </div>
  );
}

function RecurringSections(props: { routine: RoutineDetail; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const section = (): RecurringSection => (params.section === "runs" || params.section === "history" ? params.section : "details");
  const choose = (next: RecurringSection) => setParams({ section: next === "details" ? undefined : next }, { replace: true });
  return (
    <div class="tsec rpn" data-section={section()}>
      <div class="tsec-body">
        <Switch>
          <Match when={section() === "details"}>
            <RecurringDetails routine={props.routine} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={section() === "runs"}>
            <RecurringRuns routine={props.routine} onOpenTask={props.onOpenTask} />
          </Match>
          <Match when={section() === "history"}>
            <RecurringHistory routine={props.routine} />
          </Match>
        </Switch>
      </div>
      <nav class="tsec-rail" aria-label="Recurring task sections">
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
