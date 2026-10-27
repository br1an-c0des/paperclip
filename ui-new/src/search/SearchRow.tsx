import type { CompanySearchResult, IssueStatus } from "@paperclipai/shared";
import { FileText, FolderKanban, MessageSquare, Paperclip } from "lucide-solid";
import { For, Match, Show, Switch } from "solid-js";
import { updatedLabel } from "@/tasks/list-model";
import type { TaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { StatusCapsule } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { documentTitle, rowSnippet, snippetLabel, titleSegments, highlightSegments, type ResultKind, type Segment } from "./results-model";

/*
 * One search result (board S1): a leading mark per kind (status capsule, avatar, icon or
 * thumbnail), the title with its matches marked, one labelled snippet, where it lives, and on the
 * right who has it and when it changed. Every kind has the same parts.
 *
 * The row is a link to the result's own URL, so a middle or modified click opens it in a new tab;
 * a plain click calls `onOpen`, which opens task-shaped results in the task modal.
 */

const STATUS_TONE: Partial<Record<IssueStatus, string>> = {
  in_progress: "run",
  in_review: "violet",
  todo: "amber",
  blocked: "red",
  done: "green",
};

export function Marked(props: { segments: Segment[] }) {
  return (
    <For each={props.segments}>{(segment) => (segment.hit ? <mark class="sx-mark">{segment.text}</mark> : segment.text)}</For>
  );
}

function StatusChip(props: { status: IssueStatus }) {
  const tone = () => STATUS_TONE[props.status];
  return (
    <span
      class="sx-chip"
      style={tone() ? { background: `var(--${tone()}-bg)`, color: `var(--${tone()}-fg)` } : undefined}
    >
      {STATUS_META[props.status].label}
    </span>
  );
}

function IconTile(props: { kind: ResultKind }) {
  return (
    <span class="sx-tile">
      <Switch>
        <Match when={props.kind === "comment"}>
          <MessageSquare size={15} />
        </Match>
        <Match when={props.kind === "document"}>
          <FileText size={15} />
        </Match>
        <Match when={props.kind === "file"}>
          <Paperclip size={15} />
        </Match>
        <Match when={props.kind === "project"}>
          <FolderKanban size={15} />
        </Match>
      </Switch>
    </span>
  );
}

export function SearchRow(props: {
  result: CompanySearchResult;
  kind: ResultKind;
  people: TaskPeople;
  projectName: (id: string | null) => string | undefined;
  onOpen: (result: CompanySearchResult) => void;
}) {
  const issue = () => props.result.issue;
  const agent = () => (props.kind === "agent" ? props.people.agent(props.result.id) : undefined);
  const snippet = () => rowSnippet(props.result, props.kind);
  const live = () => !!issue() && props.people.liveIssueIds().has(issue()!.id);

  const identifier = () => issue()?.identifier ?? null;
  const title = (): Segment[] => {
    if (props.kind === "document") {
      const name = documentTitle(props.result);
      if (name) return [{ text: name, hit: false }];
    }
    if (props.kind === "file" || props.kind === "agent" || props.kind === "project") {
      return highlightSegments(props.result.title, null);
    }
    return titleSegments(props.result);
  };
  const where = () => {
    const result = props.result;
    switch (props.kind) {
      case "task":
        return props.projectName(issue()?.projectId ?? null) ?? "No project";
      case "comment":
        return `Comment on ${identifier() ?? "a task"}`;
      case "document":
        return documentTitle(result) ? `Document on ${identifier() ?? "a task"} · ${issue()?.title ?? ""}` : `Document on ${identifier() ?? "a task"}`;
      case "file": {
        const artifact = result.artifact;
        const media = artifact ? artifact.mediaKind.charAt(0).toUpperCase() + artifact.mediaKind.slice(1) : "File";
        return artifact ? `${media} on ${artifact.issueIdentifier} · ${artifact.issueTitle}` : media;
      }
      case "agent":
        return agent()?.title ?? "Agent";
      case "project":
        return "Project";
    }
  };
  const when = () => updatedLabel(props.result.updatedAt);
  const assigneeAgent = () => props.people.agent(issue()?.assigneeAgentId);
  const assigneeUser = () => issue()?.assigneeUserId ?? null;

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpen(props.result);
  };

  return (
    <a class="sx-row" href={props.result.href} data-result-row onClick={onClick}>
      <span class="sx-lead" aria-hidden="true">
        <Switch fallback={<IconTile kind={props.kind} />}>
          <Match when={props.kind === "task" && issue()}>
            {(found) => <StatusCapsule status={found().status} size="pill" live={live()} />}
          </Match>
          <Match when={props.kind === "file" && props.result.previewImageUrl}>
            {(src) => <img class="sx-thumb" src={src()} alt="" loading="lazy" decoding="async" />}
          </Match>
          <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={32} />}</Match>
          <Match when={props.kind === "agent"}>
            <InitialsDisc name={props.result.title} seed={props.result.id} size={30} />
          </Match>
        </Switch>
      </span>
      <span class="sx-main">
        <span class="sx-title-line">
          <Show when={(props.kind === "task" || props.kind === "comment" || props.kind === "document") && identifier()}>
            {(id) => <span class="sx-id mono">{id()}</span>}
          </Show>
          <span class="sx-title">
            <Marked segments={title()} />
          </span>
          <Show when={props.kind === "task" && issue()}>{(found) => <StatusChip status={found().status} />}</Show>
        </span>
        <Show when={snippet()}>
          {(found) => (
            <span class="sx-snip">
              <span class="sx-snip-label">{snippetLabel(found(), props.kind)} · </span>
              <Marked segments={highlightSegments(found().text, found().highlights)} />
            </span>
          )}
        </Show>
        <span class="sx-where">{where()}</span>
      </span>
      <span class="sx-end">
        <Show when={props.kind === "task" || props.kind === "comment" || props.kind === "document"}>
          <Switch>
            <Match when={assigneeAgent()}>
              {(found) => (
                <span title={found().name}>
                  <AgentAvatar agent={found()} size={24} label={`Assigned to ${found().name}`} />
                </span>
              )}
            </Match>
            <Match when={assigneeUser()}>
              {(id) => (
                <InitialsDisc
                  name={id() === props.people.youId() ? "You" : props.people.personName(id())}
                  seed={id()}
                  size={22}
                  you={id() === props.people.youId()}
                  label={`Assigned to ${id() === props.people.youId() ? "you" : props.people.personName(id())}`}
                />
              )}
            </Match>
          </Switch>
        </Show>
        <span class="sx-when">{when()}</span>
      </span>
    </a>
  );
}
