import type { CompanyArtifact, Project } from "@paperclipai/shared";
import { createQueries, createQuery } from "@tanstack/solid-query";
import { ChevronDown, ChevronRight, FileText, Search } from "lucide-solid";
import { createMemo, createSignal, For, lazy, Match, Show, Suspense, Switch } from "solid-js";
import { ARTIFACTS_PAGE_SIZE, artifactsApi } from "@/api/artifacts";
import { queryKeys } from "@/api/queryKeys";
import type { DocumentHost } from "@/documents/host";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { updatedLabel } from "@/tasks/list-model";
import { useTaskPeople } from "@/tasks/people";
import type { useTaskList } from "@/tasks/TasksView";
import { AgentAvatar } from "@/ui/Avatar";
import { Dialog } from "@/ui/Dialog";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { Switch as Toggle } from "@/ui/Switch";
import {
  DOC_FILTERS,
  docGroups,
  docKind,
  documentKey,
  docSummary,
  fileTag,
  fileType,
  incompleteGroups,
  type DocFilter,
  type DocGroup,
  type TaskFacts,
} from "./docs-model";
import "./ProjectDocs.css";

/*
 * The project's Docs tab (board 9): a search box and a type filter, the project's own docs and
 * files, then "From tasks": every task's documents, attachments and outputs, grouped by task, with
 * closed tasks shown or hidden.
 *
 * - The project section waits for project documents (decision D, decision 1): projects can't hold
 *   documents or files yet, so it says so instead of offering New doc and Upload.
 * - A document opens in the document viewer and editor, over the page. An attachment or output with
 *   a file opens the file in a new tab; one without opens its task.
 * - On a phone (M13) the filters scroll sideways, each task's head keeps its ID, title and count,
 *   and its items are rows with Open task beneath them (ProjectDocs.css).
 */

type Tasks = ReturnType<typeof useTaskList>;

const DocumentView = lazy(() => import("@/documents/DocumentView").then((module) => ({ default: module.DocumentView })));

type OpenDoc = { issueId: string; key: string; title: string };

const TAG_TONE: Record<string, string> = {
  MD: "run",
  PNG: "cyan",
  JPG: "cyan",
  GIF: "cyan",
  WEBP: "cyan",
  SVG: "cyan",
  CSV: "green",
  XLSX: "green",
  PDF: "red",
  HTML: "violet",
};

export function ProjectDocs(props: { project: Project; tasks: Tasks }) {
  const company = useCompany();
  const commands = useCommands();
  const [filter, setFilter] = createSignal<DocFilter>("all");
  const [search, setSearch] = createSignal("");
  const [showClosed, setShowClosed] = createSignal(true);
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [openDoc, setOpenDoc] = createSignal<OpenDoc | null>(null);

  const grouped = createQuery(() => ({
    queryKey: queryKeys.artifacts.project(company().id, props.project.id),
    queryFn: ({ signal }) =>
      artifactsApi.list(company().id, { projectId: props.project.id, groupBy: "task", limit: ARTIFACTS_PAGE_SIZE }, signal),
  }));
  const groups = () => grouped.data?.groups ?? [];
  // Groups with more than their three previews load in full.
  const fullQueries = createQueries(() => ({
    queries: incompleteGroups(groups()).map((issueId) => ({
      queryKey: queryKeys.artifacts.project(company().id, props.project.id, issueId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        artifactsApi.list(company().id, { projectId: props.project.id, groupBy: "task", groupIssueId: issueId, limit: ARTIFACTS_PAGE_SIZE }, signal),
    })),
  }));
  const full = createMemo(() => {
    const map = new Map<string, CompanyArtifact[]>();
    incompleteGroups(groups()).forEach((issueId, index) => {
      const data = fullQueries[index]?.data;
      if (data) map.set(issueId, data.artifacts);
    });
    return map;
  });
  const facts = createMemo(
    () =>
      new Map<string, TaskFacts>(
        (props.tasks.data ?? []).map((task) => [
          task.id,
          { status: task.status, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId },
        ]),
      ),
  );
  const view = createMemo(() =>
    docGroups({ groups: groups(), full: full(), tasks: facts(), showClosed: showClosed(), filter: filter(), search: search() }),
  );
  const isCollapsed = (group: DocGroup) => collapsed()[group.issueId] ?? group.closed;
  const openTask = (group: Pick<DocGroup, "issueId" | "identifier" | "title">) =>
    commands.openTaskModal({ id: group.issueId, identifier: group.identifier, title: group.title, projectId: props.project.id });

  return (
    <div class="pdocs">
      <div class="pdocs-bar">
        <label class="pdocs-search">
          <Search size={14} aria-hidden="true" />
          <span class="sr-only">Search docs and files</span>
          <input type="search" placeholder="Search docs and files" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
        </label>
        <div class="pdocs-filters" role="group" aria-label="Filter by type">
          <For each={DOC_FILTERS}>
            {(option) => (
              <button type="button" class="pdocs-filter" aria-pressed={filter() === option.value} onClick={() => setFilter(option.value)}>
                {option.label}
                <span>{view().counts[option.value]}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <section class="pdocs-section" aria-labelledby="pdocs-project-h">
        <div class="pdocs-head">
          <h2 id="pdocs-project-h" class="disp">
            Project docs and files
          </h2>
          <span class="cap">Shared across the whole project, not tied to one task</span>
        </div>
        <p class="pdocs-waiting">
          Projects can't hold their own documents or files yet. Until they can, everything is listed under the task it came from,
          below.
        </p>
      </section>

      <section class="pdocs-section" aria-labelledby="pdocs-tasks-h">
        <div class="pdocs-head">
          <h2 id="pdocs-tasks-h" class="disp">
            From tasks
          </h2>
          <Show when={view().groups.length > 0}>
            <span class="cap">{docSummary(view())}</span>
          </Show>
          <span class="pdocs-closed">
            <Toggle checked={showClosed()} onChange={setShowClosed} label="Include closed tasks" />
          </span>
        </div>
        <Switch>
          <Match when={grouped.isPending}>
            <p class="cap">Loading docs and files…</p>
          </Match>
          <Match when={grouped.isError}>
            <p class="pdocs-waiting">Couldn't load the docs and files: {(grouped.error as Error).message}</p>
          </Match>
          <Match when={view().groups.length === 0}>
            <p class="pdocs-waiting">
              {groups().length === 0
                ? "No task in this project has documents, attachments or outputs yet."
                : "Nothing matches. Try another type, clear the search, or include closed tasks."}
            </p>
          </Match>
          <Match when={true}>
            <div class="pdocs-groups">
              <For each={view().groups}>
                {(group) => (
                  <GroupCard
                    group={group}
                    collapsed={isCollapsed(group)}
                    onToggle={() => setCollapsed((current) => ({ ...current, [group.issueId]: !isCollapsed(group) }))}
                    onOpenTask={() => openTask(group)}
                    onOpenDoc={(artifact, key) => setOpenDoc({ issueId: group.issueId, key, title: artifact.title })}
                  />
                )}
              </For>
              <Show when={grouped.data?.nextCursor}>
                <p class="cap">Showing the {groups().length} most recently updated tasks with docs and files.</p>
              </Show>
            </div>
          </Match>
        </Switch>
      </section>

      <DocumentDialog doc={openDoc()} onClose={() => setOpenDoc(null)} />
    </div>
  );
}

function GroupCard(props: {
  group: DocGroup;
  collapsed: boolean;
  onToggle: () => void;
  onOpenTask: () => void;
  onOpenDoc: (artifact: CompanyArtifact, key: string) => void;
}) {
  const people = useTaskPeople();
  const assignee = () => people.agent(props.group.assigneeAgentId);
  const plural = (count: number) => `${count} item${count === 1 ? "" : "s"}`;
  return (
    <div class="card pdocs-group" role="group" aria-label={`${props.group.identifier} ${props.group.title}`}>
      <div class="pdocs-group-head">
        <button
          type="button"
          class="pdocs-toggle"
          aria-expanded={!props.collapsed}
          aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.group.identifier}`}
          onClick={() => props.onToggle()}
        >
          {props.collapsed ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
        <Show when={props.group.status}>{(status) => <StatusCapsule status={status()} size="row" />}</Show>
        <span class="mono pdocs-id">{props.group.identifier}</span>
        <button type="button" class="pdocs-task" onClick={() => props.onOpenTask()}>
          {props.group.title}
        </button>
        <Show when={props.group.status}>
          {(status) => <span class={`pdocs-status pdocs-status--${status()}`}>{STATUS_META[status()].label}</span>}
        </Show>
        <Show when={assignee()}>
          {(agent) => (
            <span class="pdocs-assignee">
              <AgentAvatar agent={agent()} size={24} ring={false} label={agent().name} />
            </span>
          )}
        </Show>
        <span class="cap pdocs-count">{plural(props.group.count)}</span>
        <button type="button" class="pdocs-link" onClick={() => props.onOpenTask()}>
          Open task
        </button>
      </div>
      <Show when={!props.collapsed}>
        <div class="pdocs-grid">
          <For each={props.group.items}>{(artifact) => <Tile artifact={artifact} onOpenDoc={props.onOpenDoc} onOpenTask={props.onOpenTask} />}</For>
          <Show when={!props.group.complete}>
            <p class="cap pdocs-more">Loading the rest…</p>
          </Show>
        </div>
        {/* On a phone (M13) the head keeps only the task and its count; Open task sits under the items. */}
        <button type="button" class="pdocs-link pdocs-link--foot" onClick={() => props.onOpenTask()}>
          Open task
        </button>
      </Show>
    </div>
  );
}

function Tile(props: { artifact: CompanyArtifact; onOpenDoc: (artifact: CompanyArtifact, key: string) => void; onOpenTask: () => void }) {
  const people = useTaskPeople();
  const tag = () => fileTag(props.artifact);
  const key = () => documentKey(props.artifact);
  const fileHref = () => props.artifact.openPath ?? props.artifact.contentPath;
  const by = () => people.agent(props.artifact.createdByAgent?.id);
  const isPlan = () => key() === "plan";
  const body = () => (
    <>
      <div class="pdocs-preview">
        <Switch
          fallback={
            <span class="pdocs-tag" style={{ background: `var(--${TAG_TONE[tag()] ?? "well"}-bg, var(--well))`, color: `var(--${TAG_TONE[tag()] ?? "body"}-fg, var(--body))` }}>
              {tag()}
            </span>
          }
        >
          <Match when={props.artifact.source === "document"}>
            <div class="pdocs-doc">
              <b>{props.artifact.title}</b>
              <span>{props.artifact.previewText ?? ""}</span>
            </div>
          </Match>
          <Match when={props.artifact.mediaKind === "image" && props.artifact.contentPath}>
            {(src) => <img src={src()} alt="" loading="lazy" />}
          </Match>
        </Switch>
      </div>
      <div class="pdocs-meta">
        <span class="pdocs-name">{props.artifact.title}</span>
        <span class="pdocs-by">
          <Show when={by()}>{(agent) => <AgentAvatar agent={agent()} size={16} ring={false} />}</Show>
          <span>
            {fileType(props.artifact)} · {updatedLabel(props.artifact.updatedAt)}
            <Show when={props.artifact.createdByAgent && !by()}> · {props.artifact.createdByAgent!.name}</Show>
          </span>
        </span>
      </div>
      <Show when={isPlan()}>
        <span class="pdocs-badge">Task plan</span>
      </Show>
    </>
  );
  return (
    <Switch
      fallback={
        <button type="button" class="pdocs-tile" data-kind={docKind(props.artifact)} onClick={() => props.onOpenTask()} title="Open its task">
          {body()}
        </button>
      }
    >
      <Match when={key()}>
        {(docKey) => (
          <button type="button" class="pdocs-tile" data-kind="doc" onClick={() => props.onOpenDoc(props.artifact, docKey())}>
            {body()}
          </button>
        )}
      </Match>
      <Match when={fileHref()}>
        {(href) => (
          <a class="pdocs-tile" data-kind={docKind(props.artifact)} href={href()} target="_blank" rel="noreferrer">
            {body()}
          </a>
        )}
      </Match>
    </Switch>
  );
}

/** A task's document over the Docs tab, in the same viewer and editor as the task's Docs and files. */
function DocumentDialog(props: { doc: OpenDoc | null; onClose: () => void }) {
  const people = useTaskPeople();
  const host = (doc: OpenDoc): DocumentHost => ({
    owner: { kind: "issue", id: doc.issueId },
    root: queryKeys.issues.section(doc.issueId, "documents"),
    nameOf: (agentId, userId) => {
      const agent = people.agent(agentId);
      if (agent) return agent.name;
      if (userId) return userId === people.youId() ? "You" : people.personName(userId);
      return null;
    },
    youId: () => people.youId(),
  });
  return (
    <Dialog
      open={props.doc !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={
        <span class="pdocs-dialog-title">
          <FileText size={16} aria-hidden="true" />
          {props.doc?.title ?? "Document"}
        </span>
      }
      titleHidden
      width={1000}
      class="pdocs-dialog"
    >
      <Show when={props.doc}>
        {(doc) => (
          <Suspense fallback={<p class="cap">Loading the document…</p>}>
            <DocumentView host={host(doc())} docKey={doc().key} backLabel="Back to project docs" onBack={props.onClose} onDeleted={props.onClose} />
          </Suspense>
        )}
      </Show>
    </Dialog>
  );
}
